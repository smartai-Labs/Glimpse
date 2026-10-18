export const PREVIEW_SETTINGS_KEY = 'glimpsePreviewSettings';
export interface PreviewSettings { paused: boolean; excludedHosts: string[]; hoverPreview: boolean }
export const DEFAULT_PREVIEW_SETTINGS: PreviewSettings = { paused: false, excludedHosts: [], hoverPreview: true };

/** Exact host matching, including subdomains only when explicitly listed. */
export function normalizeHost(input: string): string | null {
  try {
    const raw = input.trim();
    if (!raw || /[\s*]/.test(raw)) return null;
    const url = new URL(raw.includes('://') ? raw : 'https://' + raw);
    return ['http:', 'https:'].includes(url.protocol) && url.hostname && !url.username && !url.password ? url.hostname.toLowerCase() : null;
  } catch { return null; }
}
export function cacheHost(url: string): string {
  try { const parsed = new URL(url); return parsed.protocol === 'file:' ? '本地文件' : parsed.hostname.toLowerCase(); }
  catch { return ''; }
}
export function normalizePreviewSettings(value: unknown): PreviewSettings {
  const data = value && typeof value === 'object' ? value as Partial<PreviewSettings> : {};
  return { paused: data.paused === true, hoverPreview: data.hoverPreview !== false,
    excludedHosts: [...new Set((Array.isArray(data.excludedHosts) ? data.excludedHosts : [])
      .filter((host): host is string => typeof host === 'string').map(normalizeHost).filter((host): host is string => !!host))].slice(0, 500) };
}
export function excludedUrl(url: string, settings: PreviewSettings): boolean { return settings.excludedHosts.includes(cacheHost(url)); }
export async function readPreviewSettings(): Promise<PreviewSettings> {
  const stored = await chrome.storage.local.get(PREVIEW_SETTINGS_KEY);
  return normalizePreviewSettings(stored[PREVIEW_SETTINGS_KEY]);
}
export async function previewCommand<T = void>(action: string, payload: Record<string, unknown> = {}): Promise<T> {
  const result = await chrome.runtime.sendMessage({ type: 'glimpse:preview-control', action, ...payload });
  if (!result?.ok) throw new Error(result?.error || '操作未完成，请重试。');
  return result.value as T;
}
