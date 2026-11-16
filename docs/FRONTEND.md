# 修行日記 — Frontend Design

> Status: **agreed 2026-10-14** (F1–F6 accepted). Mockups: the "修行日記 screens" design canvas (link in the PR / ask the author).
> Source of truth for behaviour is `docs/project_prompt.md`; this doc decides *how it looks and is navigated*,
> and lists what each screen needs from the API so `docs/ARCHITECTURE.md` §5/§7 can be revised to match.
> Items marked **F#** need a decision.

## 1. Principles

1. **Phone first for users, desktop first for leaders and admins.** Every screen still works at 360 px.
2. **Readable for older users.** Default text is 18 px, with sizes up to 22 px. Everything is sized in `rem`, so
   the text-size setting and browser zoom scale the whole UI. Nothing breaks at 22 px or 200 % zoom.
3. **Few places to go.** At most 4–5 top-level destinations per role, always visible, with an icon and a text
   label. No hamburger menus and no gestures that are the only way to do something.
4. **One obvious action per screen.** Primary buttons are full width on phones, at least 52 px tall.
5. **Calm and neutral.** A warm paper-and-brown palette in light and dark themes, no decoration, and a serif face
   for diary text so entries read like a journal.
6. **Never lose writing.** A visible save status, autosave, and a warning before leaving with unsaved changes.

## 2. Visual system

### 2.1 Colour tokens

Defined once as CSS custom properties on `:root` and switched by `[data-theme]`, which follows the device unless
the user picks a theme. All text/background pairs meet WCAG AA (4.5:1). Status colours differ in lightness, not
just hue.

| Token | Light | Dark | Use |
|---|---|---|---|
| `--bg` | `#F6F2EC` | `#1A1714` | page |
| `--surface` | `#FFFFFF` | `#24201C` | cards, bars |
| `--surface-2` | `#EFE8DF` | `#2F2A25` | toolbars, table heads |
| `--text` | `#2B2622` | `#EEE7DE` | body |
| `--muted` | `#665C53` | `#B5A99C` | secondary text |
| `--border` | `#D9CEC1` | `#40382F` | dividers, inputs |
| `--primary` | `#7A4E24` | `#D9A36B` | primary buttons, active nav |
| `--on-primary` | `#FFFFFF` | `#1A1714` | text on primary |
| `--primary-soft` | `#F1E6D8` | `#3A2F24` | selected states |
| `--green` / `--green-soft` | `#2F6B3A` / `#E3EFE3` | `#8CC79A` / `#22342A` | Open, success |
| `--amber` / `--amber-soft` | `#8A5300` / `#F7EBD6` | `#E8B465` / `#3A2E1C` | Warnings |
| `--blue` / `--blue-soft` | `#2F5D8C` / `#E2EBF4` | `#8DB4DE` / `#1F2C3A` | comments, info, 報數 progress, auto-submit names |
| `--danger` | `#A63A2A` | `#F09A8A` | delete, logout |
| `--focus` | `#2F5D8C` | `#8DB4DE` | 3 px focus ring |
| `--leader-0`…`5` | `#0F6B6B` `#6B3FA0` `#A3324F` `#2F5D8C` `#4A6A1A` `#9A4A12` | `#6FCFCF` `#C3A3EF` `#F19AB0` `#8DB4DE` `#A8CF73` `#F0A868` | each leader's own colour (D36): name, entry edge, comment cards; 5:1 or more as text on every surface |

### 2.2 Type

- **Fonts are system fonts only.** CJK web fonts run to megabytes and can't come from a CDN (§12.4).
  - UI: `"PingFang TC", "Noto Sans TC", "Noto Sans CJK TC", "Microsoft JhengHei", system-ui, sans-serif`.
  - Diary and comment text: `"Songti TC", "Noto Serif TC", "Noto Serif CJK TC", "PMingLiU", serif`.
  - Linux names its Noto fonts "CJK", hence both names.
  - **In English the Latin system fonts come first** (Segoe UI, Roboto, Noto Sans, Helvetica, Arial… and
    Georgia, Times New Roman, Noto Serif… for diary text), then the Chinese ones for any Chinese characters. A
    Chinese font draws ’ and “ full-width, which is right in Chinese and wrong in English (2026-10-15).
- **Editor font choices** (明體 / 黑體 / 楷體) map to these stacks. 楷體 falls back to the serif stack where a Kai
  font isn't installed, so it may look the same as 明體 on some phones (accepted; noted in the editor help).
