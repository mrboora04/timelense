# TimeLens

**See where your browsing time goes, and catch the moment you drift into doomscrolling.**

TimeLens is a small Chrome extension (about 32 KB gzipped, no dependencies at runtime). It shows a live timer for the site you're on, sorts your day into categories, and draws a timeline of every time you slid from work into distraction, with Lens the mascot keeping you company. Like Android Digital Wellbeing, it can also give a site a daily timer and pause distracting sites with Focus mode. It runs 100% locally: data lives in `chrome.storage` on your PC and is never sent anywhere.

- **Popup:** Lens the mascot, today's total, a category breakdown and the site you're on, with a live timer.
- **Side panel:** today's total with the change vs yesterday, the site you're on, your drift timeline, and (collapsed) every site today and your categories. At the bottom, **Usage** works like iPhone Screen Time or Android Digital Wellbeing: a Day / Week switch, ‹ › back through the last 30 days, columns split into focus, distracting and other by hour or by day, your daily average, and your most used sites. Tap a site for its own detail: its daily average over the last week, a 7-day chart, its visits and the hour you usually use it.
- **Site timers and Focus mode:** a daily timer on any site, set in its row under Sites, and a Focus mode switch that pauses distracting sites, with 5, 15 or 30 minute breaks.
- **Lens:** a small mascot whose face and message follow your state: waving, happy, proud of a focus streak, curious when you wander, worried when you're doomscrolling, asleep when paused.

## Design
Minimal and black and white. The side panel leads with one number (today's total), then the site you're on and your drift. Everything else sits in collapsed sections. Colour is used only for status: green while tracking, amber for drift, red for delete. Categories are shades of grey, and every chart has a text alternative for screen readers. The design follows a skills library: design-critique, accessibility-review (WCAG 2.1 AA), ux-copy, theming-components, designing-layouts and the character-animation skills. See `docs/ui-audit.md` for the before-and-after.

## Drift
TimeLens records the order you move between sites (`trail`, kept for 2 days). A **drift** is 5+ minutes on distracting sites (Social, Entertainment, News, Shopping), whether you left a focus site (Work, Learning) for it or started the day there. It ends when you're back on a focus site or after a 10-minute break. The side panel shows a strip of today's path and a timeline of each drift: when it started, the chain of sites, how long it lasted, and whether you came back. While a drift is happening, Lens reminds you where you left off. There are no pop-up notifications.

## Site timers and Focus mode
These work like Android Digital Wellbeing's app timers and Focus mode.

- **Site timer:** open **Sites** in the side panel and press a site's **Timer** button to pick 15 min, 30 min, 1 h, 2 h or any number of minutes. A timer on `youtube.com` also covers `m.youtube.com`. When the time runs out the site is paused for the rest of the day: open tabs move to a TimeLens paused page and new visits are blocked. Timers reset at midnight. Choosing **No timer** (or **Remove the limit** on the paused page) unpauses the site straight away.
- **Focus mode:** turn the switch on to pause every site in the categories you pick (Social, Entertainment, News and Shopping by default). **Take a break** lifts it for 5, 15 or 30 minutes, after which it turns itself back on.

Blocking uses Chrome's `declarativeNetRequest` permission, so the install warning says **"Block content on any page"**. TimeLens only adds rules that cancel page loads for the sites you paused; Chrome applies them locally, and TimeLens gets no access to page content and asks for no host permissions. The paused page is part of the extension, so nothing leaves your PC. Sites that TimeLens only knows by a guess (not in the built-in lists or your picks) are caught when their tab opens instead of by a rule.

## Categories
About 250 sites are built in, including popular Indian sites. Unknown sites are guessed from their name: `.edu` and `.ac.in` → Learning, names with "news" → News, "shop" or "store" → Shopping, `localhost` → Work, and so on. Anything else is Other. Your own picks always win.

## Install (developer mode)
1. Open `chrome://extensions` and turn on **Developer mode**.
2. Click **Load unpacked** and pick this folder, or the minified `dist/` folder (see Build).
3. Pin TimeLens from the puzzle-piece menu. Requires Chrome 116 or later.

## Build (minified)
```bash
npm install
npm run build
```
This writes a minified copy to `dist/` (about 74 KB, down from 106 KB, icons included; 32 KB gzipped). Load `dist/` in Chrome, or zip its contents for the Chrome Web Store. The source stays readable; only `dist/` is minified. `npm run test:dist` builds and runs the test suite against `dist/`.

## How time is counted
Time counts while **a website is the active tab in the focused Chrome window** and you are **active**: input within the last 60 seconds, or the tab is playing sound (video, call). A tab playing sound (music, a video) also counts while another app is in front; it's marked as background time and never counts as a drift. Otherwise switching to another app, locking the screen or going idle pauses the timer. The background worker saves the elapsed time every minute. A gap longer than 2 minutes (for example the PC slept) is capped instead of credited in full.

A **visit** is counted when you land on a different site or tab. Returning to the same tab, or moving around inside one site, is not counted as a new visit.

## Files
| File | What it does |
|---|---|
| `manifest.json` | Extension config (Manifest V3) |
| `background.js` | Service worker: decides what's being tracked, saves time, applies site timers and Focus mode |
| `lib.js` | Shared logic: categories, drift detection, Lens's moods, formatting (used everywhere) |
| `usage.js` | The Usage day / week view at the bottom of the side panel |
| `ui.js` | Shared UI: category buttons, the "now" row, charts with text alternatives, drift timeline |
| `lens.js` | Lens the mascot: rig data, pose library, mood transitions |
| `popup.html/js` | Toolbar popup |
| `panel.html/js` | Side-panel dashboard |
| `blocked.html/js` | The paused page shown in place of a site whose timer ran out or that Focus mode pauses |
| `styles.css` | Styles for both, built entirely on design tokens |
| `build.mjs` | Minified build into `dist/` |
| `docs/ui-audit.md` | Design, accessibility and copy audit behind the v1.3 redesign |

## Data (in `chrome.storage.local`)
- `pages`: one page you visited per site, only so the icon lookup asks Chrome's local icon cache with an address it has an icon for
- `v1`: `{ "YYYY-MM-DD": { domains: { "github.com": { s: seconds, v: visits } }, hours: [24 × seconds] } }`, last 30 days
- `trail`: `{ "YYYY-MM-DD": [{ d: "github.com" or null (paused), t: ms }] }`, last 2 days, for drift detection
- `catList`, `catMap` (your per-site picks), `catAlias` (category renames), `seen`
- `limits`: `{ "youtube.com": seconds a day }`, your site timers
- `focus`: `{ on, cats: [categories it pauses], breakUntil: ms or null }`

Use **Export JSON** in the side panel to back it up.

## Tests
```bash
npm test
```
The tests run `background.js`, `lib.js` and `lens.js` (rig and pose checks) against a fake `chrome` API (`test/fake-chrome.js`). Node 18+ needed; there are no dependencies.
