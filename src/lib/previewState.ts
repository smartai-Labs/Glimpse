import type { TabInfo } from './tabManager';
import { canCaptureUrl } from './thumbnailCache';
import { excludedUrl } from './previewSettings';
import type { PreviewSettings } from './previewSettings';

export const PREVIEW_STATE_PREFIX = 'glimpse:preview:';
export interface PreviewState {
  url: string;
  status: 'ready' | 'permission' | 'failed';
  capturedAt: number;
  dirtyAt: number;
  failures: number;
  blockedUntil: number;
}

export function isPreviewState(value: unknown): value is PreviewState {
  if (!value || typeof value !== 'object') return false;
  const state = value as PreviewState;
  return typeof state.url === 'string' && ['ready', 'permission', 'failed'].includes(state.status) &&
    [state.capturedAt, state.dirtyAt, state.failures, state.blockedUntil].every(Number.isFinite);
}

export async function getPreviewState(tabId: number, url: string): Promise<PreviewState | null> {
  const key = `${PREVIEW_STATE_PREFIX}${tabId}`;
  const stored = (await chrome.storage.session.get(key))[key];
  return isPreviewState(stored) && stored.url === url ? stored : null;
}

export function describePreview(tab: TabInfo, state: PreviewState | null, readFailed = false, settings?: PreviewSettings) {
  if (tab.incognito) return { label: '隐身页面', detail: '隐身页面不保存预览' };
  if (!canCaptureUrl(tab.url)) return { label: '不支持预览', detail: '此类页面不自动采集预览，仍可点击卡片切换' };
  if (settings && excludedUrl(tab.url, settings)) return { label: '已排除预览', detail: '此网站不采集、不保存预览，可在设置中移除排除规则' };
  if (settings?.paused) return { label: '预览更新已暂停', detail: '已保留现有预览，可在设置中恢复自动更新' };
  if (tab.status === 'loading') return { label: '页面加载中', detail: '加载完成并浏览后自动更新预览' };
  if (tab.discarded) return { label: '浏览后更新预览', detail: '页面已休眠，切换到页面后会自动更新预览' };
  if (state?.status === 'permission') return { label: '需要访问权限', detail: '请在扩展详情中检查网站访问权限；本地文件还需允许访问文件网址，然后再次浏览页面' };
  if (readFailed || state?.status === 'failed') return { label: '预览暂不可用', detail: '再次浏览时会自动重试，仍可点击卡片切换' };
  return { label: '浏览后生成预览', detail: '切换到页面并浏览后自动生成预览' };
}
