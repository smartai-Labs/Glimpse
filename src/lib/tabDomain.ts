export function tabDomain(url: string): string {
  try {
    const parsed = new URL(url);
    if (parsed.protocol === 'file:') return '本地文件';
    if (parsed.protocol === 'chrome:' || parsed.protocol === 'edge:') return '浏览器页面';
    return parsed.hostname.replace(/^www\./, '') || parsed.protocol.replace(':', '');
  } catch {
    return '其他页面';
  }
}
