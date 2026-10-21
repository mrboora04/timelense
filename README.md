# TimeLens

A Chrome extension that tracks where your browsing time goes. It runs 100% locally: data lives in `chrome.storage` on your PC and is never sent anywhere.

- **Popup:** Lens the mascot, what's being tracked right now (with a live timer), today's total, a category breakdown and your top sites.
- **Side panel:** a today card with change vs yesterday and a 7-day sparkline, drift timeline, categories with daily targets, one-tap challenges, every site visited today, patterns and 7-day history.
- **Lens:** a small mascot whose face and message follow your state: waving, happy, proud of a focus streak, curious when you wander, worried when you're doomscrolling, asleep when paused.

## Drift
TimeLens records the order you move between sites (`trail`, kept for 2 days). A **drift** is leaving a focus site (Work, Learning) for a distracting one (Social, Entertainment, News, Shopping) for 5+ minutes. It ends when you're back on a focus site or after a 10-minute break. Scrolling for 20+ minutes with no focus site before it counts as **doomscrolling**. The side panel shows a strip of today's path and a timeline of each drift: when it started, the chain of sites, how long it lasted, and whether you came back. While a drift is happening, the Now card and Lens remind you where you left off. There are no pop-up notifications.

## Categories
About 250 sites are built in, including popular Indian sites. Unknown sites are guessed from their name: `.edu` and `.ac.in` → Learning, names with "news" → News, "shop" or "store" → Shopping, `localhost` → Work, and so on. Anything else is Other. Your own picks always win.

## Install (developer mode)
1. Open `chrome://extensions` and turn on **Developer mode**.
2. Click **Load unpacked** and pick this folder.
3. Pin TimeLens from the puzzle-piece menu. Requires Chrome 116 or later.

## How time is counted
Time counts only while **a website is the active tab in the focused Chrome window** and you are **active**: input within the last 60 seconds, or the tab is playing sound (video, call). Switching to another app, locking the screen or going idle pauses the timer. The background worker saves the elapsed time every minute. A gap longer than 2 minutes (for example the PC slept) is capped instead of credited in full.

A **visit** is counted when you land on a different site or tab. Returning to the same tab, or moving around inside one site, is not counted as a new visit.

## Files
| File | What it does |
|---|---|
| `manifest.json` | Extension config (Manifest V3) |
| `background.js` | Service worker: decides what's being tracked and saves time |
| `lib.js` | Shared logic: categories, drift detection, Lens's moods, formatting (used everywhere) |
| `ui.js` | Shared UI: category buttons, live "Now" card, category bar, Lens, drift timeline |
| `popup.html/js` | Toolbar popup |
| `panel.html/js` | Side-panel dashboard |
| `styles.css` | Styles for both |

## Data (in `chrome.storage.local`)
- `v1`: `{ "YYYY-MM-DD": { domains: { "github.com": { s: seconds, v: visits } }, hours: [24 × seconds] } }`, last 30 days
- `trail`: `{ "YYYY-MM-DD": [{ d: "github.com" or null (paused), t: ms }] }`, last 2 days, for drift detection
- `catList`, `catMap` (your per-site picks), `catAlias` (category renames), `targets`, `challenge`, `seen`

Use **Export JSON** in the side panel to back it up.

## Tests
```bash
node --test test/
```
The tests run `background.js` and `lib.js` against a fake `chrome` API (`test/fake-chrome.js`). Node 18+ needed; there are no dependencies.
