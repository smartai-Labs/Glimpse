# 照面 Glimpse

<p align="center">
  <img src="public/glimpse-logo.svg" alt="照面 Glimpse Logo" width="128" />
</p>

**看一眼，找到熟悉的页面。**

照面 Glimpse 是一款轻量的浏览器标签页工具。通过缩略图总览、快捷搜索和窗口筛选，快速找到、切换和整理散落在不同窗口里的页面。

A lightweight visual tab finder for your browser. Preview, search, switch, and organize open tabs across windows.

## ✨ Features

- **Visual Overview:** Instantly see all your open tabs across all browser windows in a clean, responsive grid layout.
- **Automatic thumbnails:** Starts with the browser and refreshes previews as you switch tabs/windows, finish loading pages, click or scroll. New captures update an already-open overview automatically.
- **Lightning-Fast Search:** Use fuzzy search to instantly filter tabs by title or URL. Just start typing!
- **Keyboard-First Navigation:** Navigate the grid with arrow keys, hit `Enter` to switch, or `Escape` to close. Typing starts a search, and IME composition does not trigger navigation.
- **Remember your place:** Returns to the saved browsing position, or brings the active tab into view, without adding a persistent highlight border.
- **Tab Management:** Close unwanted tabs directly from the interface without losing your place.
- **Website filters:** Filter tabs by hostname, with counts and a window number on each card. Only the `www.` prefix is normalized; other subdomains remain separate.
- **Immediate, smooth enlargement:** Cards scale in place as soon as the pointer enters. The previous card shrinks while the next grows, including cards without a saved thumbnail. The hit area stays fixed, and reduced-motion preferences are respected.
- **Dark appearance:** Original charcoal surfaces with neutral highlights. Large tab collections remain virtualized.
- **Stable cards and window filters:** Existing tabs keep their order while the overview is open. Click a card's window number to narrow the grid; window and website filters work together.
- **Undo close:** A compact footer offers undo for tabs closed from 照面 Glimpse, prioritizing the exact Chrome session when available.

## 🖼️ Screenshots And Demo

![照面 Glimpse 总览](docs/glimpse-overview.png)

当前界面预览，使用模拟标签数据；示例中的页面尚无缩略图缓存。



## ⌨️ Shortcuts

- **Summon & Dismiss:** `Command+Shift+.` (Mac) / `Ctrl+Shift+.` (Windows/Linux). *Press once to reveal your digital workspace. Press again to seamlessly glide back to your active tab.* You can also set your own custom shortcut for opening and closing 照面 Glimpse.
- **Navigate Grid:** Arrow Keys (`↑`, `↓`, `←`, `→`)
- **Switch to Tab:** `Enter` or a single click on any card.
- **Close Tab:** Mouse hover + click the `X` button
- **Global Search:** Begin typing anywhere to instantly focus the search bar

> [!TIP]
> You can manually customize or fix these shortcuts — including the one for opening and closing 照面 Glimpse — by navigating to `chrome://extensions/shortcuts` in your browser, or by clicking the redirect icon in 照面 Glimpse window.


## 🚀 Installation & Development

照面 Glimpse is built as a highly optimized Vite extension project using React and TypeScript.

### Prerequisites

