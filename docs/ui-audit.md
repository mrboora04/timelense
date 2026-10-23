# TimeLens UI audit (v1.2.0) and redesign brief

Run against the skills in `D:\dev\skills` before the v1.3 redesign. Each section uses that skill's own output format.
Goal from the owner: **keep the UI minimal**.

---

## Design Critique: TimeLens side panel + popup
*(design/design-critique)*

### Overall Impression
The data is honest and the drift idea is strong, but the panel shows nine sections at once. It reads as a stack of cards, not as one clear answer to "where did my time go?"

### Usability
| Finding | Severity | Recommendation |
|---|---|---|
| Nine sections visible at once (Now, Drift, Categories, Challenges, Sites, Patterns, History, footer) | 🔴 Critical | Show one number and the current site first. Put the rest in collapsed sections (guiding-users: progressive disclosure, "accordion help, collapsed by default"). |
| Seven category buttons always open on the Now card | 🟡 Moderate | Show the current category as one button. Tap it to open the choices. |
| "Sites today" and "History" largely repeat each other | 🟡 Moderate | Keep both, collapsed, and show a count in each summary line. |
| Challenge presets always visible | 🟢 Minor | Collapse them. |

### Visual Hierarchy
- **What draws the eye first**: three big numbers compete (today total, this visit, today on this site). Only today's total should be big.
- **Reading flow**: mascot → KPI card → Now card → drift → six category cards. Too many boxes; nowstats is a card inside a card.
- **Emphasis**: gradients, shadows and borders on nearly everything, so nothing stands out.

### Consistency
| Element | Issue | Recommendation |
|---|---|---|
| Tokens | `validate_tokens.py` finds **22 hardcoded values** (2 colors, 6 font sizes, 5 radii, 9 spacing) | Tokenize every value; target 0 violations |
| Buttons | 6 button looks (gradient, ghost, small, danger, linkish, pill, chip) | 3 roles: primary, quiet, choice |
| Radii | 3, 4, 6, 8, 12, 16, 999 px | sm / md / full |
| Icons | emoji in challenges, SVG elsewhere | keep emoji only inside challenge names |

### Genericness
- **Nav/footer fingerprint**: no nav. The footer is a button row; it doesn't need to be. N
- **Structural rhythm**: the default dashboard shape (header → KPI card → card stack). Not chosen for this brief. → pick **Stat-Led** (designing-layouts/structural-variety)
- **Honest content**: all numbers come from the user's own data. ✅

### What Works Well
- The live timer, the drift chain and Lens's messages are specific and useful.
- Contrast passes everywhere (see below).

### Priority Recommendations
1. **Stat-Led layout with collapsed secondary sections** — one number, one "now" row, and one drift line above the fold.
2. **Real token system** — 0 hardcoded values, three-tier naming `--{component}-{property}`.
3. **Fix the keyboard-inaccessible controls** (accessibility audit below).

---

## Accessibility Audit: TimeLens
*(design/accessibility-review)* **Standard:** WCAG 2.1 AA

### Summary
**Issues found:** 8 | **Critical:** 2 | **Major:** 4 | **Minor:** 2

#### Perceivable
| # | Issue | WCAG Criterion | Severity | Recommendation |
|---|---|---|---|---|
| 1 | Charts (category bar, sparkline, hour bars, path strip) have no text alternative | 1.1.1 | 🟡 Major | `role="img"` + `aria-label` summary (visualizing-data: "Add text alternative") |
| 2 | Category palette is not colorblind-safe (News pink, Learning rose and Other orange look alike) | 1.4.1 | 🟡 Major | Wong palette from `visualizing-data/assets/color-palettes`, grey for Other |
| 3 | Drift times are plain text | 1.3.1 | 🟢 Minor | `<time datetime>` |

#### Operable
| # | Issue | WCAG Criterion | Severity | Recommendation |
|---|---|---|---|---|
| 4 | Category names are clickable `<span>`s: rename is unreachable by keyboard | 2.1.1 | 🔴 Critical | real `<button>` |
| 5 | "set a daily target" and "quit" are `<a href="#">` used as buttons | 4.1.2 | 🟡 Major | `<button>` |
| 6 | Targets too small: category pill ~22px, inline category buttons ~20px, target input ~20px | 2.5.5 | 🟡 Major | 44px minimum; make the whole site row the target |

#### Understandable / Robust
| # | Issue | WCAG Criterion | Severity | Recommendation |
|---|---|---|---|---|
| 7 | Lens's bubble is `aria-live` and its text changes every minute ("22m later…"), so screen readers announce constantly | 4.1.3 | 🔴 Critical | announce only when the mood changes |
| 8 | Reset confirm says "Delete ALL TimeLens data on this PC?" with OK/Cancel | 3.3.4 | 🟢 Minor | name the consequence (see UX copy) |

### Color Contrast Check
Computed with `theming-components/scripts/validate_contrast.py`'s `contrast_ratio`:

