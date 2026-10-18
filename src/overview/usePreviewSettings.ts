import { useEffect, useState } from 'react';
import { DEFAULT_PREVIEW_SETTINGS, PREVIEW_SETTINGS_KEY, readPreviewSettings, normalizePreviewSettings } from '../lib/previewSettings';
export function usePreviewSettings() {
  const [settings, setSettings] = useState(DEFAULT_PREVIEW_SETTINGS), [ready, setReady] = useState(false);
  useEffect(() => {
    let mounted = true, changed = false;
    const update = (changes: Record<string, chrome.storage.StorageChange>, area: string) => {
      if (area === 'local' && changes[PREVIEW_SETTINGS_KEY]) { changed = true; setSettings(normalizePreviewSettings(changes[PREVIEW_SETTINGS_KEY].newValue)); setReady(true); }
    };
    chrome.storage.onChanged.addListener(update);
    void readPreviewSettings().then(value => { if (mounted && !changed) { setSettings(value); setReady(true); } }).catch(() => {});
    return () => { mounted = false; chrome.storage.onChanged.removeListener(update); };
  }, []);
  return { settings, ready, setSettings };
}