- [Node.js](https://nodejs.org/) installed
- npm or yarn

### Local Setup

1. **Clone this repository and open the project folder:**
   ```bash
   git clone https://github.com/smartai-Labs/Glimpse.git
   cd Glimpse
   ```

   For an existing local installation, keep using its current folder and `dist` path when reloading the extension.

2. **Install dependencies:**
   ```bash
   npm install
   ```

3. **Build the extension:**
   ```bash
   npm run build
   ```

4. **Load into Google Chrome / Edge / Brave:**
   - Open your browser and navigate to `chrome://extensions/`
   - Enable **Developer mode** using the toggle in the top right corner.
   - Click **Load unpacked** in the top left.
   - Select the `dist` folder located in the project directory.

### Packaging for Distribution

If you want to create a shareable `.zip` file that others can install via "Load unpacked", we provide a convenience script that automatically builds and zips the project.

Run the following command from the project root:
```bash
sh build_and_pack.sh
```
This will generate a `glimpse-extension.zip` file ready to be shared.

## 🛠️ Tech Stack

- **Framework:** React 19 + TypeScript
- **Build Tool:** Vite
- **Styling:** Tailwind CSS + Lucide React icons
- **Animations:** Framer Motion
- **Search Engine:** Fuse.js
- **Performance:** `react-window` for virtualized grid rendering (handles hundreds of tabs smoothly)

## 🤝 Contributing

Contributions, issues, and feature requests are always welcome! Report bugs or suggest features in [Glimpse Issues](https://github.com/smartai-Labs/Glimpse/issues), or submit a pull request to [smartai-Labs/Glimpse](https://github.com/smartai-Labs/Glimpse).

## 🔒 Privacy Policy

照面 Glimpse respects your privacy. All processing and thumbnail generation happens locally on your machine. No browsing data, history, or personal information is ever collected, transmitted, or sold.

Read the full [Privacy Policy](PRIVACY.md).

## Local interface update / 本地界面更新

界面采用炭灰背景、原位平滑放大、域名筛选和单击切换。未缓存缩略图的标签显示网站图标与域名，预览缺失原因在悬停时显示，也支持相同的放大效果。

更新后运行 `npm run build`，然后在 `chrome://extensions` 中找到 照面 Glimpse 并点击“重新加载”。首次安装时启用开发者模式，选择“加载已解压的扩展程序”，并选中本项目的 `dist` 文件夹。关闭旧的 照面 Glimpse 总览窗口，再用快捷键重新打开。

### 自动维护缩略图（1.2.0）

- Chrome 120 及以上。安装或启动浏览器后自动开始工作，无需先打开总览；后台允许休眠，由浏览器事件和每 30 秒的恢复检查唤醒，不通过常驻循环保活。
- 切换标签、切换窗口、页面加载完成及网址变化后更新；普通网页的滚动与点击会合并为低频更新请求，滚动时不会逐帧截图。没有页面活动时，定时检查只刷新当前聚焦的普通浏览器窗口。
- 更新前已经打开的网页，刷新一次可启用滚动/点击触发；未刷新的网页仍通过切换事件和定时检查更新。
- 只截图已显示、已加载的普通网页，不自动切换标签、不唤醒被丢弃的后台页面。首次安装时，未浏览过的标签可能暂时没有截图。浏览器内部页面等不支持自动预览；本地文件需要在扩展详情中允许文件网址访问。隐身页面不保存截图。
- 每个标签页独立保存本次浏览的预览，截图前后核对标签、网址和窗口，快速切换时丢弃过期结果。截图写入后即时通知总览更新。
- 浏览器重启后，可以按完整网址显示上次浏览的截图，并标注“上次浏览”；旧截图可能不反映页面当前状态，重新浏览后替换。不会将本次会话另一个同网址标签的截图误用为当前标签截图。
- 截图仅保存在本地 IndexedDB。缓存最长保留 14 天，定期清理至最多 500 条记录及约 32 MiB 字符数据预算（两种索引可能各保存一条记录，清理间隔内会短暂超过目标）；关闭标签会移除其会话记录，网址回退缓存保留至到期或淘汰。
- 截图请求串行处理，相邻调用至少间隔 650 毫秒。失败最多连续重试两次；之后由后续浏览或恢复检查再试。

### 更方便地查找和撤销（1.3.0）

- 总览打开期间保留已有标签的相对顺序，只更新标题、缩略图等内容；新标签追加到末尾，关闭后移除。搜索也沿用这份顺序。重新打开总览时才按浏览器当前排列初始化；筛选、关标签和调整窗口大小仍会正常改变布局。
- 窗口编号在本次总览中固定，关闭其他窗口不会导致编号重排。点击卡片上的“2 窗”可筛选该窗口；顶部“窗口 2 ×”可取消窗口筛选，“全部”清除窗口与网站筛选，搜索词保持不变。
- 关闭后底部提供 10 秒“撤销”入口，连续关闭可依次撤销（最多保留 10 条未过期记录）。鼠标停留或键盘聚焦撤销区域时暂停消失，离开后至少再保留 5 秒。仅作用于当前总览内主动关闭的标签。
- 撤销需要新增的 `sessions` 权限，优先恢复匹配的 Chrome 会话，不会直接恢复“最近一个”无关标签。如果会话无法确认，则仅重新打开原网址，并提示未恢复历史或未提交内容；已被其他操作恢复的已知会话不会重复创建。

### 关闭标签兼容性修复（1.3.1）

- 撤销会话接口缺失、报错或超时时，仍可正常关闭标签；关闭后的记录读取失败也不会误报关闭失败。无法取得会话记录时，撤销仅重新打开原网址。
- 浏览器实际拒绝关闭时保留卡片并提示错误；重试成功后清除旧提示。更新后在扩展管理页重新加载 照面 Glimpse，并关闭旧总览再打开。

### 卡片按钮跟随放大（1.3.2）

- 关闭按钮和窗口筛选按钮与卡片共用放大动画，位置与点击区域同步移动；窗口标记改为“窗口 1”等完整文字。
- 连续划过预览仍按原网格切换；向放大后的按钮移动时保留当前卡片，避免按钮躲开鼠标。直接点击未放大卡片上的窗口按钮不会先移动按钮。

### 简化筛选栏和底部显示（1.3.3）

- 网站筛选栏隐藏滚动条，超出宽度时支持鼠标滚轮横向浏览，也保留触控板与键盘访问。
- 移除底部常驻的操作说明和快捷键提示，关闭后的撤销入口及操作结果仍按需显示。

### 更轻的缩略图总览（1.4.0）

- 搜索靠左，与标签数量和简化为图标的快捷键入口放在同一行；网站筛选独占下一行，降低顶部高度。
- 减薄卡片标题区、收敛圆角和阴影，保留原有炭灰配色和即时放大动画。
- 无预览卡片显示网站图标与域名，预览缺失原因改为悬停提示。
- 底部不再预留空白；撤销与操作结果按需浮现，不挤动卡片网格。

### 更快找到页面（1.5.0）

- 搜索结果按匹配程度排序，标题匹配优先；输入关键词后默认选中第一项，按 Enter 直接定位。未搜索时维持卡片原有相对顺序。
- Esc 依次清空搜索词、清除网站/窗口筛选，最后才关闭总览；长按不会连续越过这些步骤。原来的总览快捷键仍可直接关闭。
- 在同一次浏览器会话中，30 分钟内重新打开总览会恢复未筛选时的卡片顺序、窗口编号和浏览位置；已关闭标签跳过，新标签追加。重新打开时搜索和筛选清空，所有页面都可查找。
- 浏览位置只在 `chrome.storage.session` 保存标签 ID、窗口编号、滚动锚点和时间，不保存搜索词、标题或网址；存在隐身标签时不记录本次位置。超过 30 分钟的记录不再用于恢复，浏览器重启后清除。
- 网站分类在总览打开期间固定顺序，数量变化不会让按钮换位；选中的分类自动保持可见。

### 从标题生成快捷搜索词（1.6.0）

- 搜索框为空并获得焦点时，浮现最多 8 个快捷搜索词；输入文字、点击外部或按 Esc 可收起，不占用卡片布局空间。
- 词来自当前所有标签的标题，使用浏览器本地分词和相邻词组统计生成，不预定义主题、不调用模型或外部服务。网址仅用于网站后缀识别和页面去重，不作为关键词内容来源。
- 过滤通用词、通知数量和重复网站后缀；相同标题/页面不会重复增加权重。合并经常一起出现的词，保留如 Claude Code、GPT-5.2、浏览器插件等完整形式。按覆盖度、词组完整度和多样性选词，候选不足时少显示。
- 点击搜索词会清除网站/窗口筛选，在全部标签中搜索；继续按 Enter 才打开结果。空搜索框按下箭头可选择搜索词，左右箭头切换、上箭头返回输入框；中文输入法确认不会误触搜索词。
- 显示中的词保持顺序；重新聚焦、点击空搜索框或手动清空输入时，按最新标题刷新。仅缩略图或激活状态变化时复用计算结果。候选和缓存仅保留在总览内存中。
- 提取器独立于界面，后续可以替换建议词来源以接入模型。当前版本对少见词和语义归类仍有局限，未强制生成主题名称。

### 常驻快捷搜索词与边框修复（1.6.1）

- 快捷搜索词直接显示在输入框右侧，不需要先激活搜索框，输入或点击其他区域后仍可使用；搜索框在常规窗口下缩短至 240px。
- 标题变化后自动更新搜索词，保留仍有效词的相对顺序。宽度不足时可通过鼠标滚轮、触控板或键盘横向浏览，不显示滚动条。输入框按 Tab 进入搜索词，左右箭头切换，上箭头返回输入框；输入框按下箭头直接进入卡片。
- 去掉默认选中、搜索结果或恢复位置产生的常驻卡片亮边框。方向键导航时仅用标题区底色提示当前位置，鼠标操作后消失；保留键盘 Tab 聚焦的可访问性提示。

### 多选关闭与窗口合并（1.7.0）

- 网站筛选栏右侧新增“多选”和“合并窗口”两个入口。多选时点击卡片或左上角勾选框选中页面，不会打开页面；不添加常驻的卡片高亮边框。
- “全选结果”选择当前搜索和筛选下的全部页面，包括尚未滚动到的卡片。“关闭所选”只处理点击时选中的页面，更改搜索或筛选会清空勾选；部分关闭失败时保留失败项，可再次操作。关闭完成后工具栏保持原位，点击“取消”退出，避免连续点击误触其他功能。
- 每次批量关闭作为一条撤销操作，点击“撤销本次”依次恢复这批标签。最多保留 10 次未过期操作；恢复能力仍受 Chrome 最近关闭记录的可用性限制，过期或被其他操作恢复的已知记录不会重复创建。操作完成后保留 10 秒撤销时间，悬停时暂停计时。
- 多选模式下方向键移动、空格勾选、Ctrl/Cmd+A 全选当前结果，Esc 先退出多选；在搜索框中保留正常的输入和文字全选行为。
- “合并窗口”处理所有普通浏览器窗口中的页面，不受当前搜索或网站筛选限制。合并到最近使用的同类窗口，普通与隐身窗口分别处理；扩展总览和弹出窗口不会成为合并目标。直接移动已有页面，不关闭后重新打开。
- 固定标签继续保留固定状态，已有标签组整体移动。为此新增 `tabGroups` 权限，使用 [Chrome 官方标签组移动接口](https://developer.chrome.com/docs/extensions/reference/api/tabGroups#method-move)。合并失败的标签仍留在原处并显示数量，可重试；成功合并后不会自动拆回原窗口。

### 炭灰缩略图画廊（1.8.0）

- 搜索框宽度调整为 230px，右侧常驻快捷词。根据可用宽度显示最多 5 个词，其余放入“更多”菜单，不再横向滚动；菜单支持方向键、Home/End、Enter 和 Esc，点击外部或移开焦点可收起。
- 网站筛选使用轻量文字和底部短线，操作按钮保持在右侧。预留多选工具栏宽度，进入多选时网站栏和卡片位置不变；批量操作进度浮在底部，不挤动网格。
- 缩略图统一为 12px 圆角，标题区融入炭灰背景，减轻厚重底板；普通卡片没有常驻亮边框，仅悬停时出现柔和阴影。
- 无预览时直接显示网站、最多两行页面标题和简洁状态，区分暂无预览、隐身页面和不支持预览，方便辨认。
- 保留原有即时 240ms 平滑放大、跟随卡片移动的操作按钮、虚拟列表、搜索与多选逻辑。窄窗口将操作区换行，键盘聚焦继续保留可见提示。

### 快捷词布局修复（1.8.1）

- “更多”菜单紧贴按钮下方展开，窗口缩放时同步定位，靠近屏幕边缘时自动避让，修复宽屏下菜单远离按钮的问题。
- 按搜索栏实际剩余宽度显示快捷词，取消最多 5 个的限制；只有放不下的词才进入“更多”，空间足够时隐藏该按钮。

### 更名为照面 Glimpse（1.9.0）

- 中文名为「照面」，英文名为「Glimpse」，完整显示名为「照面 Glimpse」。扩展名称、工具栏悬停提示、快捷键说明、总览标题、错误提示与项目文档统一使用新名称。
- npm 项目名改为 `glimpse`，图标源文件改为 `public/glimpse-logo.svg`，打包脚本输出 `glimpse-extension.zip`。
- 在原来的 `dist` 路径重新加载扩展即可更新。沿用旧缓存键、会话键及后台通信标识，保持现有缩略图、总览位置和已注入页面的兼容性；本地项目目录仍保留 `mosaic`，避免因加载路径变化生成另一份扩展。

### Validation

Run `npm run build` and `npm run lint`. The browser regression test runs the production bundle in an isolated headless Chrome with simulated Chrome tab/window APIs and a local IndexedDB thumbnail fixture:

```sh
node tests/overview.browser.cjs
node tests/background.cjs
node tests/interactions.cjs
node tests/overviewMemory.cjs
node tests/titleKeywords.cjs
node tests/batchActions.cjs
```

The browser test requires Playwright and Chrome. If Playwright is already installed elsewhere, set `MOSAIC_PLAYWRIGHT_PATH` to its package directory. Tests do not access or change your real browser tabs. Coverage includes hover reversal, fixed hit areas, missing previews, viewport edges, switching, filters, keyboard/IME, stale/live thumbnails, virtualization, responsive layouts, reduced motion, same-URL cache isolation, restart fallback, image resizing in an actual service worker, expiry and eviction. The background test uses a deterministic clock and simulated Chrome APIs to check startup, capture limits, retries, navigation races, worker restart, and page-activity throttling.

Interaction tests additionally check stable ordering/window labels, combined filters, undo timing, exact-session matching, concurrent closes, expired sessions, last-window recovery and safe URL fallback. Close regressions cover missing, throwing, rejected and timed-out session APIs, post-close metadata failures, and successful retries after a browser close failure.

Search/navigation checks cover ranked results, Enter selection, staged Escape without key-repeat exit, stable website filters and reopening after a window switch. Position checks cover closed/new tabs, resized or missing anchors, expired/malformed records and unavailable storage.

Keyword checks cover dynamic Chinese/English phrases, unfamiliar names, punctuation/fullwidth variants, duplicate weighting, learned website suffixes, empty states and caching. Browser checks exercise mouse/keyboard selection, IME, global search from an existing filter, stable visible suggestions, updated titles and narrow windows.

Batch checks cover selection scopes, offscreen selection, keyboard controls, duplicate activation, partial close failures and grouped undo. Merge checks cover destination selection, pinned positions, whole groups, separate incognito windows, excluded extension/popup windows, partial failure, missing permissions and repeat operations. These use simulated Chrome APIs and do not move or close real browser tabs.

## 项目来源

照面 Glimpse 基于 [Mosaic](https://github.com/samirpatil2000/mosaic) 修改，保留对原项目及其作者的致谢。上游仓库用于说明项目来源；本文档描述的是当前照面 Glimpse 版本。

## 📝 License

This project is open-source and available under the [MIT License](LICENSE).
