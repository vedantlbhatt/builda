# Builda: visual spec for the 9:16 trailer

Source repo: `/home/user/vedantlbhatt/builda` (commit `8300ed3`). All `file:line` refs are relative to that repo.
Everything below was read from source; sample strings marked **(computed)** were produced by running the app's own
pure TS functions (`bun`) on the app's own fixtures, so they are exactly what the phone prints.

Units: phone screens are in iOS points (design width 393pt, iPhone 15/16). Multiply by 3 for @3x pixels.
For a 1080x1920 9:16 canvas, a 393pt-wide phone at full canvas width is ~2.748 px/pt.

---

## 0. Global rules that shape every screen

- **Dark only.** `userInterfaceStyle: 'dark'` (`mobile/app.config.ts:28`). Every screen sits on the warm near-black ground `#141210`.
- **"Chapters, not cards."** Screens are built from full-bleed colour **Bands** (a block of one hue, dark ink on it, with a 1-bit dithered dissolve under it into the ground), then open content on the ground. No card borders, no shadows in scroll flow (`mobile/src/insights/Band.tsx:1-14`, `design/tokens.json` `shadow`).
- **Navigation is words + arrow** (`arrow.right` SF Symbol), never chevron rows (`mobile/src/nav/chrome.tsx:262-283`, `mobile/src/session/parts.tsx:52-102`).
- **The theme = the user's creature's hue.** Tab bar active tint, primary buttons, links, the Sessions/You/Projects hero bands all take the accent from the user's chosen creature (`mobile/src/theme/accent.tsx`, `mobile/src/nav/chromeRules.ts:6-10`). Default creature is **cat** (`mobile/src/pixel/animals.ts:52-61,730`) so default accent = **orchid `#F54BB8`**. Amber `#FFB300` is the brand (Bit, the icon, the strip's agent colour) and is **not** used in chrome.
- **No dashes in copy** (hyphen allowed only as a minus sign: `-186`). Captions and labels are lower case. Middle dot `·` separates facts.
- **Every number is tabular** (`fontVariant: tabular-nums`) and figures are heavy (800) with tight tracking.
- **Motion vocabulary** (`mobile/src/insights/motion.ts:19-32`, `mobile/src/ui/motionSpec.ts:19`): ease = cubic-bezier(0.23, 1, 0.32, 1); count-ups 950ms; draw/grow 1000ms; stagger 90ms; text rises 10pt while fading; spring damping 0.72 (~4% overshoot). Bands "print" their dither cells in random top-biased order over 560ms, then words fade up at +240ms over 420ms (`Band.tsx:59-67`).

---

## 1. Brand

### 1.1 Name, copy
| thing | value | ref |
|---|---|---|
| App display name | **Builda** | `mobile/app.config.ts:23` |
| Code name / scheme | `builder` (`builder://…` deep links; CLI binary is `builder`) | `app.config.ts:24-25` |
| Bundle id | `com.vedantlbhatt.Builder` | `app.config.ts:44` |
| Positioning (repo README / CLAUDE.md) | "Strava for build sessions." | `README.md:3`, `CLAUDE.md:3` |
| Tagline (onboarding headline, also the share-card foot) | **"Your build sessions, read back to you."** (card foot lower-cases it and drops the period: "your build sessions, read back to you") | `mobile/src/onboarding/copy.ts:22-29`, `mobile/src/card/model.ts:12` |
| Sub-line | "Builda reads what your coding agents write and tells you how every session went." | `onboarding/copy.ts:24` |
| Widget gallery | title "Builda", description "What your agents are doing, and who needs you first." | `mobile/targets/widget/BuilderHomeWidget.swift:80-84` |
| Notify step headline | "Know when to look." rows: "While it runs / Live on your lock screen, without unlocking." · "When it stops to ask / A tap the moment an agent needs you." · "When it finishes / The recap, ready the moment you stop." | `onboarding/copy.ts:183-191` |
| Empty Now tab | "Nothing needs you." / "Go do something else." (band title "All quiet") | `mobile/src/live/LiveSessions.tsx:690-711` |
| Onboarding creature caption | "Vedant, the fox" ; theme line "Builda wears your creature’s colour." | `onboarding/copy.ts:38-63` |
| Wordmark on the share card | a solid square (16u) in the accent + "Builda" 26u/800, tracking -0.3u | `mobile/src/card/RecapCard.tsx:149-154` |

### 1.2 Colour tokens (`design/tokens.json`, the ONLY place colours live; all sRGB)

**Surfaces** (`tokens.json:31-45`; resolved in `mobile/src/theme.ts:16-77`)
| token | dark (used) | light |
|---|---|---|
| bg | `#141210` | `#FBF9F5` |
| card | `#1E1B18` | `#FFFFFF` |
| raised | `#282420` | `#F3EFE7` |
| border (hairline) | `#2F2B27` | `#E7E3DC` |
| text | `#F5F1EA` | `#1C1917` |
| textDim | `#A8A29A` | `#6B655D` |
| textFaint | `#6B655D` | `#A8A29A` |
| accent (brand amber) | `#FFB300` | `#FFB300` |
| accentPressed | `#E0A300` | `#E0A300` |
| **ON_HUE / onFill** (ink on any hue fill) | `#1C1917` | same |

**Strip (the timeline)** (`tokens.json:17-29`)
| class / mark | dark | light |
|---|---|---|
| idle | `#2A2724` | `#E7E3DC` |
| prompting ("you prompting") | `#EDE6D8` (bone) | `#F3EFE7` |
| agent ("agent working") | `#FFB300` | `#FFB300` |
| human_edit ("your edits") | `#19C4B0` (teal) | `#0E9F8E` |
| mark: prompt | `#F5F1EA` | `#1C1917` |
| mark: commit | `#19C4B0` | `#0E9F8E` |
| mark: compact (context compaction) | `#6B655D` | `#A8A29A` |

**Data hues** (numbers only, never chrome) (`tokens.json:47-57`): add `#7BC96F` (light `#2B7F3A`), del `#E5484D` (light `#C62A2F`), human = strip teal.

**Contribution graph ramp, level 0..5, by active hours** (`tokens.json:59-65`, buckets `>0, >0.5h, >2h, >4h, >8h` in `mobile/src/theme.ts:317-324`)
- dark: `#221F1C  #4A3714  #7A5A12  #B37E00  #E0A300  #FFB300`
- light: `#EFEBE4  #FFE7B0  #FFD275  #FFB300  #E08A00  #B36B00`

**Spectrum: nine identity hues** (`tokens.json:144-154`). `dark` is what the app uses (ink on dark ground, and the solid band fill). `partner` = dither middle tone.
| hue | dark / fill | partner | light mark | lightText | lightPartner |
|---|---|---|---|---|---|
| amber | `#FFB300` | `#D07506` | `#BC8303` | `#976902` | `#E8B45E` |
| brass | `#ECE659` | `#CA9E09` | `#A68C03` | `#857000` | `#D3BE66` |
| tide | `#6CD9F1` | `#0E86AD` | `#049BB3` | `#057C90` | `#85CADB` |
| cobalt | `#53A3F2` | `#417ACC` | `#4192DF` | `#1F74BF` | `#8DC3FB` |
| iris | `#A670F3` | `#7658CB` | `#A670F3` | `#8C55D6` | `#C5A3FF` |
| heather | `#EAB8FF` | `#9C68B0` | `#B178C8` | `#8D5FA0` | `#D1AFE0` |
| orchid | `#F54BB8` | `#BF3A90` | `#F248B5` | `#D12198` | `#FF98D3` |
| coral | `#FCA0A6` | `#D36D86` | `#D66E77` | `#AB575E` | `#EBAAAD` |
| ember | `#F9833E` | `#D85A05` | `#E06C23` | `#B95201` | `#FBA77B` |

