# TimeLens

**See where your browsing time goes, and catch the moment you drift into doomscrolling.**

TimeLens is a small Chrome extension (about 26 KB gzipped, no dependencies at runtime). It shows a live timer for the site you're on, sorts your day into categories, and draws a timeline of every time you slid from work into distraction, with Lens the mascot keeping you company. It runs 100% locally: data lives in `chrome.storage` on your PC and is never sent anywhere.

- **Popup:** Lens the mascot, today's total, a category breakdown and the site you're on, with a live timer.
- **Side panel:** today's total with the change vs yesterday, the site you're on, your drift timeline, and (collapsed) every site today and your categories.
- **Lens:** a small mascot whose face and message follow your state: waving, happy, proud of a focus streak, curious when you wander, worried when you're doomscrolling, asleep when paused.

## Design
Minimal and black and white. The side panel leads with one number (today's total), then the site you're on and your drift. Everything else sits in collapsed sections. Colour is used only for status: green while tracking, amber for drift, red for delete. Categories are shades of grey, and every chart has a text alternative for screen readers. The design follows a skills library: design-critique, accessibility-review (WCAG 2.1 AA), ux-copy, theming-components, designing-layouts and the character-animation skills. See `docs/ui-audit.md` for the before-and-after.

## Drift
TimeLens records the order you move between sites (`trail`, kept for 2 days). A **drift** is leaving a focus site (Work, Learning) for a distracting one (Social, Entertainment, News, Shopping) for 5+ minutes. It ends when you're back on a focus site or after a 10-minute break. Scrolling for 20+ minutes with no focus site before it counts as **doomscrolling**. The side panel shows a strip of today's path and a timeline of each drift: when it started, the chain of sites, how long it lasted, and whether you came back. While a drift is happening, Lens reminds you where you left off. There are no pop-up notifications.

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
This writes a minified copy to `dist/` (about 56 KB, down from 75 KB; 26 KB gzipped). Load `dist/` in Chrome, or zip its contents for the Chrome Web Store. The source stays readable; only `dist/` is minified. `npm run test:dist` builds and runs the test suite against `dist/`.

## How time is counted
Time counts only while **a website is the active tab in the focused Chrome window** and you are **active**: input within the last 60 seconds, or the tab is playing sound (video, call). Switching to another app, locking the screen or going idle pauses the timer. The background worker saves the elapsed time every minute. A gap longer than 2 minutes (for example the PC slept) is capped instead of credited in full.

A **visit** is counted when you land on a different site or tab. Returning to the same tab, or moving around inside one site, is not counted as a new visit.

## Files
| File | What it does |
|---|---|
| `manifest.json` | Extension config (Manifest V3) |
| `background.js` | Service worker: decides what's being tracked and saves time |
| `lib.js` | Shared logic: categories, drift detection, Lens's moods, formatting (used everywhere) |
| `ui.js` | Shared UI: category buttons, the "now" row, charts with text alternatives, drift timeline |
| `lens.js` | Lens the mascot: rig data, pose library, mood transitions |
| `popup.html/js` | Toolbar popup |
| `panel.html/js` | Side-panel dashboard |
| `styles.css` | Styles for both, built entirely on design tokens |
| `build.mjs` | Minified build into `dist/` |
| `docs/ui-audit.md` | Design, accessibility and copy audit behind the v1.3 redesign |

## Data (in `chrome.storage.local`)
- `v1`: `{ "YYYY-MM-DD": { domains: { "github.com": { s: seconds, v: visits } }, hours: [24 × seconds] } }`, last 30 days
- `trail`: `{ "YYYY-MM-DD": [{ d: "github.com" or null (paused), t: ms }] }`, last 2 days, for drift detection
- `catList`, `catMap` (your per-site picks), `catAlias` (category renames), `seen`

Use **Export JSON** in the side panel to back it up.

## Tests
```bash
npm test
```
The tests run `background.js`, `lib.js` and `lens.js` (rig and pose checks) against a fake `chrome` API (`test/fake-chrome.js`). Node 18+ needed; there are no dependencies.
