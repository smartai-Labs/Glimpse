# Privacy Policy for 照面 Glimpse

**Last Updated:** October 18, 2026

照面 Glimpse ("we", "our", or "the extension") is committed to protecting your privacy. This Privacy Policy explains how we collect, use, and safeguard your data when you use the 照面 Glimpse browser extension.

## 1. Data Collection and Usage

照面 Glimpse is designed to be entirely local to your machine. We **do not** collect, transmit, distribute, or sell any personal data, browsing history, or analytics to any external servers or third parties.

The extension requests specific permissions solely to provide its core functionality:

*   **`tabs` & `activeTab`:** Used strictly to read the URLs, titles, and IDs of your currently open browser tabs so they can be displayed, searched, and managed within the unified overview grid.
*   **`favicon`:** Used locally to retrieve and display the website icons associated with your open tabs, helping with fast visual identification.
*   **`storage`:** Stores a browser-session identifier, screenshot rate-limit timestamp, per-tab preview state, and the last unfiltered overview position in `chrome.storage.session`. Preview state contains the current URL, capture/activity timestamps, failure count and retry cooldown, so unnecessary captures and repeated failures can be avoided across background-worker restarts. It excludes incognito pages, is removed when a tab closes, and is cleared with the browser session. Position records contain tab IDs/order, window numbers, a scroll anchor and timestamp, without titles, URLs or search text. They are ignored after 30 minutes and cleared with the browser session. Position recording is disabled while incognito tabs are present. Card density (standard or compact), the hover-enlargement preference, the automatic-preview pause switch, and the exact list of excluded website hostnames are stored in chrome.storage.local until changed or the extension is removed. Exclusions contain hostnames only, not URL paths or titles. Screenshots themselves are stored in local IndexedDB.
*   **`alarms`:** Schedules recovery checks so thumbnail updates resume after the background worker has been suspended.
*   **`sessions`:** Reads recently closed local session entries to identify a tab closed through 照面 Glimpse and restore that specific entry when you press Undo. 照面 Glimpse does not query synced devices or store a separate browsing-history database. Undo records remain in the open overview's memory for the short undo period (extended while interacting with Undo).
*   **`tabGroups`:** Moves existing tab groups as whole groups when you explicitly move selected pages or merge selected windows, preserving their names, colors and collapsed state. Ordinary and incognito windows are handled separately. This action does not send group or page information to a server.
*   **`<all_urls>`:** This "broad host" permission is necessary for the Chrome extension API to capture thumbnails and read the titles/URLs of any webpage you visit. This data is never sent off your device.

## 2. Data Storage

照面 Glimpse uses local IndexedDB to cache screenshots captured through `chrome.tabs.captureVisibleTab`. Captures run automatically for eligible visible tabs at browser startup and while browsing, including tab/window changes and loading. A small content script signals visible-page scrolling and clicking; these messages contain only an activity flag, not page text, form values or event details. Recovery checks run every five minutes for the focused normal browser window. Unchanged, recently captured pages are skipped; page activity can request an earlier update, subject to per-tab and global limits. Permission failures and repeated transient failures use bounded retry cooldowns. Incognito pages are not captured or read from the thumbnail cache.

Recent-use ordering reads the last-access timestamp supplied by the browser when available and keeps a snapshot only in the open overview’s memory. This ordering and these timestamps are not saved as a separate browsing history. Pinned, audible/muted and discarded states are used for local visual cues and duplicate-page retention suggestions. Duplicate candidates are grouped by the full URL within the same privacy context, including query strings and fragments. These candidates are kept only in the open overview’s memory; pages are closed only after the user reviews and activates the close action.

Optional quick-search suggestions are calculated from currently open tab titles using local word segmentation and phrase statistics. URLs are used only to recognize website suffixes and duplicate pages. This feature does not read page bodies, call a model, send titles to a server, or keep a search history. Candidate words and their cache exist only in the overview's memory and disappear when it closes.

*   **Local Only:** This cached data physically never leaves your browser profile on your personal computer.
*   **Retention:** Closing a tab removes its current-session record. A full-URL fallback may remain for the next browser session and is displayed as a previous preview. Entries expire after 14 days. Screenshots are stored as Blob objects referenced by separate tab/URL indexes. Pruning targets at most 500 images and approximately 32 MiB of image bytes plus estimated index size. Temporary transaction space and browser database overhead are not included in the estimate. Old string-based records are migrated in bounded batches; the old records remain readable if a migration write fails. Uninstalling the extension removes its local extension data.

Preview controls are available in Settings. Pausing automatic updates keeps existing previews. Adding an exact hostname to the exclusion list stops capture and removes saved previews for that hostname; subdomains must be listed separately. Incognito pages remain excluded regardless of these switches. Cache management can delete all saved previews or previews for one website. Clearing the cache does not close tabs or delete the exclusion list; subsequent eligible browsing can rebuild images. In-flight captures are invalidated when changing capture policy or clearing cache.

A screenshot may contain information visible in the page at the time it is captured. The content script does not inspect or transmit page text or form values. Screenshots themselves are never uploaded by the extension. If the browser’s local favicon lookup fails, the overview may load the site’s favicon URL, which can create a normal image request to that site.

## 3. Third-Party Access

照面 Glimpse does not use any third-party analytics services (like Google Analytics), nor does it include advertising SDKs or tracking pixels. We have no backend servers, and we therefore have no technical ability to share your browsing data.

## 4. Changes to This Policy

We may update this Privacy Policy from time to time if the extension requires new permissions to support new features. Because we do not collect user emails or contact information, it is your responsibility to review this page periodically for any changes.

## 5. Contact

If you have any questions, concerns, or inquiries regarding this Privacy Policy or how 照面 Glimpse handles your data, please open an issue in the [Glimpse repository](https://github.com/smartai-Labs/Glimpse/issues).