Mappings (`tokens.json:155-212`):
- **creature → hue:** bit amber, cat orchid, dog cobalt, fox ember, owl heather, bee brass, whale tide, octopus iris, crab coral.
- **session crew ring** (a session's creature = `ring[fnv1a32(client_session_id) % 8]`, never Bit): `fox, whale, bee, octopus, crab, dog, cat, owl`.
- **harness → hue** (only where the harness is the subject): claude_code heather, codex tide, cursor brass, gemini_cli coral, cline iris, opencode ember, aider cobalt.
- **archetype → hue:** architect heather, velocity_machine brass, quality_guardian coral, night_owl orchid, explorer iris, firefighter ember, director cobalt, skeptic tide, generalist amber.
- **analysis chapters** (`mobile/src/insights/palette.ts:302-312`): 02 Time amber, 03 Shipping tide, 04 With your agent heather, 05 Agents brass, 06 Money and burn ember, 07 You against you cobalt, 08 Quality coral, 09 What stands out iris, 10 Words and stack orchid.
- **verdict colours:** converging = add green, circling = textDim, lost = del red.
- **Session page sub-hues** (`mobile/src/session/crew.ts:54-63`): burn = ember (coral if session is ember), calls = cobalt (orchid if cobalt), reading = iris (heather if iris).

### 1.3 Type
- **System fonts only. No font files ship; there are NO .ttf/.otf anywhere in the repo** (`tokens.json:68-75`; `find` confirms none). SF Pro for words, **SF Mono** (`fontFamily: 'ui-monospace'`, `mobile/src/theme.ts:258`) for machine data: repo names, clocks, model ids, chapter index numbers. For the Node renderer use Inter / SF Pro Display if licensed, and a mono like SF Mono / JetBrains Mono / IBM Plex Mono.
- **Nine type roles** (`tokens.json:76-84`; size pt / weight / tracking pt / line multiple):
  hero 56/800/-1.5/1.0 · display 40/800/-0.8/1.05 · title 22/700/-0.3/1.2 · headline 17/600/-0.2/1.25 · body 17/400/-0.2/1.35 · row 15/600/0/1.3 · meta 13/400/0/1.3 · label 12/600/+0.2/1.2 · mono 13/500/0/1.3 (monospaced).
- **The "house" kit actually used on screens** (`mobile/src/insights/kit.tsx:36-46`), colours are dark-ground:
  | style | size/line | weight | tracking | colour |
  |---|---|---|---|---|
  | bandCaption | 17/22 | 600 | -0.2 | `#1C1917` |
  | bandNote | 15/20 | 500 | 0 | `#1C1917` @ opacity 0.8 |
  | heading | 22/27 | 700 | -0.3 | `#F5F1EA` |
  | lead | 17/23 | 600 | -0.2 | `#F5F1EA` |
  | body | 17/23 | 400 | -0.2 | `#F5F1EA` |
  | dim | 15/20 | 400 | 0 | `#A8A29A` |
  | meta | 13/18 | 400 | 0 | `#A8A29A` |
  | label / Kicker | 12/15 | 600 | +0.2 | `#A8A29A`, marginBottom 10, lower-case |
  | mono | 13/17 mono | 500 | 0 | `#A8A29A` |
- **Figure formula** (every big number) `figure(size)`: weight 800, lineHeight `round(size*1.08)`, letterSpacing `-round(size*0.035*10)/10` (e.g. 48pt → -1.7), tabular (`kit.tsx:25-34`). Big numbers are auto-fit to width with `fitSize` (digit ≈ 0.68em, `,`/`.` 0.3em, space 0.28em, `%` 0.98em, capitals 0.72em, others 0.6em; `mobile/src/insights/format.ts:181-193`).
- Tab-root large title: 34/41, 700, +0.37 tracking, left-aligned at 16pt gutter (`mobile/src/nav/chrome.tsx:137`).
- Session-screen type (`mobile/src/session/type.ts`): BAND_TITLE 31/34/800/-0.8 (26/29/-0.6 if title > 34 chars) · DOOR_TITLE 28/33/800/-0.6 · ROW_FIGURE 20/24/800/-0.4 · BAR_TOP 17/20/800 · AXIS 11/14/600/+0.2 · SMALL_FIGURE 15/20/700.

### 1.4 Spacing, radii, layout (`tokens.json:92-114`)
- Space scale: 4 8 12 16 24 32 40 64 (xs sm tile md lg section xl xxl).
- Radius: xs 6 (marks), sm 12 (inner), md 18 (containers), lg 28 (Wrapped/share cards), pill 999 (buttons); card export 24. `borderCurve: continuous` (squircle) everywhere.
- Gutters: kit/insights pages use **20pt** (`kit.tsx:22`); nav chrome, tiles & widgets use 16pt (`tokens.layout.gutter`). Tile gap 12. Live Activity padding 14.
- Shadow (only for floating things): y 12, blur 32, #000 @ 0.5.
- Dither: 3pt cells, 8x8 Bayer matrix (`tokens.json:116-139`).

### 1.5 Icon & logo assets (copied to `reel/builda/assets/app/`)
| file | size | what |
|---|---|---|
| `assets/app/icon.png` (from `mobile/assets/icon.png`) | 1024x1024 RGB | **Bit** (the robot mascot) in amber `#FFB300` on `#141210`. 16x16 grid, 56px cells, 64px margin. Generated by `scripts/gen_app_icons.py` from the same sprite strings the app animates (`app.config.ts:31-34`). |
| `assets/app/splash-icon.png` | 512x512 RGBA | Bit on transparent; splash bg `#141210` (`app.config.ts:35-39`) |
| `assets/app/adaptive-icon.png` | 1024x1024 RGBA | Android foreground, Bit drawn smaller (bg `#141210`) |
| `assets/app/favicon.png` | 64x64 | web favicon |

There is no separate wordmark image: the wordmark is text "Builda" beside an accent square (see share card).

### 1.6 The creatures
- **What:** a family of 16x16 one-ink pixel characters. **Bit** is the brand mascot (a small square robot with a T antenna, amber). Eight animals the user picks from as their identity: **cat, dog, fox, owl, bee, whale, octopus, crab** (picker order; `mobile/src/pixel/animals.ts:52-61`). Lower-case labels. Each animal has its own hue (1.2). Features are HOLES: every creature has the same two 2x2 eye holes at cols 5-6 and 9-10, rows 6-7 (`mobile/src/pixel/frames.ts:40-60`).
- **Where:** frames are strings in `mobile/src/pixel/animals.ts:113-653` (animals; loop `[REST, BREATH, REST, GESTURE]`) and `mobile/src/pixel/sprites.ts:49-445` (Bit states idle, blink, building, sleeping, celebrating, thinking, waving). Widget PNG renders (white templates, tinted at runtime) in `mobile/targets/widget/Assets.xcassets/creature-<id>-{16,32,48,64}.imageset/` (largest 64pt@3x = 192px).
- **How used:**
  - **You tab icon** in the tab bar = your creature, 32pt (2pt cells), in your hue (`nav/chrome.tsx:104-106`, `chromeRules.ts:36`).
  - **Every session wears a crew creature** (hash of session id over the crew ring, never Bit). It marks the session's row in the Sessions list (32pt, in its hue), colours the session page's hero band, the mission-control tile, the Lock Screen Live Activity ring and the widget.
  - **Hero bands** print the creature LARGE in dark ink `#1C1917` cell by cell (`CreaturePrint`, `mobile/src/insights/Creature.tsx:27-45`; whole points per cell: session hero ≤112pt, You hero ≤160pt, Projects hero ≤128pt).
  - **Archetypes** each have a creature (quality guardian = crab/coral, velocity machine = bee/brass, skeptic = whale/tide, generalist = Bit/amber, ...).
  - Bit **sleeping** (with a `z`) is the empty-state: "Nothing needs you." band, idle widget. Bit **celebrating** appears when pairing succeeds.
- Rest poses (`b` = ink, `.` = transparent, `z` = the sleeping z, same ink). Full frame data incl. every animation frame: `reel/builda/assets/data/creature_frames.json`.

```
bit (idle)         bit (sleeping)     cat                dog                fox             
................   ................   ................   ................   ................
................   ................   ................   ................   ................
......bbbb......   ................   ...b........b...   ................   ..b..........b..
.......bb.......   ......bbbb......   ...bb......bb...   ....bbbbbbbb....   ..bb........bb..
....bbbbbbbb....   ....bbbbbbbb....   ...bbbbbbbbbb...   ..bbbbbbbbbbbb..   ..bbbbb..bbbbb..
...bbbbbbbbbb...   ...bbbbbbbbbb...   ...bbbbbbbbbb...   ..bbbbbbbbbbbb..   ..bbbbbbbbbbbb..
...bb..bb..bb...   ...bbbbbbbbbb...   ...bb..bb..bb...   ..bbb..bb..bbb..   ..bbb..bb..bbb..
...bb..bb..bb...   ...bb..bb..bb...   ..bbb..bb..bbb..   ..bbb..bb..bbb..   ..bbb..bb..bbb..
...bbbbbbbbbb...   ...bbbbbbbbbb...   ...bbbbbbbbbb...   ..bb.bbbbbb.bb..   ..bbbbbbbbbbbb..
...bbbbbbbbbb...   ...bbbbbbbbbb.z.   ..bbbbbbbbbbbb..   ..bb.bb..bb.bb..   ...bbbbbbbbbb...
...bbbbbbbbbb...   ...bbbbbbbbbb...   ....bbbbbbbb....   ..bb..bbbb..bb..   ....bbbbbbbb....
...bbbbbbbbbb...   ...bbbbbbbbbb...   .....bbbbbb.....   ......bbbb......   .....bbbbbb.....
....bb....bb....   ....bb....bb....   ....bbbbbbbb....   .....bbbbbb.....   ......bbbb......
....bb....bb....   ....bb....bb....   ....bbbbbbbb....   .....bb..bb.....   .......bb.......
................   ................   ................   ................   ................
................   ................   ................   ................   ................

owl                bee                whale              octopus            crab            
................   ................   ................   ................   ................
................   ................   ................   ................   ................
..bb........bb..   ....b......b....   .........bb.bb..   .....bbbbbb.....   ..b.b......b.b..
..bbbb....bbbb..   ...bbbbbbbbbb...   ..........bbb...   ....bbbbbbbb....   ..bbb......bbb..
...bbbbbbbbbb...   ..bbbbbbbbbbbb..   ....bbbbbbbbb...   ...bbbbbbbbbb...   ..bb.bbbbbb.bb..
...bbbbbbbbbb...   ..bbbbbbbbbbbb..   ...bbbbbbbbbb...   ...bbbbbbbbbb...   ..bb.bbbbbb.bb..
...bb..bb..bb...   ..bbb..bb..bbb..   ..bbb..bb..bb...   ...bb..bb..bb...   ..bbb..bb..bbb..
...bb..bb..bb...   ..bbb..bb..bbb..   ..bbb..bb..bbb..   ...bb..bb..bb...   ..bbb..bb..bbb..
...bbbb..bbbb...   ..bbbbbbbbbbbb..   ..bbbbbbbbbbbb..   ...bbbbbbbbbb...   ..bbbbbbbbbbbb..
...bbbbbbbbbb...   ...b........b...   ..bb.bbbbbb.bb..   ....bbbbbbbb....   ...bbbbbbbbbb...
..bbbbbbbbbbbb..   ..bbbbbbbbbbbb..   ..bbb......bbb..   ...bbbbbbbbbb...   ..bbbbbbbbbbbb..
...bbbbbbbbbb...   ...b........b...   ..bbbbbbbbbbbb..   ..bb.bbbbbb.bb..   ..b..bb..bb..b..
....bbbbbbbb....   ..bbbbbbbbbbbb..   ...bbbbbbbbbb...   ..bb.bb..bb.bb..   ....bb....bb....
...bb......bb...   ....bbbbbbbb....   ................   ..b..bb..bb..b..   ...bb......bb...
................   ................   ................   ................   ................
................   ................   ................   ................   ................
```

Rendering a creature: draw each non-`.` cell as a square of `floor(size/16)` points in one colour, no antialiasing. On a band it is `#1C1917`; on the ground it is the creature's hue. Pre-rendered 512px hue PNGs: `assets/creatures/hue-512px/*.png` (32px cells, transparent).

---

## 2. Screens

### 2.0 App chrome: tab bar and large titles
- Four tabs, in order: **Now · Sessions · Projects · You** (`mobile/src/nav/rules.ts:177-182`). Detail screens push over the tabs.
- **Tab bar** (`mobile/src/nav/chromeRules.ts:26-63`, `mobile/app/(tabs)/_layout.tsx:45-58`): height 56pt + home-indicator inset; opaque bg `#141210`; one hairline top border `#2F2B27`; labels always shown, 11pt / 600 / +0.2 tracking; active glyph + label = accent ink (creature hue, e.g. orchid `#F54BB8`); inactive = `#A8A29A`. No amber.
- **Tab glyphs are SF Symbols, not SVG** (`mobile/src/nav/chrome.tsx:41-47`), 26pt, semibold; outline at rest, filled when active: Now `bolt` / `bolt.fill`; Sessions `list.bullet.rectangle` / `list.bullet.rectangle.fill`; Projects `folder` / `folder.fill`; **You = the user's pixel creature** at 32pt (2pt cells). Selecting bounces 1.0 → 1.15 (110ms) → spring home (320ms, damping 0.7).
- **Tab-root header** (`chrome.tsx:137-175`): large title left-aligned, 34/41, 700, +0.37, `#F5F1EA`, row min-height 52, 16pt side padding, hairline `#2F2B27` under the header. Title blurs into focus once per tab (BlurText, 90ms delay). You tab has a `gearshape` 22pt at right.
- Pushed screens: native back bar on `#141210`, tint `#F5F1EA`, empty title, no shadow.
- Primary action (`AccentButton`, `chrome.tsx:201-260`): capsule, height 52 (headline label 17/600) or 44 (row label 15/600), padding-x 24, fill = accent hue, label `#1C1917`. Press = scale 0.97.

### 2.1 The Band (the building block of every hero)
`mobile/src/insights/Band.tsx:127-186`
- Full width, no radius. Solid block of the hue's `ink` (e.g. `#F54BB8`), then a **36pt dissolve** (`FRINGE`) below where the hue breaks into the ground via 3pt ordered-dither cells (density 1 → 0 down the fringe). No gradient: every 3pt cell is either hue or ground.
- Inner padding 22 top / 22 bottom / 20 sides, gap 6.
- Head row: optional index "02" (SF Mono 13/600, `#1C1917` @0.62) + title (15/700/+0.1, `#1C1917`), marginBottom 4. A doorway band adds a bold `arrow.right` 18pt after the title and presses to scale 0.985.
- Print-in: cells switch on in random order biased top→bottom over 560ms; words fade + rise 10pt from +240ms over 420ms.
- Big figure on a band: `BandFigure`, `#1C1917`, fitted between min/max size.
- A refusal on a band: 3pt vertical bar in `#1C1917` + bandNote text (`kit.tsx:113-123`).

### 2.2 Sessions tab (the feed of your own sessions)
`mobile/src/session/SessionsScreen.tsx`, header title "Sessions". Ground `#141210`, bottom padding 120.

Top to bottom:
1. *(only while something runs)* the live summary band (see 2.5) in the accent.
2. **"This week" band** in the accent hue (`SessionsScreen.tsx:420-459`):
   - title "This week"
   - row (space-between, align bottom, gap 16, marginTop 2): left = big figure **"15.5"** (fit 52..108pt, `#1C1917`), then bandCaption **"hours this week"**, then bandNote **"across four days so far"**; right = **WeekBars**.
   - Under an hour the figure is a duration ("42m") with caption "this week". Empty week: "Nothing finished yet this week. The first session you finish lands here." (`mobile/src/session/week.ts:81-92`)
   - **WeekBars** (`mobile/src/session/WeekBars.tsx:22-70`): 7 bars, each 10pt wide, gap 7 (total 88pt), plot height 58, bar height = `max(4, round(seconds/max*58))`, days with nothing = 2pt stub; colour `#1C1917` on the band. Letters under (marginTop 6): `M T W T F S S` in AXIS 11/14/600/+0.2; today's letter 800 + underline; future days opacity 0.45. Bars grow staggered 70ms.
   - Sample week (computed from `mobile/src/insights/fixtures/report-2026-09-13.json`, Sat Sep 12): minutes per day M 0, T 60, W 12, T 0, F 181, S 673, S 0 → "15.5 hours this week", "across four days so far".
   - Signed-out variant: band title "A sample", bandCaption "You are browsing a sample session.", bandNote "Sign in and your own land here, every one your Mac finishes. Nothing syncs until you do." then a door "Sign in" / "In Settings, the gear on You."
3. Group (marginTop 26): Kicker **"finished"** (or "every session", or "the sample"), 20pt gutter.
4. **FinishedRow** × N (`SessionsScreen.tsx:493-563`), open rows (no card), `marginHorizontal 20, paddingVertical 16`, hairline `#2F2B27` between rows:
   - Head row (gap 14, align top): **creature mark 32x32** (2pt cells) in the session's crew hue, marginTop 1 · words column (flex, gap 4): **title** lead 17/23/600 `#F5F1EA`, max 2 lines; **meta row** (gap 6): harness logo 13pt in `#A8A29A` + meta 13/18 `#A8A29A` e.g. **"tramline (sample) · yesterday"** (adds " · on its own" for unattended runs) · right: **ROW_FIGURE** 20/24/800/-0.4 `#F5F1EA`, e.g. **"5h 17m"**.
   - Strip slot: indented `marginLeft 46` (32+14), marginTop 12: the **mini strip** (30pt tall, see §3) at width `393 - 40 - 46 = 307pt`, traced left→right over 620ms (row i delayed 260 + min(i,8)*60 ms).
   - If finished in the last hour and not posted: a link "Open the recap" (lead, accent colour) under the strip.
   - No strip kept: meta "The timeline was not kept for this session."
   - Rows stagger in 40ms apart (AnimatedList).
   - Row title when untitled: "Saturday afternoon session", "This morning's session", "Yesterday late night session" (`mobile/src/session/page.ts:164-173`).
5. List end: hairline, dim sentence + a door.

Empty signed-in: heading "No sessions yet." dim "Pair your Mac and the first session you finish lands here, with its shape and its story." door "Connect your Mac".

### 2.3 Session detail page (a Strava activity page)
`mobile/src/session/SessionPage.tsx`, `Hero.tsx`, `Route.tsx`, `Share.tsx`. Everything below is the **sample session** opened at `builder://session/sample` **(computed** with `sampleOutcome(SAMPLE_SESSION,'final')`, TZ America/New_York, "now" = Aug 30 2026).

1. **Hero band** in the session's creature hue (`Hero.tsx:36-96`):
   - band title = when: **"Yesterday at 9:12am"** (format "`<Today|Yesterday|Weekday|Aug 29>` at `<h:mmam>`", `session/when.ts:13-19`).
   - title row (gap 14, marginTop 4): engineer-voice title **"Shipped changes to nine source files"** in BAND_TITLE 31/34/800/-0.8 `#1C1917` (arrives word by word) + **CreaturePrint** at right, size `min(112, floor(inner*0.3/16)*16)` = 96pt on a 393 phone (6pt cells), dark ink.
   - figure (marginTop 14): **"5h 17m"** counting up, fit 56..120pt, `#1C1917`.
   - bandCaption (marginTop -2): **"active of 6h 48m elapsed"** (or "active so far" while live, or "active").
   - tool row (gap 8, marginTop 12): harness logo 18pt (Claude's terracotta mark keeps its colour) + bandNote **"Claude Code"** + bandNote SF Mono @0.8 **"tramline (sample)"**.
2. **Route** (`Route.tsx`, block marginTop 26, 20pt gutter): Kicker **"the shape of it"**, then the **hero strip** (72pt tall, full inner width 353pt, traced over 1000ms starting at 480ms), then SF Mono 13 `#A8A29A` clocks at each end: **"9:12am"** … **"4:00pm"** ("now" while live), then the legend (marginTop 14, wrap, columnGap 16, rowGap 8): 9pt square swatch + meta text + share in `#F5F1EA`:
   **"■ agent working 67%   ■ you prompting 3%   ■ your edits 8%   ■ idle 22%"** (computed; shares < 1% say "under 1%").
3. **What landed** (Kicker "what landed", block marginTop 30): optional diff bar (14pt tall, green/red split) then ledger rows (paddingVertical 12, hairlines between; figure 48pt 800 + label lead 17/600 beside it, baseline aligned, gap 10):
   - **"+2,101"** `#7BC96F` "lines added"
   - **"-186"** `#E5484D` "lines removed"
   - **"7"** (session hue) "commits landed" (sparks burst in session hue when it lands)
   - **"52"** (session hue) "prompts you sent"
4. **What happened** (Kicker "what happened"), body 17/23 sentences arriving 240ms apart (computed):
   - "You built for 5h 17m, 4h 12m of it with you there, and sent 52 prompts."
   - "Seven commits landed while you worked."
   - "This session used 194.1M tokens, added 2,101 lines and removed 186."
   - "98% of that was the conversation re-reading itself, which is normal in a long session and is the main reason cost climbs the longer you go."
   - "The most expensive stretch cost 23.4M tokens, 97% of it re-reading the conversation so far, and it wrote 412 lines."
   - "One thing in this session is worth a second look, 22 minutes of it."
   Then Kicker "worth a second look", heading **"22 minutes of this session went here"**, note "One file was rewritten 6 times across 22 minutes. A file on its fifth pass usually needs a decision, not another attempt." and meta "Measured on your machine. The command that kept failing and the file that was rewritten stay there; only the counts travel."
   Then doors (words + arrow, DOOR_TITLE 28/33/800) to the codebase map and time lapse.
5. **Burn** band (ember) with a spike chart; **Call by call** band (cobalt); **The reading** band (iris, the model's analysis). (`BurnSection.tsx`, `CallsSection.tsx`, `analysis/AnalysisView.tsx`)
6. **The card** (`Share.tsx`, section marginTop 56): hairline, Kicker "the card", the **RecapCard** (see §4) at width 353pt with 28pt corner radius, then doors: "Post to the feed" / "Photos, a caption, and who sees it." and "Save this card as an image".

Running session: top of page shows the LiveBar mirroring the Lock Screen card and the caption "active so far"; end clock says "now".

### 2.4 Recap sheet (opened by the "Session finished" push, `?recap=1`)
`mobile/src/recap/RecapSheet.tsx`, `recap/format.ts`. Modal: header row "Not now" (secondary) · **"Session recap"** headline 17/600 centred. Then a Surface (card `#1E1B18`, radius 18): hero strip full width, title role 22/700 headline (**"Wire live vehicle positions into the guidance map"** or "Agent run · 1h 42m" for unattended, else "5h 17m session"), meta "tramline (sample) · yesterday". Section "Title" text field placeholder "Name this session". Section "Numbers": one StatGrid of tiles labelled lower-case: attended, autonomous (or active), prompts, lines added "+2,101", commits "7", files touched "38", tokens "194.1M" ("not recorded" when the harness has none). Section "Analysis" with Bit celebrating for 3s beside the analysis headline. Then visibility (Private / Followers / Public), caption, **Post** button.

### 2.5 Now tab = mission control (live sessions)
`mobile/app/(tabs)/now.tsx`, `mobile/src/live/LiveSessions.tsx`, `MissionTile.tsx`, `mission.ts`, `fit.ts`.

**Summary band** (accent hue; title **"Mission control"** with arrow on the Now tab, "Right now" on `/live`) (`LiveSessions.tsx:593-649`):
- headline row: count + word at one size, fit 34..64pt, 800, `#1C1917`: **"1 needs you"** / **"3 running"**.
- lines under it: first as bandCaption, rest bandNote: e.g. **"5 running"**, or "Nothing needs you." then "1 finished".
- crew row (marginTop 14, gap 8): up to 8 creatures printed 32pt in `#1C1917`, one per running session in order.

**Tile grid** (paddingHorizontal 16, gap 12, wrap). Order = engine's needs-you score. Variants (`mission.ts:107-135`, `fit.ts:144-148`):
- first tile **lead** (full width 361pt), the rest **half** (174.5pt wide on 393), an unpaired last one **wide** (full width). Half tile height 188pt.
- Tile = square block of its **crew creature's hue** (no radius, prints itself cell by cell over 440ms); all text `#1C1917`. A stale tile loses the colour: `#282420` with `#F5F1EA` text.
- Layout inside (pad lead 18 / wide 16 / half 14):
  - head: harness logo on a 6pt-radius **stamp** filled `#1C1917` (logo size 20/18/16) + repo in SF Mono 600 (15/14/13).
  - the sentence (lead 26/30 800, wide 21/25 800, half 17/21 700).
  - state row: glyph + word 800 (17/15/14): "needs you" with `hand.raised.fill`, "converging" ⟶ glyph, "circling" ↻, "lost" (dashed arc), "starting", "quiet", "finished", "not updating".
  - figures: elapsed **"28m"** (lead 44 / wide 34 / half 30, 800) and **"11 files"** (caption 12-13/700 "files", "so far").
  - creature printed bottom-right, dark ink (80 / 64 / 48pt).
  - foot track: elapsed vs typical run as a pixel bar (6/5/4pt), solid then dotted, only when the ETA is honest.
- The top needs-you tile gets a **StarBorder comet** (a 3pt `#F5F1EA` head running round its edge, settles to 2pt) and is the only moving creature.
- **Verdict glyph SVG paths** (viewBox 0 0 18 18, stroked, `mobile/src/ui/verdicts.ts:18-23`):
  - converging: `M2.5 3.5 L13 8 M2.5 8 L13 8 M2.5 12.5 L13 8`
  - circling: `M11.9 4.1 A5.5 5.5 0 1 1 8 2.5 M6.9 0.3 L9.4 2.5 L6.9 4.7`
  - lost (dashed): `M10.4 3.05 A5.5 5.5 0 1 1 5.6 3.05`

**Sample grid** `?sample=grid` **(computed** via `missionSample('grid')` + `tileModel`), summary **"1 needs you" / "5 running"**:
| # | variant | harness | repo | corner | sentence | state | figures | eta line |
|---|---|---|---|---|---|---|---|---|
| 1 | lead | Claude Code | lantern | **needs you** (600, accent) | Waiting on you for four minutes | needs you | 47m · 23 files | since 10:55am |
| 2 | half | Codex | tramline | 28m | Stuck on the same failing command for six minutes | circling | 28m · 11 files | |
| 3 | half | Cursor | private repo | 19m | Editing four files it has not read yet | lost | 19m · 17 files | |
| 4 | half | Claude Code | tramline | 12m | Rewriting a source file, third attempt | converging | 12m · 9 files | about 9m left (track 60%) |
| 5 | half | Gemini CLI | lantern | 3m | Reading the docs | starting | 3m · 4 files | no ETA yet |
`?sample=all` adds: opencode · lantern · 1h 04m · "No new output for six minutes" · quiet (dimmed) · "since 10:53am"; Claude Code · tramline · 33m · "Waiting on two background tasks it started" · "longer than usual".
Finished tile: "Finished, with two files changed" · figures **"+64 -12"** "lines" · "1 commit".

**Empty state** (`LiveSessions.tsx:659-760`): the whole screen is the accent band titled **"All quiet"**; **Bit asleep** 96pt in `#1C1917`; **"Nothing needs you."** fit 40..60pt, 800, arriving word by word; **"Go do something else."** 22/27/700; at the foot, the last finished session as one line + arrow (bandNote).

### 2.6 You tab (profile)
`mobile/app/(tabs)/you.tsx`, `mobile/src/you/Hero.tsx`, `Doors.tsx`, `chapters.ts`. Header "You" + gear.
**Computed from `mobile/src/insights/fixtures/report-2026-09-13.json`** (the real owner's 30-day report, trimmed):
1. **Hero band** in the accent (`you/Hero.tsx:33-158`): title = your name (e.g. "Vedant"; "You" if none). Your **type** set huge letter by letter: **"Quality guardian"** (58pt, 52pt if >14 chars; 800; -1.6; line 1.02). Row (marginTop 18, align bottom): three ledger lines, each figure 40pt 800 `#1C1917` + bandNote label:
   **"74.5" hours with you there** · **"158" sessions your Mac read** · **"50,177" lines shipped**; creature printed at right, `min(160, floor(inner*0.45/16)*16)` = 144pt (9pt cells). Under band (meta): "Scored on your Mac from 158 sessions. 85.2 active hours in all. Up to 1.2 of the hours with you there were in sessions that ran at the same time."
2. **Door bands** (marginTop 22 each, doorway arrow). Hues: analysis cobalt, wrapped brass, money ember (re-assigned if equal to your hue) (`chapters.ts:275-300`):
   - **"Your analysis"** → **"27"** "days with a session, Aug 11 to Sep 12"; note "Time, shipping, you and your agent, helper agents, money, you against you, quality, what stands out, and the words."
   - **"Wrapped"** → **"14"** "of 15 questions answered"; note "Which kind of builder are you? Quality guardian."
   - **"Money"** → **"$2,952"** "what the tokens would cost at API list prices"; note "On a subscription you pay your plan, not this." (can be masked "$•••")
3. **Word doors** on the ground (title 36/40/800/-0.9 in hue + bold arrow 24pt; figure 44pt in hue + lead caption): **Dimensions** (heather; refusal "Each session is scored on five axes once your Mac analyses it. No session has been analysed yet, and it takes 3."), **Glossary** (orchid; "6" "of 74 terms found", "68 more to find."), **Your stack** (tide; "12" "things across 2 categories", "Languages  Frameworks" in their hues, "Python, JavaScript, Expo, HTML, and 8 more.").

Empty: band "You", "No sessions yet." 44/46/800, creature ≤192pt, "Finish a session on your Mac and this page fills in: your type, your numbers, your Wrapped." then link "Connect your Mac".

### 2.7 Analysis page ("Your analysis") incl. records and the contribution graph
`mobile/src/insights/AnalysisScreen.tsx`, `sections/*.tsx`. Numbered chapters, each a Band with index + title: **01 Your type**, **02 Time**, **03 Shipping**, **04 With your agent**, **05 Agents**, **06 Money and burn**, **07 You against you**, **08 Quality**, **09 What stands out**, **10 Words and stack**. Chapters are 56pt apart. Coverage line (computed): "Aug 11 to Sep 12, as your Mac read them: 158 sessions on 27 days."

- **01 Your type** (`sections/Hero.tsx`): name "Quality guardian" 56pt; "at least" / **"4.9"** (fit 40..64) / "test runs an hour" / "against a bar of 3"; creature (crab, coral band) ≤128pt; "55% confidence, over 158 sessions." Then Kicker "the rules, against their bars": per rule a 16pt creature mark + name + "bar 3", a track (12pt for the winner, 6pt others) in the hue with a `#F5F1EA` tick at the bar: Quality guardian 0.81 "at least 4.9 test runs an hour" (crab/coral); Velocity machine 0.605 "589 agent lines an hour, past its bar" bar 487 (bee/brass); Skeptic 0.544 "44% of prompts stop or redirect it, past its bar" bar 40% (whale/tide). Kicker "in all" + ledger 48pt.
- **02 Time** (amber band, `sections/Time.tsx`): streak figure **"11"** (≤104pt) + unit "days straight" (24/28/700) + count marks + "20 days in all had a commit and a session with you there."
  - **Contribution graph** (Kicker "every day, by hours at it"; `Time.tsx:126-157`): columns = weeks (8), rows = Mon..Sun, gap 6pt when ≤10 weeks else 3pt, cell = `floor((353 - gap*(weeks-1))/weeks)` = 38pt at 8 weeks; square cells (no radius), colour = graph ramp level; days before the first session are **outlined** squares in `#2F2B27`; month labels ("Aug", "Sep") 11/600 `#6B655D`. Fills in on a diagonal wave (380ms). Caption: "Each square is a day, darker to brighter by hours at it: 28 days of the last 8 weeks had some. Outlined squares are before the first sitting on record, which is not the same as a day off."
  - Sample levels (computed; `o` = before first sitting; rows Mon..Sun, cols oldest→newest):
    ```
    o o o o 4 3 2 0
    o o o 1 5 4 0 2
    o o o 3 4 4 2 1
    o o o 4 3 4 0 0
    o o o 4 3 2 1 3
    o o o 3 1 1 0 5
    o o o 2 1 2 0 2
    ```
  - Day clock (Kicker "when in the day"): 24h dial ≤210pt, "**11am** you build most", "**22%** of your active time is between 10pm and 4am".
  - **Records ledger** (44pt figures in amber): **"3h 06m" your longest session** ("The longest of 132 sessions with you there."), **"19" sessions past an hour** ("Averaging 99 minutes of focus each."), **"20" days in a row with a commit** ("24 days in all had a commit, with an agent in the room or not."). Notes: "Your longest day was Aug 18, 8h 38m with you there." "The most code landed on Aug 15: 19,535 lines."
- **03 Shipping** (tide): **"+50,177"** / **"-1,941"**; **"247"** commits ("232 with an agent in the room", "15 on your own"); languages Python 26,273 (52%), Swift 10,196 (20%), JavaScript 6,146 (12%), Markdown 2,295 (5%), TypeScript 2,192 (4%), HTML 1,113, YAML 570, SQL 460; "Mostly source code." "69% of agent lines went to source files, 22% to test files."
- **04 With your agent** (heather): **"44%"** "of the time, you stop the agent or redirect it" ("151 interrupts and 252 corrections across 927 prompts."); style "Hands on the wheel."; prompts avg "29.9" words, median 16; "7" prompts a session.
- **05 Agents** (brass): "39 agents, 3h 27m of agent work between them."; peak 9 at once; "3 sessions at once".
- **06 Money and burn** (ember): **"$2,952"** "at API list prices, read Sep 6"; Opus 5 $2,484 (147 sessions · 7.9M output tokens · $12.59 a commit), Fable 5 $457, Fable 5.1 $10.98; **"4,170.5M"** "tokens, 99% cache reads" (cache reads 4,117.1M 99%, cache writes 44.8M 1%, output 8.6M under 1%, fresh input 85k under 1%); "$34.65" an hour.

### 2.8 Projects tab
`mobile/src/projects/ProjectsScreen.tsx`, `Door.tsx`, `model.ts`. Hero band (accent) title **"Where your hours go"**: figure (56..112) **"2"** + caption "projects on your Mac", creature ≤128pt at right; line figure 44pt **"6"** + "hours with you there on your Mac, Aug 11 to Sep 12"; bandCaption "50% of it in Private project 1." Then each project as a door band (marginTop 40) in its own hue with index "01", title = stage ("Active", "Dormant", ...), project name letter by letter (30..52pt, 800), two figures 44pt: **"3"** "hours with you there on your Mac" and **"50%"** "of your time, Aug 11 to Sep 12", then the week line. Private repos are named "Private project 1/2" (no-break space before the number). Then chapters "Rivers", "The rank race", "How they compare". (computed from `spec/fixtures/projects/block.json`)

### 2.9 Pairing (QR)
Phone (`mobile/app/pair.tsx`): full-screen camera preview; centred framing square **220x220, radius 18, 2pt border** `rgba(255,255,255,0.8)`, turning amber `#FFB300` on success. Bottom panel on `#141210` (padding 16/16/40): status body text **"Point the camera at the code on your Mac."** → "Pairing ABCD-1234…" → "Paired with <label>." with Bit **celebrating** 48pt beside it; link "Type it instead". Errors: "That is not a Builda pairing code." / "That code was not recognised, or it expired. Try again." Camera notice "Builda uses the camera only to read the pairing code on your Mac."
Mac side (`Packages/BuilderKit/Sources/BuilderUI/PairingQRView.swift`): QR of `builder://pair?code=XXXX-XXXX`, nearest-neighbour scaled, on a white rounded rect (radius 8, padding 10), side 220; under it the code in 28pt semibold monospaced, kerning 2; "Open Builder on your phone → Settings → Scan code" 12pt dim; "Copy code" 11pt medium amber. CLI: `builder pair` prints "Open Builder on your phone → Settings → Scan code, and enter:" + boxed code, then "Paired — this Mac is linked as “<label>”. Run `builder sync` to upload."
Onboarding connect step: "Connect your Mac." / "Run **builder pair** on your Mac, then type the code it shows or scan its QR code with the Camera app." placeholder "XXXX-XXXX", button "Pair" (`onboarding/copy.ts:133-165`).

### 2.10 Feed / post (social; routes exist but nothing in the tabs links to them)
`mobile/src/social/FeedList.tsx:176-300`. Each post is a **card** `#1E1B18`, radius 12, padding 16, marginBottom 8:
- line 1 (baseline, gap 6): author 14/600 `#F5F1EA` · "· 4m" · "· tramline" (meta 12 `#A8A29A`) · right: duration "5h 17m" tabular (or "shipped" for a build post).
- the **row strip** (12pt tall, radius 3, per-point texture with density alpha) at width `393 - 64 = 329pt`, marginVertical 8.
- analysis headline 17/22/700 (or session title 15/600), summary 13/18 dim, caption 14/19, photo grid, audio chip.
- action row (gap 16, marginTop 16): pills 32pt tall, radius 999, 1pt border `#2F2B27`, padding-x 16: **"Kudos · 3"** (filled amber `#FFB300` with `#1C1917` text "Kudos given · 4" when on), **"2 comments"**; "only you" / "followers" meta.
- Relative time: "just now", "4m", "3h", "2d", then a short date.

### 2.11 Factions / leaderboard
`mobile/app/factions.tsx`. Plain cards (`#1E1B18`, radius 18, padding 16). Create card: label "create" + input "Faction name" + "Create". Join card: "join by code", placeholder "XXXX-XXXX", "Join". New faction shows "join code" + code in 40pt/800, tracking 4; share text "Join <name> on Builda with code <code>". Each faction card: name 17/700 + "Feed" (amber 13/600); "/slug · 5 members · you admin" (12 dim); board header "<week> · <start> → <end> · code ABCD-EFGH"; table header (12/700 dim): `#  builder  attended  sess.  longest`; rows 13pt with hairline tops, your row bold, hidden hours say "private"; switch "Share my hours on the board" (amber track). Empty: Bit waving + "Start a faction or join one with a code." "The board ranks attended hours this week."

### 2.12 Wrapped (15 cards)
`app/wrapped.tsx`, `src/wrapped/WrappedCardView.tsx`. Each card is a full-bleed band in its hue with radius 28, index (SF Mono 600 @0.62), question, the answer HUGE (counted or split-flap), one sentence (500 @0.82), and a living dithered data field; share export 1080x1350 with the wordmark. Grid cards: radius 18, question 12/15/600, answer 20/22/800. Card hues: builder_type = archetype, shipped brass, work_style tide, longest_session iris, agents_at_once ember, go_to_prompt orchid, streak coral, change_course cobalt, crash_out ember, prompt_length heather, deep_sessions iris, time_put_in amber, cryptic_prompt tide, prompts_per_session orchid, kind_of_work brass.
Sample deck **(computed** from `mobile/src/wrapped/sample.ts`):
| question | answer | sentence |
|---|---|---|
| Which kind of builder are you? | Quality guardian | At least 4.9 test runs an hour, at least one every 12 minutes. |
| How much did you ship? | 50,177 lines written, 247 commits | 232 of those commits landed during a session or in the 30 minutes before one. |
| How do you work with your agent? | Hands on the wheel. | 4 in 10 prompts stop or redirect it. |
| Your longest single session? | 3h 06m | The longest of 132 sessions with you there. |
| How many agents do you run? | 3 sessions at once | Inside them, up to 9 helper agents ran at the same moment. |
| What's your go-to prompt? | Sent 4 times across 4 sessions | 2 words you keep coming back to. |
| What's your longest streak? | 11 days straight | 20 days in all had a commit and a session with you there. |
| How often do you change course? | 44% of the time | 151 interrupts and 252 corrections across 927 prompts. |
| How long are your prompts? | 29.9 words on average | Mostly conversational. Half of them run 16 words or fewer. |
| How do you work? | 19 deep sessions | Averaging 99 minutes of focus each. |
| How much time did you put in? | 85.2 hours across 158 sessions | 74.5 of those hours with you there, up to 1.2 of them in sessions that ran at the same time. |
| How much do you talk to your agent? | 7 prompts a session | 11.3 tool calls for every prompt you send. |
| What kind of work is it? | Mostly source code. | 69% of agent lines went to source files, 22% to test files. |

### 2.13 Onboarding hello (good trailer opener)
`mobile/app/onboarding/hello.tsx`: a band in the accent filling the top, animated PixelBlast dither field in the hue's partner tone, **Bit 128pt** in `#1C1917`, headline **"Your build sessions, read back to you."** 40/44/800/-1 arriving word by word, then a rotating line "from Claude Code / Codex / Cursor…" (ReadsLine). Below on the ground: body dim "Builda reads what your coding agents write and tells you how every session went.", "⌃ swipe up" hint, capsule "Continue". Steps: hello, name ("what should we call you"), creature ("pick your creature", "6 of 8"), tools ("Pick your tools."), connect, notify; finale "this is you" / "Vedant, the fox" / "That’s me".

---

## 3. The session timeline strip

Spec: `spec/strip.v1.json`; decode `mobile/src/strip/decode.ts`; geometry `mobile/src/strip/layout.ts`; draw `StripDraw.tsx` (animated Skia) and `TimelineStrip.tsx` (still SVG).

**Data.** 1024 columns (base64, 1 byte each): bits 0-1 = class (0 idle, 1 prompting, 2 agent, 3 human_edit), bits 2-3 = density bucket 0..3 (events/s thresholds 0.05, 0.20, 0.60). Column class = priority-weighted argmax over ms (prompting ×6, human_edit ×4, agent ×1, idle ×1). **Marks** are separate `[[ms_offset, kind], ...]` (kind 0 prompt, 1 commit, 2 compact) so a 5-second prompt can't be resampled away. Resample 1024 → W is ALWAYS nearest-neighbour on column centres. Marks dedupe within 3px.

**Colours** (dark): idle `#2A2724`, prompting `#EDE6D8`, agent `#FFB300`, human_edit `#19C4B0`; marks prompt `#F5F1EA`, commit `#19C4B0`, compact `#6B655D`. "Amber dominance = the agent was working. Bone notches = you spoke. Teal = you typed code." (`tokens.json:18`)

**Presets** (`layout.ts:33-62`):
| preset | used in | height | geometry |
|---|---|---|---|
| **hero** | session page route, share card, recap sheet | 72pt | moves lane 12 · gap 5 · activity 46 · baseline 1 (+8 spare) ; bars averaged to ~3pt wide; marks 3pt wide |
| **mini** | Sessions list rows | 30pt | moves 5 · gap 3 · activity 21 · baseline 1; bars ~2pt; marks 1.5pt |
| **row** | feed posts | 12pt, radius 3 | per-point columns, full height, alpha by density |
| **sparkline** | small | 8pt, radius 2 | per-point, 2 density buckets |

**Bar presets (hero/mini) — how to draw** (`layout.ts:87-175`):
1. Resample to `round(width/bar)` columns (hero: 353pt → 118 cols of 2.99pt).
2. **Idle draws nothing** (a pause is empty space above the floor).
3. Each non-idle column is a bar rising from the floor in its class colour at full opacity. Height = activity × `[0.34, 0.58, 0.80, 1.0][density]`, min 2pt; **prompting columns are always full height** (a bone tick). Bars at y = moves+gap+(activity-h). Adjacent equal bars merge. Bars get `rx 1` in SVG, width +0.5 to avoid seams.
4. **Moves lane** (top 12pt): each mark is a full-lane-height tick (3pt wide on hero) in the mark colour, clamped inside the width.
5. **Floor**: a 1pt line in idle `#2A2724` across the full width at y = moves+gap+activity (hero y=63).
6. No corner radius on hero/mini.
7. Animation (`StripDraw.tsx:32-148`): floor traces left→right with ease over `sweepMs` (1000 on the session page, 620 in rows); each bar springs up (420ms, damping 0.72) when the trace passes it + up to 90ms hashed jitter; marks drop in 140ms behind the trace over 260ms.

**Row/sparkline presets**: every column full height, colour by class, opacity = densityAlpha `[0.72, 0.84, 0.92, 1.0]` (idle opacity 1), then marks as 1.5pt ticks full height.

**Sample strip** (`SAMPLE_SESSION`, `mobile/src/data/client.ts:47-53` = `spec/fixtures/strip_realistic.json`): four identical ~256-column blocks, each = 8 prompting cols (d3) → ~228 agent cols alternating d2/d3 → 20 human_edit (d1) → ~56 idle. Totals: prompting 32, agent 688, human_edit 80, idle 224. Marks `[[0,0],[6120000,0],[12240000,2],[24474000,0]]` over 24,480,000 ms. Laid out at hero 353pt: 30 bar rects, marks at x 0, 86.75, 175 (compact, grey), 350; floor y 63. Accessibility label: "Session timeline: 68 percent agent working, 3 percent prompting, 8 percent your edits, 20 percent idle. 4 prompts." Full decoded columns and precomputed rects for hero@353, mini@307, row@329, hero@1448: **`reel/builda/assets/data/sample_strip.json`**.

**Terminal version** (the `▐███▁▅▁···` look; `Packages/BuilderKit/Sources/builder/AnsiStrip.swift:24-87`): 60 chars wide; idle = `·`; other classes by density `▁ ▃ ▅ █` (d0..d3) in the class colour (24-bit ANSI); a prompt mark column = `▐` in `#F5F1EA`; a compact mark = `┊` in `#6B655D`. README example (`README.md:10-15`):
```
  Fri 7 Aug 09:03   gt-transit           +2,101 lines
                    5h 17m active of 6h 48m    52 prompts   215 tools   194.4M tokens
                    ▐███▁▅▁·······▐██▅▁▁▁·····▐█▅▁▁·····▐███▁▅▅▁▁···▐█▁▅
```

---

## 4. The recap / share card

`mobile/src/card/RecapCard.tsx` (mirrors the Mac's `RecapCardView.swift`), words in `mobile/src/card/model.ts`.
- **16:9, 1600x900 units** (the Mac renders at 1600x900 @2x). On the phone it is laid out at the page's inner width (353pt → `s = 0.2206`) and captured at pixelRatio 2 (`mobile/src/card/export.ts:20-27`). All sizes below are in 1600-wide units (`s = width/1600`). On the session page it is shown at 353pt wide with **28pt corner radius** (`Share.tsx:98`); the card view itself has no radius (export radius token `card` = 24).
- Background `#1E1B18` (card), padding **76** all round. Column layout:
1. **Header row** (baseline aligned): repo label **SF Mono 30/600 `#F5F1EA`** "tramline (sample)" · 16 gap · date **26/500 `#A8A29A`** "Saturday, August 29" (weekday long, month long, day) · flex · harness logo 32 in text colour (brand colours kept for Claude/Codex/Gemini) · 10 gap · **harness 26/600 `#F5F1EA`** "Claude Code" + model **26/500 `#A8A29A`** "  Opus 5".
2. **Headline** (flex 1, vertically centred): **84 / 800**, tracking -2.94, line 91, `#F5F1EA`, max 2 lines, shrink to fit. Sample **(computed)**: **"9 of every 10 lines came from Opus 5, at least"**.
   Headline ladder (first true wins, `model.ts:226-248`): personal record "5h 17m, longest session yet" → "<Nearly every line | 9 of every 10 lines | 3 of every 4 lines | About half the lines> came from <Model>, at least" (≥200 agent lines + known model) → "7 commits" (≥5) → "+2,101 lines" (≥1000) → "5h 17m in one sitting" (≥45m active) → the title (if not a chore, ≤60 chars) → the duration.
3. **Strip block** (marginBottom 40): **hero strip** at width `card width - 152 units`. NOTE the hero preset height is a fixed **72pt** (it does not scale with `s`): on the phone the card is 353x198.6pt and the strip is 72pt tall (about 36% of the card height), and the export captures that same view at pixelRatio 2 (706x397px). Under it a row (marginTop 14 units) of SF Mono 24 units `#A8A29A`: start **"9:12am"** · centred **"5h 17m active · 6h 48m elapsed"** · end **"4:00pm"**.
4. **Stats row**: equal-flex columns, value **44 / 800** tracking -1.54 `#F5F1EA`, label **22 / 500 `#A8A29A`** under it. Order, each only when > 0: active duration, commits, "+N lines", files, prompts (always), tokens (only when the harness reports them). Sample: **"5h 17m" active · "7" commits · "+2,101" lines · "38" files · "52" prompts · "194.1M" tokens**.
5. **Foot** (marginTop auto): **16x16 square** in the user's accent (creature hue) · 10 gap · **"Builda" 26/800**, tracking -0.3 · flex · SF Mono **22** `#A8A29A` **"your build sessions, read back to you"**.
- Deliberately absent: cost and a legend (`RecapCard.tsx:23-27`).
- Token formatting `human()` (`mobile/src/copy/numbers.ts:262-268`): ≥1M → one decimal + "M" with thousands grouping ("194.1M", "4,170.5M"); ≥1k → "13k"; else integer.
- Duration `duration()` (`mobile/src/theme.ts:271-276`): floored minutes; "45s", "42m", "1h 05m", "5h 17m".
- Clock `timeOfDay()` (`mobile/src/copy/time.ts:22-33`): "9:12am", "12:40am", lower case, no space.
- Model name: "claude-opus-5[1m]" → "Opus 5" (`model.ts:288-297`).

Portrait Wrapped share export: 1080x1350 (`tokens.json` `card.portrait`). Card export type scale (`tokens.json:86-90`): headline 64/700/-1.5, meta 26/500, footer 20/400/+0.5.

---

## 5. Notifications, Live Activity, widget

### 5.1 Push notification copy (`mobile/src/push/localCopy.ts`, server `server/builder/notify.py:240-255`, `live_push.py`)
| event | title | body |
|---|---|---|
| attended session ended | **"Session finished: 1h 42m in builder"** (`Session finished: <attended h m>[ in <public repo>]`) | **"+420 lines · 9 prompts"** (else "Open it to see what landed.") |
| unattended run ended | **"Agent run finished"** | **"ran 1h 42m unattended"** |
| a session needs you | **"builder needs you"** (`<public repo> needs you`, else "A session needs you") | the engine's sentence, e.g. **"Waiting on you for four minutes"** |
Duration format in pushes `hm()`: "42m", "1h 05m". Tap on a finish opens `builder://session/<id>?recap=1` (the recap sheet). Simulator payloads: `mobile/scripts/sim/finished.apns`, `needs-you.apns`. Notification accent colour `#FFB300` (`app.config.ts:80`).

### 5.2 Live Activity (Lock Screen) `mobile/targets/widget/_shared/LiveActivityViews.swift:52-158`
Dark card, padding 14, HStack gap 12:
- left: **ring 52pt, stroke 4** around the session's creature (32pt) in its hue. Ring = arc of elapsed/typical in the hue (track `#2F2B27`), or a dotted ring (`#6B655D` dots every ~4.5pt) when no ETA.
- right column: header row = repo **SF Mono 14/600 `#F5F1EA`** + harness mark 14pt + harness name 13/500 `#A8A29A`; trailing: live timer 15pt (or "needs you" 15/600 with hand in the hue, or "ran 1h 42m").
- sentence **16/600 `#F5F1EA`**, 2 lines, marginTop 3: "Rewriting a source file, third attempt".
- caption 13/500 dim, marginTop 5, parts joined by " · ": e.g. "done around 4:09pm · converging · 3 files changed", "waiting since 10:55am", "no ETA yet", "running longer than usual", finished: "+420 -88 · 3 commits" in add/del colours; stale: "Not updating since 9:41am".
Dynamic Island: compact leading = creature 32pt; trailing = elapsed 15-18pt bold; expanded = creature 16 + repo 15/600 mono, sentence 15/600, progress capsule 84pt wide.

### 5.3 Home Screen widget `mobile/targets/widget/_shared/HomeWidgetViews.swift`, `BuilderHomeWidget.swift`
Families: systemSmall, systemMedium; background = scheme bg (`#141210` dark / `#FBF9F5` light). Fonts SF Pro via `.system(size:weight:design:)`, medium or heavier only.
- **Small, running** (`HomeWidgetViews.swift:176-229`): top row: repo **13/600 mono** (e.g. "tramline") + spacer + creature 16pt in its hue · spacer · **big number 28/heavy, tracking -0.5** (elapsed "12m"; needs-you: time waiting; done: "ran 1h 42m") · sentence **13/600**, ≤3 lines ("Rewriting a source file, third attempt") · state line 12pt, marginTop 3 (6pt dot in hue + "needs you" / verdict word / "no new output for 6m" / "✓ finished", then "· 4 more").
- **Medium, running**: left column = the small layout at 150pt wide; 1pt `#2F2B27` divider; right = up to 3 more session rows (repo 13/500 mono + elapsed 13/600; under it harness + state 12pt), 1pt dividers with 4pt vertical padding, then "+1 more running" 12/600. With only one session the right side is Today: "today" 12/600 dim, **"2h 14m" 22/bold**, the 7-day row, "Nothing else running." 12/500.
- **Small, idle**: **Bit asleep** 32pt in amber (`bit-sleeping`), spacer, **"2h 14m" 34/heavy, tracking -0.6**, "today" 12/600 dim, **week row** (marginTop 8): seven **14x14 squares, radius 3, gap 4**, colours = graph ramp by level; sample levels `[2, 0, 3, 4, 1, 5, 3]` (today last). Without data: "Nothing running."; medium idle right column: "Nothing running." 15/600 + "Your agents show up here while they run." 13/500 dim.
- Fixture snapshot `widgetFour` (`LiveFixtures.swift:140-154`), 5 running: lantern · Claude Code · needsYou "Waiting on you" (octopus, 47m, 5 files, waiting 4m) | tramline · Claude Code · "Rewriting a source file, third attempt" converging (whale, 12m, 3 files, ETA +9m) | tramline · Codex · "Stuck on the same failing command" circling (dog, 31m) | lantern · Gemini CLI · "Reading the docs" (fox, 3m).
- Copy constants (`LiveDisplay.swift:222-248`): "needs you", "finished", "not looked at yet", "no new output", "Not updating since", "no ETA yet", "running longer than usual", "waiting since", "done around", "ran", "nothing written, nothing committed", "Nothing running.", "Nothing else running.", "Your agents show up here while they run.", "today", "3 files changed".

---

## 6. Realistic sample data the app itself ships

- **Sample session** (`mobile/src/data/client.ts:24-71`, shown before sign-in and in App Review): repo **"tramline (sample)"**, harness claude_code, started 2026-08-29 13:12Z, span 6h48m, active 19,020s (**5h 17m**), idle 5,460s, title **"Wire live vehicle positions into the guidance map"**, engine title (sample page) **"Shipped changes to nine source files"**; tokens in 2.1M / out 410k / cache read 190M / cache write 1.6M → **194.1M**; model claude-opus-5 → "Opus 5"; **52 prompts, 38 files, +2,101 lines (-186 removed), 7 commits**, attended 4h 12m, agent_line_bucket nine_in_ten. Burn: 194.11M tokens, 52 segments, priciest stretch 23.4M tokens, 412 lines (`mobile/src/session/samples.ts:52-60`).
- **Invented repo names** used by all fixtures: **"lantern"** (the Builda repo's stand-in) and **"tramline"** (RideGT's stand-in), plus "tramline-web" (`mobile/src/live/mission.ts:975`). Private repos render as "Private project 1/2" or "private repo".
- **Live fixtures** (`mobile/src/live/fixtures.ts:171-275`, `LiveFixtures.swift`): lantern 47 min in, 23 files, +1,180 lines, 2 commits; tramline 12 min into a typical 21-min run, 9 files, +214 lines; tramline under Codex stuck 6m12s on a failing command (fail run 5); lantern under Gemini 3 min in reading docs; done: "Finished, with twelve files changed" +420 -88 · 3 commits; today 2h 14m attended, week `[2,0,3,4,1,5,3]`.
- **Real-shaped 30-day report** (`mobile/src/insights/fixtures/report-2026-09-13.json`): 158 sessions on 27 days (Aug 11 to Sep 12), 85.2 active hours, 74.5 attended, 50,177 lines +, 1,941 -, 247 commits, 927 prompts, 4,170.5M tokens, $2,952 at list prices, longest session 3h 06m, 11-day streak, archetype Quality guardian (crab/coral), peak hour 11am, night share 22%.
- **Harness display names** (`mobile/src/pixel/harness.ts:274-283`): Claude Code, Cursor, Codex, Gemini CLI, Cline, opencode, Aider (card says "cursor-agent" for the CLI).
- Other copy seen in the corpus notes: repo "gt-transit" (the owner's real repo, README example), "builder".

---

## 7. Icon path data

Tab icons are **SF Symbols** (`bolt(.fill)`, `list.bullet.rectangle(.fill)`, `folder(.fill)`, `gearshape`, `arrow.right`, `hand.raised.fill`, `checkmark`, `chevron.up`), not SVG, so there is no path data in the repo for them; the You tab icon is the creature pixel grid (§1.6). For the renderer, draw them from SF Symbols exports or an equivalent (e.g. Lucide `zap`, `list`, `folder`, `settings`, `arrow-right`).

**Harness logos** (the owner-supplied marks, viewBox `0 0 24 24`; `mobile/src/pixel/harnessLogos.ts`, source SVGs copied to `assets/harness/`). Mono marks fill with the adjacent text colour; colour marks keep their brand colours.
- **Claude** (`claude-color.svg`, fill `#D97757`): see file (single path, ~1.5KB).
- **Codex** (`codex-color.svg`): white rounded square `M19.503 0H4.496A4.496 4.496 0 000 4.496v15.007A4.496 4.496 0 004.496 24h15.007A4.496 4.496 0 0024 19.503V4.496A4.496 4.496 0 0019.503 0z` + a cloud glyph filled with a vertical gradient `#B1A7FF → #7A9DFF → #3941FF` (see file).
- **Gemini** (`gemini-color.svg`): 4-point star `M20.616 10.835a14.147 14.147 0 01-4.45-3.001 14.111 14.111 0 01-3.678-6.452.503.503 0 00-.975 0 14.134 14.134 0 01-3.679 6.452 14.155 14.155 0 01-4.45 3.001c-.65.28-1.318.505-2.002.678a.502.502 0 000 .975c.684.172 1.35.397 2.002.677a14.147 14.147 0 014.45 3.001 14.112 14.112 0 013.679 6.453.502.502 0 00.975 0c.172-.685.397-1.351.677-2.003a14.145 14.145 0 013.001-4.45 14.113 14.113 0 016.453-3.678.503.503 0 000-.975 13.245 13.245 0 01-2.003-.678z` base fill `#3186FF` with green `#08B962`, red `#F94543`, yellow `#FABC12` gradient overlays.
- **Cursor** (mono): `M22.106 5.68L12.5.135a.998.998 0 00-.998 0L1.893 5.68a.84.84 0 00-.419.726v11.186c0 .3.16.577.42.727l9.607 5.547a.999.999 0 00.998 0l9.608-5.547a.84.84 0 00.42-.727V6.407a.84.84 0 00-.42-.726zm-.603 1.176L12.228 22.92c-.063.108-.228.064-.228-.061V12.34a.59.59 0 00-.295-.51l-9.11-5.26c-.107-.062-.063-.228.062-.228h18.55c.264 0 .428.286.296.514z` (evenodd)
- **Cline** (mono): `M17.035 3.991c2.75 0 4.98 2.24 4.98 5.003v1.667l1.45 2.896a1.01 1.01 0 01-.002.909l-1.448 2.864v1.668c0 2.762-2.23 5.002-4.98 5.002H7.074c-2.751 0-4.98-2.24-4.98-5.002V17.33l-1.48-2.855a1.01 1.01 0 01-.003-.927l1.482-2.887V8.994c0-2.763 2.23-5.003 4.98-5.003h9.962zM8.265 9.6a2.274 2.274 0 00-2.274 2.274v4.042a2.274 2.274 0 004.547 0v-4.042A2.274 2.274 0 008.265 9.6zm7.326 0a2.274 2.274 0 00-2.274 2.274v4.042a2.274 2.274 0 104.548 0v-4.042A2.274 2.274 0 0015.59 9.6z` + `M12.054 5.558a2.779 2.779 0 100-5.558 2.779 2.779 0 000 5.558z` (evenodd)
- **opencode** (mono): `M16 6H8v12h8V6zm4 16H4V2h16v20z` (evenodd)
- Aider has no supplied mark; it falls back to a pixel glyph (`mobile/src/pixel/HarnessGlyph.tsx`).

**Verdict glyphs** (viewBox 18, stroked): see §2.5.

---

## 8. Assets copied into `reel/builda/assets/`

| path | source | notes |
|---|---|---|
| `app/icon.png` | `mobile/assets/icon.png` | 1024², Bit amber on `#141210` |
| `app/splash-icon.png` | `mobile/assets/splash-icon.png` | 512², transparent |
| `app/adaptive-icon.png` | `mobile/assets/adaptive-icon.png` | 1024², transparent, smaller Bit |
| `app/favicon.png` | `mobile/assets/favicon.png` | 64² |
| `harness/{claude-color,codex-color,gemini-color,cursor,cline,opencode}.svg` | `mobile/assets/harness/` | viewBox 0 0 24 24; mono ones use `currentColor` |
| `creatures/widget-template-192px/creature-<id>.png` | `mobile/targets/widget/Assets.xcassets/creature-<id>-64.imageset/*@3x.png` | largest shipped raster (192px); **white on transparent templates**, tint at draw time. ids: cat dog fox owl bee whale octopus crab bit bit-sleeping |
| `creatures/hue-512px/<id>.png` | rendered by me from the source frames | 512², 32px cells, each in its creature hue (bit, bit-sleeping, bit-celebrating in amber) |
| `data/creature_frames.json` | `animals.ts` + `sprites.ts` | every frame of every creature and every Bit state, as 16×16 strings |
| `data/sample_strip.json` | `SAMPLE_SESSION.strip` | 1024 decoded `[class, density]` columns, raw marks, and the app's own `layoutStrip` rects for hero@353, mini@307, row@329, hero@1448 |

Notes: there are no font files, no Lottie, and no `design-refs/` directory in the repo (docs reference one, but it is absent). There is no drawn wordmark; recreate it as text.