- **Scale** (multiples of the user's base size): small ×0.85, base ×1, large ×1.15, title ×1.35, display ×1.75.
- **Text-size setting:** 標準 16 / 大 18 (default) / 特大 20 / 超大 22. It's stored per user on the server and
  cached in `localStorage` so the first paint is right.

### 2.3 Shape and spacing

- Spacing on a 4 px grid. Corner radii: 10 px for inputs, 12–14 px for cards, pill-shaped chips.
- Touch targets are at least 44×44 px; primary actions at least 52 px tall.
- Icons are inline stroke SVGs (24 px grid, 1.8 px stroke) from a small local set. No emoji in the UI, so the
  spec's ✅ ❌ 🔓 ⏳ 🔒 become icons plus text chips.

## 3. Navigation

| Role | Phone (< 768 px): bottom tab bar | Desktop (≥ 1024 px): top bar |
|---|---|---|
| NORMAL_USER | 筆記 · 班級 · 報數 · 我的 | same four, as top links |
| COURSE_LEADER | 批閱 · 筆記 · 班級 · 報數 · 我的 | 批閱 · 我的筆記 · 班級 · 報數 · 我的 |
| SYS_ADMIN | 注意 (badge) · 用戶 (badge) · 筆記 · 報數 · 我的 | 注意 (badge) · 用戶 (badge) · 筆記管理 · 報數 · 我的 (報數管理 is a link on 報數; admins take part in 報數 too) |

- **Names (D38, 2026-11-16):** the screens were 我的日記 and 開放日記; they are now **我的筆記** ("My notes")
  and **班級** ("Class"), and one piece of writing is **一篇筆記** ("an entry"), since leaders' notices are
  written there too. The product keeps its name, 修行日記. These docs and the code still say 我的日記 / 開放日記
  (`MyDiaryScreen`, `OpenDiaryScreen`, `/open`) for the same two screens. The user chose the English; the
  Chinese is waiting for review.
- The tab bar replaces the spec's My Diary / Open Diary toggle and its scattered header buttons (§6.2, §7.4).
  "Go Diary" from the count page is simply the 日記 tab.
- The language switch (spec §10.1) sits top right on every screen and shows every offered language, the one in
  use highlighted (changed 2026-10-15: the content is mostly Chinese either way, so users need to see which is
  on). With three languages it reads 中文 · EN · VI, the full name as each button's tooltip, so it still fits at
  360 px and 22 px text. Vietnamese (D34) is offered ahead of its wording review (changed 2026-11-14).
- Between 768 and 1024 px, the tab bar stays and the leader and admin screens use two panes instead of three.
- Detail screens (editor, entry, comment) replace the tab bar with a back button. The back button and the
  browser/phone back always return to the list you came from, at the same month and scroll position.

## 4. Screens

Each screen lists what it needs from the API. The API column feeds the ARCHITECTURE.md revision.

### 4.1 Login, forgot password (all)

- **Login fields:** username, password (show/hide), CAPTCHA image + 更新 + answer, "記住此裝置" (default
  on), 登入. Signing in lands on the role's diary home.
- **Errors** show inline above the button, and a failed CAPTCHA reloads the image.
- **TOTP step:** if the account needs a second factor (SYS_ADMIN), a second step asks for the 6-digit code.
- **Forgot password:** username, then the confirmation "已經提交給管理員".
- **API:** `GET captcha → {id, svg}`; `POST login → {user, needsTotp?}`; `POST login/totp`;
  `POST forgot-password`.

### 4.2 My diary (users and leaders)

- **Top:** the 撰寫日記 button, full width, then month navigation (« ‹ 2026 年 10 月 › », year jumps at the ends).
- **The month as a continuous feed (2026-10-15, "fewest clicks"):** every entry in full, newest first, each
  with its state chip (草稿・未提交 / 已提交 / 已提交・有未提交的修改), access chip (私人 / 已開放),
  comment count, a small 編輯, its share box and its comments (新 on ones the owner hasn't seen). No
  separate entry page: entries load as they come near the screen, and showing a comment marks it seen.
- **Polling** every 30 s while the screen is visible. New comments raise the toast 有新批注！ and refresh the
  list. Polling stops in editors and background tabs.
- **Empty month:** "這個月還沒有日記" plus the write button.
- **API:** `GET documents/mine?month=` → per entry: `id, title, date, state, access, commentCount,
  hasUnseenComment`. **New:** "unseen" needs a per-owner seen marker (§6).

### 4.3 Editor (users and leaders, own entries)

- **Header:** back, title, and a save status ("已儲存 10:42" / "已發佈 10:42" / "儲存中…" / "未儲存的修改" /
  "離線，稍後再試").
- **Fields:** title, the date shown read-only (set when the entry was created; a short help line explains that
  entries can't be backdated), then a toolbar that wraps on phones (font, paragraph style, size, B, U, 圖片).
- **Body** in the serif face.
- **Image insert:** the picker accepts the photo library and camera. After downscaling (ARCHITECTURE §8.3) an
  info notice reports original → new size and that location data was removed. After the second photo the 圖片
  button is disabled, with the note "每篇最多 2 張相片".
- **Length:** from 4,000 characters a quiet counter appears ("4,200 / 5,000"), turning amber, never red, near the
  limit, with the kindly framed line from spec §5.5. Over 5,000, saving still works; sending and 發佈修改 are
  disabled with the reason.
- **Limits reached:** a notice names the limit and when it resets (midnight Beijing time); the text stays in the
  editor.
- **誰可以閱讀 (D37, replaces the share checkbox and the 提交 button):** three radio choices, side by side
  while they fit: 只有我 / 導師 (其他導師 on a leader's own entry) / 導師和同班學員, with a muted line saying
  what the choice means. A choice takes effect at once: 導師 from 只有我 asks "交給導師閱讀？" and sends the
  writing as it stands; the class asks the share confirmation (and sends first if needed); back to 只有我
  asks "改回只有我？" and is disabled, with the reason, once someone else has commented; class → 導師 needs
  no confirmation. After a leader stops sharing, the class choice is disabled with the reason until a
  發佈修改 that changes the entry. The same control sits under the owner's entry in 我的日記.
- **Voice notes (leaders only, D35):** under the body, a 錄音 button (hidden for students) and the entry's
  notes. Recording opens a sheet with a countdown from 2:00 and a stop button; it stops itself at the limit.
  Then 試聽 / 保留 / 重錄 / 捨棄. 保留 uploads the note at once (creating the entry first if it is new); it
  is heard by others only once the entry is sent or its changes published, and a note added or removed since
  shows a muted 待發佈 / 發佈時移除. After the
  sixth note the button is disabled with "每篇最多 6 段錄音". A refused microphone shows how to allow it.
  A recording not yet kept or discarded counts as unsaved writing (`useReportUnsaved`).
  Notes are recorded as MP3 in every browser (ARCHITECTURE §8.14); 我的 names the encoder (LAME, LGPL) and
  links its source.
- **Sticky bottom bar:** before the entry is sent, 儲存 (primary) and 歷史版本; once sent, 先儲存 (secondary),
  發佈修改 (primary) and 歷史版本. Enable and disable follow spec §5.2 (`editorButtons` in `rules.ts`).
- **History** opens as a bottom sheet (phone) or side panel (desktop) listing the versions, each expandable.
- **Leaving with unsaved changes** shows a confirm dialog. Autosave runs every 5 minutes, plus when the app
  goes to the background (`visibilitychange`), so a phone being locked doesn't lose text.
- **API:** `GET documents/:id` (with draft), `PUT draft`, `POST submit` (send, or publish changes),
  `POST withdraw` (back to 只有我), `GET versions`, `POST access`.
  Limit values come from `shared/src/limits.ts`.

### 4.4 Entry view (owner, leaders, readers of open entries)

- **Read-only:** title, a meta row of values only (date, author for non-owners, access chip, comment count),
  then the body.
- **Translation:** one small button at the right (low-key, 2026-10-15) that translates into the interface language (翻譯成中文 / Translate into English / Dịch sang tiếng Việt; D34, 2026-11-13), with the result shown as plain text below it. When the server
  has no translation provider (`GET /api/me` → `features.translation: false`), the buttons are greyed out.
- **Voice notes (D35):** under the body, one compact player per note (play/pause, elapsed / length). The audio
  downloads only when play is first tapped. Readers hear the submitted notes only.
- **Comments:** the `Comment:` label, then one card per submitted comment (leader name, date, text, its own
  translate buttons), its edge and name in that leader's colour (D36; plain blue for a former leader).
- **Who wrote it (D36):** a leader's entry shows 「name導師」 with a dot, and its body's left edge, in the
  leader's colour. The reader's own entry met outside 我的日記 is tinted (`--primary-soft`) with a 我的 chip.
- **Pinning (D36):** on a leader's own entry, under the share box, 置頂於開放日記 (disabled until shared;
  shown to a former leader only while something is still pinned).
- **Owner actions:** 編輯 (opens 4.3), and 誰可以閱讀 (as in 4.3; from here, sending sends what was last
  saved). Chips: 只有我, or 給導師 / 給導師和同班, plus 有未發佈的修改 while saved changes wait.
- **開放日記 (revised 2026-10-15):** just for reading. One month as a continuous feed of whole entries
  (title, date, author, text, translate, comments, a leader's own included), with no chips, counts, editing
  or sharing controls, the reader's own shared entries included. Filters: a day on the calendar and/or an
  author (those with shared entries that month), kept in the address; beside the feed on wide screens, folded
  under a one-line summary on phones. No page per entry. Unfiltered, a 置頂 section with the leaders' pinned
  entries comes first, above a rule, whatever the month (D36); the month's feed below leaves them out. Stopping sharing happens elsewhere: the owner's
  share toggle, or 取消開放 beside the 已開放 chip in the leaders' review.
- **Visual weight (2026-10-15):** the entry is the most visible thing. Notes (draft, pending changes) are
  muted lines, not boxes; a shared entry has no notice at all (in review, a small 取消開放 beside its chip). Without a translation provider the
  translate buttons are greyed, the reason in their tooltip. Formatting toolbars, translate and stepping use the compact
  size (`--touch-compact`, 40 px at 18 px text); main actions keep 45 / 52 px.
- **Posted comments (2026-10-15):** once submitted, a leader's comment reads like the others, with 編輯 to
  reopen it in the editor (and 取消 to close it again). Drafts and new comments open in the editor.
- **Everything is a continuous feed (2026-10-15):** 我的日記, 開放日記 and 批閱 show whole entries one after
  another, with no page per entry and no one-at-a-time view; filters (month, day, author or student) choose
  what the feed holds. Entries load as they come near the screen, so a leader's read audit only records what
  they reached.
- **API:** `GET documents/open?month=` → `documents` and `pinned`, rows `id, title, diaryDate, author
  {…, leaderColour}, commentCount, pinned`;
  `GET documents/:id` → `view` (`owner` / `leader` / `reader`) + content + submitted comments
  `{id, authorColour, authorName, submittedAt, body}` (`authorName` null for a former leader; the owner also gets `isNew`);
  `POST translate {documentId|commentId, direction}`.

### 4.5 報數 (all)

- **Header:** the logo (400×80 placeholder) and 合計報數.
- **Stats:** one progress card leads. The all-time total is the largest number on the page; under it, a thick
  progress bar; under that, the goal (10,000,000) and the percentage completed side by side, in large type. Below it, a slim "reported today"
  row (sum + number of entries). There is no separate goal tile (agreed).
- **Input card:** 今日報數 with a numeric keypad, a date choice (今天 by default, or one of the previous 4 days,
  shown as chips with day and weekday, "13日 週二", so all five fit one row at full width; 2026-11-16), 提交, and the 自動報數 checkbox with "每天北京時間凌晨 2:00". After 20 reports for
  the chosen date, 提交 is disabled with the reason. Reporting again for a date replaces that day's number
  (say so next to 提交 when the chosen date already has one).
  Trimming and clamping happen as the user types, with the notice in a live region.
- **Latest 20:** on phones this is a list, not a 5-column table. Each row shows name and today's count, then a
  muted line "總計 · 首次 · 最近". Rows alternate colours and auto-submit names are blue (spec §7.1). On desktop
  it's a real table with the spec's columns.
- **Built (2026-10-15):** the logo is a placeholder (`web/src/assets/count-logo.svg`, 400 × 80) to replace with
  the real green artwork. The form starts from the user's saved number; the typed number is saved quietly
  (debounced) for the 02:00 job. Auto-submit users are blue with the word 自動 too.
- **API:** `GET count/summary` (with `mine`: my number and manual reports per allowed date, for the "replaces"
  note and the per-date limit), `GET count/latest`, `GET/PUT count/settings`, `POST count`.

### 4.6 Account (all)

- **Profile:** photo (picked and resized to 300×300 in the browser), name, address, email, 儲存.
- **Appearance:** text size (with a live preview) and theme (淺色 / 深色 / 跟隨裝置).
- **Storage used:** one information row ("已使用 12.4 MB"), no limit or warning.
- **Signed-in devices:** device name from the user agent, "this device" marker, last used, and 登出 for each.
- **Rows:** change password (a sheet), "加到手機主畫面" (the install how-to), 登出.
- **SYS_ADMIN:** an authenticator section.
- **API:** `GET/PUT me` (including `fontSize`, `theme`), `POST me/password`, `GET/DELETE me/sessions`,
  `POST me/totp/*`.

### 4.7 Leader review: 批閱 (revised 2026-10-15)

One tab and one feed of submitted entries, each in full: the text, translate, the other leaders' comments,
and **my comment**. A shared entry shows its 已開放 chip with a small 取消開放 beside it (with a confirm dialog;
**F3**, revised by D29: there is nothing to approve).

- **Filters** (beside the feed from 768 px, folded under a summary line on phones):
  - **未讀 (n):** what this leader hasn't read since it was last submitted (read audit, last 90 days, never their
    own); holds still while reading, pressing it again refreshes.
  - **Calendar:** a day's entries (the default is today, so a leader sees them at once); 20 per page,
    adjustable (spec §6.1).
  - **學員:** search, monthly counts; a student's entries for the calendar's month.
- **My comment:** a small 寫批注 until written; a saved draft opens in the editor (small toolbar, 暫存 /
  提交批注); once submitted it reads like the others, with 編輯 (and 取消) to change it. Changing the filter
  with an unsaved comment asks first.
- **Leaders' own diaries:** under 我的日記, identical to 4.2. They also appear in 批閱 like anyone's, and the
  leader may comment on them there; sharing them uses the owner's share box.
- **API:** `GET leader/calendar?month=` → `{date: count}`; `GET leader/documents?date=&page=&size=`,
  `?user=&month=` and `?unread=true&page=&size=` → per entry `id, title, author, myCommentState,
  otherLeaderCommented, unread, access`; `GET leader/users?month=` → names + counts;
  `GET documents/:id` per entry as it loads; `PUT comments/mine`; `POST access {action: unshare}`.

### 4.8 SYS_ADMIN (desktop first; revised 2026-10-15)

- **注意 (Attention):** its own tab with the open-flag count as its badge. Flags newest first (待處理 /
  已處理 / 全部): username, rule ("已達每日上限", "活動異常頻繁", "多次登入失敗", "一天內多個新裝置"), time, email
  state, and 查看活動 / 登出所有裝置 (confirm) / 鎖定帳戶 (confirm) / 已處理. A status line says whether email
  alerts are on ("電郵通知：未設定" or the recipient count, last send and failures). Below, the **activity
  summary**: per user, today or the last 7 days (entries, submissions, updates, counts) and storage, sortable.
- **Activity:** one user's events (from a flag or the summary) or everyone's, filterable by event, paged;
  times and events only (e.g. "上限：首次提交", "密碼錯誤", the device name).
- **用戶:** search with `?` / `*`, a role filter, and 全部用戶 / **等待重設 (n)**: password resets are a filter
  here, answered on the row with 設定密碼, not a tab of their own (the tab's badge counts them). Table:
  checkbox (students only, never yourself), username, name, role, status chips (等待重設密碼, 已啟用驗證器),
  storage, created, 編輯 / 刪除 (confirm). Batch delete applies to selected students.
- **新增 / 編輯用戶:** role, email, names, address, photo (cropped and resized to 300 × 300 in the browser).
  A new account's password is generated (8 characters, shown once in a dialog with a copy button, before
  anything else happens) or typed. An existing account has **帳戶安全** (設定密碼, 移除驗證器, 登出所有裝置,
  鎖定帳戶) and **刪除帳戶**; the actions on your own account that the server refuses aren't offered.
- **日記管理:** search by username and/or date; the table shows title, date, author and state; delete with
  confirm. Metadata only.
- **報數管理** (a link on 報數): a banner when the latest 02:00 run is missing or failed (its time in Beijing
  time), the recent runs, 立即執行; all users with an auto-submit switch per row, totals, and deleting a user's
  entries (all, or a count-date range; confirm).
- **API:** as in ARCHITECTURE §7.3. User rows need `role, status, totpEnabled, storageBytes, createdAt`.

## 5. Components

`AppShell` (role-aware tabs/top bar), `LanguageToggle`, `Button` (primary / secondary / quiet / danger),
`Chip`, `EntryCard`, `MonthNav`, `Calendar`, `RichEditor`, `SaveStatus`, `Notice`, `Toast` (live region; shows
"錯誤代碼：abc123" on failures), `TranslateBlock`, `CommentCard`, `CommentEditor`, `SegmentedControl`,
`CheckboxRow`, `CountInput`, `StatTile`, `ProgressBar`, `DataTable` (scrolls sideways in its own box),
`ConfirmDialog`, `Sheet` (bottom sheet on phone, side panel on desktop), `InstallHelp`, `EmptyState`,
`ErrorState`.

Every component is built and checked in both themes and at 16 and 22 px. Each one gets a Playwright visual
snapshot at 360 px and 1280 px.

## 6. Implications for the backend (folded into ARCHITECTURE.md §5, §7.3)

1. **Unseen comments:** add `comments.seen_by_owner_at`, set when the owner opens the entry. It drives the
   comment chip and replaces client-side diffing for the 有新批注 toast.
2. **Leader list fields:** `myCommentState` and `otherLeaderCommented` per entry, computed in the list query.
3. **Calendar counts:** a month → per-day count endpoint for submitted entries.
4. **User preferences:** `users.theme` (`light | dark | system`) next to `font_size`.
5. **Device labels:** derived from the user agent at login. No IP geolocation (it would need another
   dependency); the mockup's location text will be dropped.
6. **Monthly counts per user** for the leader's 學員 list.

## 7. Strings and language

- The spec mixes simplified and traditional characters (暂存, 报数, 两次密码输入不同, 翻译, 历史版本,
  有新文档). The zh-Hant table uses traditional throughout: 暫存, 報數, 兩次密碼輸入不同, 翻譯, 歷史版本,
  有新文件 / 有新批注. "攥写日记" in spec §6.2 is a typo for **撰寫日記** (F5, agreed).
- English UI name: **Cultivation Diary** for 修行日記 (agreed). 報數 counts **Great Compassion Mantra** recitations:
  its tab is 大悲咒 / "Mantra" and the page 大悲咒共修報數 / "Great Compassion Mantra recitation" (2026-10-15); 批注 is
  "comment", 導師 is "course leader" ("Leader …" before a name), and 學員 is "student".
- Every string lives in `web/src/i18n/{zh-Hant,en,vi}.ts` (alert emails, written by the server, use
  `server/src/i18n/`; ARCHITECTURE §8.10). Dates use `Intl.DateTimeFormat` with the active locale
  (10月14日 週三 / Wed 14 Oct / Thứ 4, 14 thg 10).
- Vietnamese (draft, for review): 修行日記 Nhật ký tu tập; 大悲咒 Chú Đại Bi, a recitation one *biến*; 批注
  *lời phê*; course leader *người hướng dẫn*; student *học viên*; 我的筆記 *Ghi chép của tôi*; 班級 *Lớp*; an entry *bài*; 批閱 *Duyệt bài*.

## 8. Accessibility checklist

- Real `<button>`, `<a>` and `<label>`/`<input>` elements; icon-only buttons have `aria-label`.
- Focus is always visible (3 px ring), and dialogs trap focus and return it on close.
- Save status, count notices and toasts are announced in `aria-live` regions.
- No information is carried by colour alone; chips always include text.
- Motion is reduced when `prefers-reduced-motion` is set.
- The e2e suite runs axe checks on every screen in both themes.

## 9. Installable app UX

- The diary installs as 修行日記. (The community's 報數 is its own app, 大悲咒共修報數, since 2026-11-16: D39.)
- After the user's third visit on a phone browser that supports installing, a dismissible banner offers
  "加到主畫面" once. The Account page always has the how-to.
- When a new version is ready, a banner at the top offers "新版本可用 — 重新載入". It's never shown while an editor has
  unsaved changes; it waits until they're saved.
- With no connection, the app shell shows "目前離線" instead of the browser's error page. Nothing is written
  offline in v1 (F6, agreed). This is a deliberate simplification: offline writing needs a local queue of
  drafts plus conflict handling when the same entry changed on another device. Add it once the design has
  settled and real use shows people losing connection while writing.

## 10. Frontend libraries (F4, agreed)

| Library | For |
|---|---|
| **TanStack Query** | Everything the screens fetch from or send to the API |
| **Tiptap** (on ProseMirror) | The rich-text editor for diary entries and comments |
| **vite-plugin-pwa** | Manifest + service worker (already in the approved stack) |

Styling uses plain CSS modules plus the custom properties above, with no CSS framework.

### 10.1 Why TanStack Query

The screens need several data behaviours that are easy to get subtly wrong by hand:

- **Polling that pauses.** The spec wants a 30 s check for new entries and comments that never runs in the
  editor (§6.2) and should stop when the app is in the background. TanStack Query does this with a per-query
  `refetchInterval` that is off unless the screen is mounted, and it already pauses when the tab is hidden.
- **Refreshing after a change.** After 提交, the list, the entry and the comment counts must all update. Mutations
  invalidate the affected queries by key, so there is no hand-written "remember to reload X" code to miss.
- **Retries and errors.** Flaky phone connections get automatic, limited retries; failures surface once, with the
  request ID for the error toast (§12.7).
- **No duplicate requests.** Two components asking for the same data share one request and one cache entry.
- **Testability.** Hooks can be tested against a fake API without a browser.

Alternatives considered: **plain `fetch` + React state** would reimplement all of the above, and the old app's
polling and refresh bugs came from exactly that code. **SWR** is similar but smaller; it has weaker support
for mutations and cache invalidation, which this app relies on. **Redux Toolkit Query** is capable but brings
Redux, which nothing else here needs. TanStack Query is about 13 kB gzipped, framework-agnostic in its core, and
the most widely used option, so maintenance risk is low.

### 10.2 Why Tiptap

The editor is the hardest component in the app and the one most likely to lose a user's writing:

- **The old approach is deprecated.** The spec's editor (contentEditable + `document.execCommand`) relies on a
  browser API that is officially deprecated, behaves differently across browsers, and caused the spec's own
  caret-jump bug (§5.2).
- **A document model, not raw HTML.** Tiptap is built on ProseMirror, which keeps a structured document and
  renders it, so loading saved text never moves the cursor, and undo/redo works reliably on phones.
- **Exactly the allowed formatting.** We enable only the extensions the spec lists: paragraph, headings
  H1–H3, bold, underline, font family, font size and image. Pasted content is reduced to that schema, and the
  server's sanitiser uses the same allowlist, so what the editor produces always survives sanitising unchanged.
  This closes the stored-XSS gap in the old app.
- **Images.** A small custom node lets us run the downscaling step (ARCHITECTURE §8.3) on insert, show the
  "picture made smaller" notice, and enforce the size caps before anything is sent.
- **Mobile and CJK input.** ProseMirror handles input methods (IMEs) such as Chinese input correctly, which
  is a well-known weakness of hand-rolled contentEditable editors.

Alternatives considered: **Lexical** (Meta) is good but younger, with fewer ready-made extensions and more of
its own conventions. **Quill** has a fixed model that is harder to restrict to an exact allowlist, and its v2
ecosystem is still settling. **Slate** is flexible but low-level, so we would be writing much of the editor
ourselves. **Plain ProseMirror** is what Tiptap wraps; Tiptap saves a large amount of setup code without hiding
ProseMirror when we need it. Tiptap's core and the extensions we need are MIT-licensed; we use none of its
paid cloud features.

## 11. Decisions

| # | Question | Decision (all agreed 2026-10-14) |
|---|---|---|
| F1 | Tapping an own entry: open the editor directly (spec §6.1) or a read view with 編輯? | **Read view** first, because that's where comments and translations live, and it avoids accidental edits. Since 2026-10-15 the read view is the 我的日記 feed itself, with a small 編輯 on each entry |
| F2 | List style: the spec's table with ✅/❌ and +/− expand, or cards with chips? | **Cards** on phones; leaders and admins keep tables on desktop. The values-only rule still holds |
| F3 | Approving an open request: the spec's checkbox, or explicit 批准開放 / 婉拒 buttons? | **Buttons**, plus the confirm dialog on approve; the current state is shown as a chip. **Superseded 2026-10-19 (D29):** no approval; leaders have only 取消開放, with a confirm dialog |
| F4 | Libraries in §10 | Approve TanStack Query and Tiptap |
| F5 | zh-Hant strings in traditional characters throughout, fixing 攥写 → 撰寫 | Yes |
| F6 | Offline writing (queue drafts while offline) | Not in v1; show an offline notice. Revisit after real use |
