# Privacy Policy for 照面 Glimpse

**Last Updated:** September 27, 2026

照面 Glimpse ("we", "our", or "the extension") is committed to protecting your privacy. This Privacy Policy explains how we collect, use, and safeguard your data when you use the 照面 Glimpse browser extension.

## 1. Data Collection and Usage

照面 Glimpse is designed to be entirely local to your machine. We **do not** collect, transmit, distribute, or sell any personal data, browsing history, or analytics to any external servers or third parties.

The extension requests specific permissions solely to provide its core functionality:

*   **`tabs` & `activeTab`:** Used strictly to read the URLs, titles, and IDs of your currently open browser tabs so they can be displayed, searched, and managed within the unified overview grid.
*   **`favicon`:** Used locally to retrieve and display the website icons associated with your open tabs, helping with fast visual identification.
*   **`storage`:** Stores a browser-session identifier, screenshot rate-limit timestamp and the last unfiltered overview position in `chrome.storage.session`. Position records contain tab IDs/order, window numbers, a scroll anchor and timestamp, without titles, URLs or search text. They are ignored after 30 minutes and cleared with the browser session. Position recording is disabled while incognito tabs are present. Screenshots themselves are stored in local IndexedDB.
*   **`alarms`:** Schedules recovery checks so thumbnail updates resume after the background worker has been suspended.
*   **`sessions`:** Reads recently closed local session entries to identify a tab closed through 照面 Glimpse and restore that specific entry when you press Undo. 照面 Glimpse does not query synced devices or store a separate browsing-history database. Undo records remain in the open overview's memory for the short undo period (extended while interacting with Undo).
*   **`tabGroups`:** Moves existing tab groups as whole groups when you choose Merge Windows, preserving their names, colors and collapsed state. Ordinary and incognito windows are handled separately. This action does not send group or page information to a server.
*   **`<all_urls>`:** This "broad host" permission is necessary for the Chrome extension API to capture thumbnails and read the titles/URLs of any webpage you visit. This data is never sent off your device.

## 2. Data Storage

照面 Glimpse uses local IndexedDB to cache screenshots captured through `chrome.tabs.captureVisibleTab`. Captures run automatically for eligible visible tabs at browser startup and while browsing, including tab/window changes and loading. A small content script signals visible-page scrolling and clicking; these messages contain only an activity flag, not page text, form values or event details. Recovery checks periodically refresh the focused browser window. Incognito pages are not captured or read from the thumbnail cache.

Optional quick-search suggestions are calculated from currently open tab titles using local word segmentation and phrase statistics. URLs are used only to recognize website suffixes and duplicate pages. This feature does not read page bodies, call a model, send titles to a server, or keep a search history. Candidate words and their cache exist only in the overview's memory and disappear when it closes.

*   **Local Only:** This cached data physically never leaves your browser profile on your personal computer.
*   **Retention:** Closing a tab removes its current-session record. A full-URL fallback may remain for the next browser session and is displayed as a previous preview. Entries expire after 14 days. Periodic pruning targets at most 500 records and a 32 MiB string-data budget; short-lived excess may exist between cleanups. Uninstalling the extension removes its local extension data.

## 3. Third-Party Access

照面 Glimpse does not use any third-party analytics services (like Google Analytics), nor does it include advertising SDKs or tracking pixels. We have no backend servers, and we therefore have no technical ability to share your browsing data.

## 4. Changes to This Policy

We may update this Privacy Policy from time to time if the extension requires new permissions to support new features. Because we do not collect user emails or contact information, it is your responsibility to review this page periodically for any changes.

## 5. Contact

If you have any questions, concerns, or inquiries regarding this Privacy Policy or how 照面 Glimpse handles your data, please open an issue in the [Glimpse repository](https://github.com/smartai-Labs/Glimpse/issues).
