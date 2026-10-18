import { useEffect, useRef, useState } from 'react';
import { ToolDialog } from './ToolDialog';
import { normalizeHost, previewCommand, readPreviewSettings } from '../lib/previewSettings';
import type { PreviewSettings } from '../lib/previewSettings';
import type { CacheStats } from '../lib/thumbnailCache';
import type { CardDensity } from '../lib/finderOptions';

function bytes(value: number) { return value < 1024 * 1024 ? Math.ceil(value / 1024) + ' KB' : (value / 1024 / 1024).toFixed(1) + ' MB'; }
export function SettingsDialog({ settings, density, onSettings, onDensity, onClose, onShortcuts }: {
  settings: PreviewSettings; density: CardDensity; onSettings: (settings: PreviewSettings) => void; onDensity: (density: CardDensity) => void; onClose: () => void; onShortcuts: () => void;
}) {
  const [stats, setStats] = useState<CacheStats | null>(null), [host, setHost] = useState('');
  const [busy, setBusy] = useState(false), [message, setMessage] = useState(''); const pending = useRef(false);
  useEffect(() => {
    let mounted = true;
    void previewCommand<CacheStats>('stats').then(value => { if (mounted) setStats(value); }).catch(() => { if (mounted) setMessage('暂时无法读取缓存占用，可稍后重试。'); });
    return () => { mounted = false; };
  }, []);
  async function update(next: PreviewSettings) {
    if (pending.current) return;
    pending.current = true; setBusy(true); setMessage(''); onSettings(next);
    try {
      const saved = await previewCommand<PreviewSettings>('settings', { settings: next }); onSettings(saved);
      setStats(await previewCommand<CacheStats>('stats'));
    } catch (error) { setMessage(error instanceof Error ? error.message : '保存失败，请重试。'); onSettings(await readPreviewSettings().catch(() => settings)); }
    finally { pending.current = false; setBusy(false); }
  }
  async function clear(host?: string) {
    if (pending.current) return;
    pending.current = true; setBusy(true); setMessage('');
    try { setStats(await previewCommand<CacheStats>('clear', host ? { host } : {})); setMessage(host ? '已清除 ' + host + ' 的预览。' : '已清空预览缓存，之后随浏览重新生成。'); }
    catch (error) { setMessage(error instanceof Error ? error.message : '清理失败，请重试。'); }
    finally { pending.current = false; setBusy(false); }
  }
  async function refresh() {
    if (pending.current) return;
    pending.current = true; setBusy(true); setMessage('');
    try { const count = await previewCommand<number>('refresh'); setMessage(count ? '已安排刷新 ' + count + ' 个窗口的活动页面。' : '目前没有可刷新的活动页面。'); }
    catch (error) { setMessage(error instanceof Error ? error.message : '刷新失败，请重试。'); }
    finally { pending.current = false; setBusy(false); }
  }
  function addHost() {
    const normalized = normalizeHost(host);
    if (!normalized) { setMessage('请输入有效的网站域名或网址。'); return; }
    if (settings.excludedHosts.includes(normalized)) { setMessage('该网站已在排除列表中。'); return; }
    setHost(''); void update({ ...settings, excludedHosts: [...settings.excludedHosts, normalized] });
  }
  return <ToolDialog title="设置" busy={busy} onClose={onClose} footer={message ? <p role="status" className="tool-message">{message}</p> : undefined}>
    <section className="tool-section"><h3>显示</h3>
      <div className="tool-setting-row"><span>卡片密度</span><div className="tool-segments">{(['standard', 'compact'] as const).map(value => <button type="button" key={value} disabled={busy} aria-pressed={density === value} onClick={() => onDensity(value)}>{value === 'standard' ? '标准' : '紧凑'}</button>)}</div></div>
      <label className="tool-check-row"><input type="checkbox" checked={settings.hoverPreview} disabled={busy} onChange={event => void update({ ...settings, hoverPreview: event.target.checked })} /><span>悬停放大预览</span></label>
    </section>
    <section className="tool-section"><h3>预览</h3>
      <label className="tool-check-row"><input type="checkbox" checked={!settings.paused} disabled={busy} onChange={event => void update({ ...settings, paused: !event.target.checked })} /><span><span>随浏览自动更新</span><small>关闭后暂停采集，已保存的预览仍然保留。</small></span></label>
      <button type="button" className="tool-button" disabled={busy || settings.paused} onClick={refresh}>刷新活动页面预览</button>
      <div className="tool-exclusions"><label htmlFor="excluded-host">排除网站</label><form onSubmit={event => { event.preventDefault(); addHost(); }}>
        <input id="excluded-host" placeholder="例如 example.com" value={host} disabled={busy || settings.excludedHosts.length >= 500} onChange={event => setHost(event.target.value)} />
        <button type="submit" className="tool-button" disabled={busy || !host.trim() || settings.excludedHosts.length >= 500}>添加</button>
      </form><p className="tool-subtle">按域名精确匹配。添加后删除该网站已有预览；子域名需单独添加。</p>
      {settings.excludedHosts.length > 0 && <div className="tool-host-list">{settings.excludedHosts.map(value => <div className="tool-setting-row" key={value}><span title={value}>{value}</span><button className="tool-button" type="button" aria-label={'移除排除网站 ' + value} disabled={busy} onClick={() => void update({ ...settings, excludedHosts: settings.excludedHosts.filter(item => item !== value) })}>移除</button></div>)}</div>}
      </div>
    </section>
    <section className="tool-section"><h3>本地缓存</h3><div className="tool-setting-row"><span className="tool-subtle">{stats ? stats.images + ' 张预览 · 约 ' + bytes(stats.bytes) + ' / ' + bytes(stats.limit) : '正在读取…'}</span><button type="button" className="tool-button" disabled={busy || stats?.bytes === 0} onClick={() => void clear()}>清空缓存</button></div>
      {!!stats?.sites.length && <details><summary>按网站清理</summary><div className="tool-host-list">{stats.sites.map(site => <div key={site.host} className="tool-setting-row"><span title={site.host}>{site.host}<small>{site.images} 张 · {bytes(site.bytes)}</small></span><button className="tool-button" type="button" aria-label={'清理 ' + site.host + ' 缓存'} disabled={busy} onClick={() => void clear(site.host)}>清理</button></div>)}</div></details>}
    </section>
    <section className="tool-section"><h3>照面 Glimpse <small>{chrome.runtime.getManifest?.().version ?? '1.12.0'}</small></h3><div className="tool-links"><button type="button" className="tool-button" disabled={busy} onClick={onShortcuts}>快捷键设置</button><a href="https://github.com/smartai-Labs/Glimpse/blob/main/PRIVACY.md" target="_blank" rel="noreferrer">隐私说明</a><a href="https://github.com/smartai-Labs/Glimpse/issues" target="_blank" rel="noreferrer">反馈问题</a></div><p className="tool-subtle">预览与设置保存在本机。隐身页面不保存预览。</p></section>
  </ToolDialog>;
}