| Element | Foreground | Background | Ratio | Required | Pass? |
|---|---|---|---|---|---|
| Body text | #e2e8f0 | #0f172a | 14.48:1 | 4.5:1 | ✅ |
| Secondary text | #94a3b8 | #1e293b | 5.71:1 | 4.5:1 | ✅ |
| Accent text | #38bdf8 | #1e293b | 6.83:1 | 4.5:1 | ✅ |
| Button text | #06202e | #38bdf8 | 7.82:1 | 4.5:1 | ✅ |
| Warning tag | #fbbf24 | #1e293b | 8.76:1 | 4.5:1 | ✅ |
| New palette, lowest (#D55E00) | — | #1e293b | 3.8:1 | 3:1 | ✅ |

### Priority Fixes
1. **Rename/target/quit as real buttons** — keyboard users currently can't reach them.
2. **Quiet the live region** — affects every screen-reader user, every minute.
3. **Chart text alternatives + colorblind-safe palette.**

---

## UX Copy: TimeLens
*(design/ux-copy)*

### Recommended Copy
| Element | Now | Recommended |
|---|---|---|
| Drift empty state | "No drifts today. A drift is leaving Work or Learning for Social, Entertainment, News or Shopping for 5+ minutes." | **"No drifts today."** + quiet hint: "You drift when you leave Work or Learning for 5+ minutes." (what + why, shorter) |
| Reset confirm | "Delete ALL TimeLens data on this PC?" | **"Delete all TimeLens data? Your history, categories and challenges will be erased. This can't be undone."** |
| Popup CTA | "Open full dashboard" | **"Open dashboard"** |
| Now label | "Paused · no activity" | **"Paused — no activity"** |
| Terms | "visits", "pages", "browsed", "screen time" mixed | **visits** (site switches), **pages** (Chrome history only), **browsed** (time). Never "screen time". |
| Challenge preset | "🌿 Social Detox · Social under 30m/day · 7 days" | **"🌿 Social detox"** + "Social under 30 min a day, 7 days" on a second line |

### Rationale
Clear and concise wins in a side panel that shares the screen. Every empty state says what it is and what fills it. Destructive actions name what's lost.

---

## Design System Audit
*(design/design-system, assembling-components/scripts/validate_tokens.py)*

| Category | Defined | Hardcoded Values Found |
|---|---|---|
| Colors | 14 | 2 |
| Spacing | 6 | 9 |
| Typography | 5 | 6 |
| Radii | 4 | 5 |

Naming does not follow `--{component}-{property}-{variant?}-{state?}` (theming-components). **Target for v1.3: 0 violations.**

---

## Lens (mascot) review
*(animation/character-rigging, pose-library-design, svg-character-animation, character-animation-qa)*

| Check | Result |
|---|---|
| Rig is a data package (parts, layers, pivots) | ❌ hand-written SVG strings per mood |
| Eyes and pupils separate (gaze possible) | ❌ |
| Mouth shapes as a separate library | ❌ inline paths |
| Poses name only changed parts | ❌ each mood redraws the whole face |
| "Do not continuously animate every part. Holds make the acting readable." | ❌ constant bob + shiver + hop |
| Acting pattern anticipation → action → hold → settle on mood change | ❌ mood just swaps |
| Reduced motion respected | ✅ |
| **Verdict** | **revise** |

---

## Layout pick
*(designing-layouts/references/structural-variety.md, logged in `.layout-log.json`)*
**Macrostructure: Stat-Led.** The big number comes first, then the narrative (now, drift), and the details are collapsed. Nav: none (single view). Footer: one inline line.

---

## Results after the v1.3 redesign

| Check | Before | After |
|---|---|---|
| `validate_tokens.py --strict` (assembling-components) | 22 violations | **0** |
| Physical CSS properties (theming-components logical-properties rule) | several | **0** |
| Text contrast (theming-components `contrast_ratio`) | all pass | all pass: body 18.97:1, muted 7.85:1, white button 18.97:1 |
| Category colours | not colourblind-safe | greys at 3.4:1 or more on the track, 2px gaps between segments, "Other" striped, plus text alternatives |
| Keyboard-unreachable controls | 3 | **0** (rename, set target, quit are buttons) |
| Interactive targets below 44px | pills, inline buttons, input | **none** (`--target-min: 44px`) |
| Charts without a text alternative | 4 | **0** |
| Screen-reader chatter from Lens | every minute | only on mood change |
| Lens QA (character-animation-qa) | revise | **pass**: rig schema tests, every pose rendered and reviewed, "worried" brows fixed (they read as angry), act-out frames sampled: distinct during anticipation, action and settle, identical during the hold |

**Owner feedback applied:** minimal UI (Stat-Led, secondary sections collapsed), and plain black and white with colour only for status: green = tracking now, amber = drift, red = delete.

---

## v1.5 — Usage view and chart colours (dataviz skill)

**Usage** (bottom of the side panel) is modeled on iPhone Screen Time and Android Digital Wellbeing, from their official help pages:

| Phone feature | TimeLens |
|---|---|
| Screen Time Day / Week switch, swipe through past days | Day / Week switch, ‹ › through the last 30 days |
| Daily average, change vs last week | Week view: daily average, % change, total |
| Most used apps (Screen Time), time per website per day (Wellbeing: Chrome → Show sites) | Most used sites with time and a meter |
| Times opened (Wellbeing), pickups and first pickup (Screen Time) | Visits per site and per day, first visit of the day |
| Time-by-hour chart | 24 hourly columns, scaled so a full column is one hour |
| App or site timers, Focus mode, Bedtime | Not built. Enforcing a limit means blocking pages, which needs new site permissions (proposed as a separate step) |

**`dataviz` validator (`scripts/validate_palette.js`):**

| Palette | Result |
|---|---|
| Six category greys used in v1.3–1.4 | **FAIL**: adjacent greys ΔE 6.1, under the hard normal-vision floor of 15 |
| Replacement: focus / distracting / other (white, amber, grey) | Separation **PASS** for all pairs (ΔE ≥ 19), contrast **PASS**. Lightness band and chroma floor fail because white and grey have no hue, which is the owner's black-and-white choice; the legend and labels supply the secondary encoding the skill requires |
| Usage columns: one series in one tone | No categorical palette needed (single series; the title names it) |

Category identity is now carried by text everywhere (no grey dots), per "identity is never color alone".
