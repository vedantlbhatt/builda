# The overnight brief

Everything the owner asked for on 2026-09-13, organised so it can be looked up rather than
reread. The verbatim request is at the bottom. Companion files:

- `planzz.md`: the approved roadmap (also at `docs/approved-roadmap.md`). Parts 1 to 4.
- `burn-forensics.patch`: the burn forensics patch as it was handed over. Applied as commit
  `0533f35` on this branch (conflict in `analysis/__main__.py` resolved by keeping both sides).
- `PROGRESS.md`: what has been done, what is next, where the screenshots are. Read it first
  when resuming.

## Where the work happens

- Repo: `~/Downloads/projects/builder` (GitHub `vedantlbhatt/builder`).
- Branch: `claude/overnight-analysis`, worktree at `~/Downloads/projects/builder-overnight`,
  based on `origin/claude/hello-hvkwll` (the most complete branch: everything in `main` plus
  32 commits: pricing, report, cards, agents, contributions, the creature picker).
- The main checkout (`~/Downloads/projects/builder`, branch `main`) has the owner's own
  uncommitted work from August. Do not touch it.

## Scope

**In:** analysis, and everything a person sees of it. **Out for now:** the social layer
(feed, kudos, posts, follows). "I don't need social stuff right now."

Integrate with what exists. Do not build a second version of something the repo already has;
find the missing features and fill them in.

## What to build

### A. Onboarding and identity

1. Revamp the whole onboarding flow. Picking your name should feel smooth. Use the design
   libraries below to build it, not hand rolled defaults.
2. Icons are too complicated. The Claude icon in particular reads as an orange and black
   mess. Make every harness icon (Claude Code, Codex, Cursor, Gemini, Cline, opencode, Aider)
   the same simple family, presented through one consistent picker style.

### B. Part 1 of the roadmap (after a session ended)

1. Burn forensics on the recap card and the session screen; `barren_token_share` rollup in
   `analysis/profile.py`; Codex and Gemini adapters for `load_turns`.
2. The money view: dollars beside tokens beside lines, green added and red removed.
3. The five dimensions and the archetype get a real screen. Fix the five Paxel-anchored
   `BASELINES`.
4. The plain English summary for every session.
5. Vocabulary: engineer voice session titles, terms that unlock by encounter, a stack page,
   a glossary that fills over months.

### C. The Paxel style cards (from the owner's screenshot)

Integrate all of these. Each is a question and an answer:

| # | Question | Example answer on the Paxel card |
|---|---|---|
| 1 | Which kind of builder are you? | Generalist. No single working pattern dominates. |
| 2 | How much did you ship? | 229,367 lines across 1,000 commits and PRs worked |
| 3 | How do you work with your agent? | A back and forth. You work in dialogue. |
| 4 | Your longest single session? | 16h 0m, deepest uninterrupted stretch |
| 5 | How many agents do you run? | 3 at once |
| 6 | What's your go to prompt? | "<50 words", sent 5 times across sessions |
| 7 | What's your longest streak? | 29 days straight of shipping something |
| 8 | How often do you change course? | 6% of the time you stop and redirect mid task |
| 9 | Your biggest crash out? | the angriest prompt, quoted. "We've all been there." |
| 10 | How long are your prompts? | 108 words on average. Mostly conversational. |
| 11 | How do you work? | 46 deep sessions, averaging 205 minutes of focus |
| 12 | How much time did you put in? | 129 hours across 55 sessions |
| 13 | Your most cryptic prompt? | "Q7ZK2XW9PL". Somehow the agent knew. |
| 14 | How much do you talk to your agent? | 31 prompts a session |
| 15 | What kind of work is it? | Mostly fixes. 84 fixes and 78 features in commits. |

Visual language on Paxel's cards: a dithered halftone illustration in one hue on the top half,
three small dots like a window chrome, a thin dashed outline, cards slightly rotated in a
grid. Question in the accent colour, answer large and bold, one sentence under it.

"Do research in case I mixed stuff." Known tensions to resolve rather than guess:

- Card 7 (streak) sits against Part 4's rejection of consecutive day streaks. The rejection is
  about a streak as a retention MECHANIC; a card reporting a past fact is different. The
  attended time rule still applies: an unattended run can never extend a streak (CLAUDE.md).
- Card 9 quotes a prompt. `privacy/upload-contract.json` decides whether prompt text may leave
  the machine; a quoted prompt card is on device only unless the contract says otherwise.
- Paxel's own copy uses dashes; ours cannot.

### C2. What the research found about the Paxel list (the "in case I mixed stuff" check)

From `~/Downloads/projects/design-refs/research/paxel.md` and `SYNTHESIS.md` section 4:

- Paxel's own landing cards are: builder type, lines shipped, peak hour, planning, agents
  at once, model mix, prompt length, cryptic prompt, politeness, change of course, longest
  agent run, crash out, and a few more. **Longest streak (card 7) is not a Paxel card**; it
  looks like Cursor's year in review. **Kind of work (card 15) and deep sessions (card 11)
  are the owner's additions.** All three are kept, because the owner asked for them.
- The owner's example numbers cannot all be true on one clock: 46 deep sessions at 205
  minutes each is about 157 hours, inside 129 hours total. Builder uses one clock (attended
  time) for cards 11 and 12 so its own numbers cannot contradict each other.
- Four of the five "Paxel" `BASELINES` in `analysis/profile.py` do not come from Paxel at
  all but from an explainx.ai mock of a Paxel report. Only `steer_rate 0.4` is Paxel copy,
  and it describes a heavy steerer, not a norm. They get relabelled as unmeasured.
- Paxel's axes are execution_leverage (renamed from throughput), steering,
  engineering_quality, product_thinking and planning, scored 1 to 10 per episode with a
  0 to 1 confidence. Builder's per session dimensions are 0 to 100.
- Paxel counts prompt length in words; Builder counted characters. The card uses words.
- Quote cards (go to prompt, crash out, cryptic prompt) need prompt text, which never leaves
  the machine under `privacy/upload-contract.json`. They are computed on the Mac and reach
  the phone only through an explicit, off by default, owner only contract block. The cryptic
  prompt filter must drop IDs, OTPs and tokens: Paxel's own example ("Q7ZK2XW9PL") looks
  like exactly that.

### D. Part 2 of the roadmap (what is happening right now)

1. Mission control: two tiles per row, a tile is a session, mascot bottom right, sorted by
   who needs you most, and an empty state that tells you to go away.
2. One sentence, always current, per tile and per session.
3. Converging, circling or lost.
4. ETA, refusing a number until the corpus supports one.
5. The decision feed.
6. Live Activity (lock screen and Dynamic Island) and a home screen widget.
7. The codebase map.
8. Time lapse, last, and only if it looks right.
9. Notifications (finish, needs you).

Do NOT build remote control (Part 4).

## Owner override, 2026-09-13 09:22 (this wins over DESIGN-DIRECTION.md where they disagree)

After seeing the first build: "Use more of the UI and react bits stuff I gave you, you haven't
used ANYTHING yet. Also why are all of them the same color? Looks horrible. Make it look
beautiful, clean, dynamic, animated."

- The one accent rule is lifted. Keep the warm dark neutrals, but give identity real colour:
  each creature, each Wrapped card, each session tile gets its own hue from one harmonious
  spectrum. Amber stays the brand and the primary action.
- react-bits (and the Appllama patterns) must be VISIBLY used across the app: animated shader
  backgrounds, text animations, card stacks, lists, tap sparks, transitions. Ported to React
  Native with Skia and Reanimated, David Haz's notice kept.
- Beautiful, clean, dynamic, animated. Still no clutter: colour is spent on identity and
  data, motion on moments that matter, and nothing jitters while you read it.

Also asked: "what is $2951 in api usage? I don't actually have to pay that right?" No. It is
what the tokens would cost at Anthropic's public API list prices. On a subscription you pay
the plan. The money view must say so in words, never "you spent".

## Owner, 10:50: the product is Builda

"Rename everything to Builda not builder." Every user facing word says Builda (commit
`3665e85`). Kept: bundle id `com.vedantlbhatt.Builder`, App Group, APNs topic, the `builder://`
scheme and code identifiers, because a bundle id change breaks signing, push and widget data.

## Owner, 15:55: a Projects section, and the stack page revamped

"Have a projects section where users keep track of their behaviours for each project. Right
now it's overall profile or per session, but I want a breakdown of their project stats too...
brainstorm what we can get out of project level statistics: how they build each project,
what their most worked on ones are." And: "revamp the tech stack page too" (the old list).
Plan: `docs/projects.md` (metrics, privacy class, refusals), `analysis/projects.py`, a
`projects` report block, a Projects tab in the house style; the stack page rebuilt around real
technology logos (Simple Icons, CC0) in brand colours.

## Design mandate

Use these, do not hand roll:

- `https://github.com/Meliwat/awesome-ios-design-md`
- every usable repo in `https://github.com/Appllama` (plus the `appllama-app-design-skill` and
  `appllama-usage` skills now installed)
- `https://github.com/DavidHDev/react-bits`

Cloned into `~/Downloads/projects/design-refs/`.

Inspiration: Phantom (the crypto wallet). Take the expressiveness, do not copy it.

**Zero AI slop.** Specifically banned:

- gradients as decoration
- the tinted chip: a pale background, a border in the same hue, and text in the same hue again
- generic card soup, emoji as icons, centred everything, default system blue everywhere
- anything that reads as "generated". "It looks vibe coded" is a bug report.

Applies to every surface: screens, widgets, Live Activities, the Dynamic Island, icons.

## Verification the owner expects

1. Run on the iOS simulator and in Expo. Screenshot every feature: Live Activity, Dynamic
   Island, notifications, the ETA, mission control, the analysis screens, onboarding.
2. Test the analysis against real Claude Code sessions for this repo
   (`~/.claude/projects/-Users-vedantbhatt-Downloads-projects-builder*`) and for RideGT
   (`~/Downloads/projects/RideGT`).
3. Test the live features on THIS live session, the one building them, and screenshot that.
4. Code audits and review passes, then a UI pass judged on whether it looks designed.
5. At least five full test runs.

## Deliverable

An artifact to wake up to: every feature, mapped, with screenshots, showing that each one
works. List the UI libraries and components actually used.

## Working mode

About ten hours of work. Keep going through usage limits: when a limit hits, wait for the
reset and continue. If everything is done, iterate with `/loop`, because the first version is
never the best one. Do not stop to ask questions.

---

## The request, verbatim

> go to builder in projects and paste this in planzz.md: [the roadmap, see planzz.md]
> and these are burn forensices: [the patch, see burn-forensics.patch]
> buidl on top of what we already have. paste both fo theose docs in aserparet ifles in proj
> and keep refencing htem
>
> use these for desings na dushc: https://github.com/Meliwat/awesome-ios-design-md.git
>
> and go thur all of htese repsos afor all deisngs and suhc: https://github.com/Appllama
> gethwatevr u an for freeuse thigns ike reat bits here an dlocne this and hte other 2 (go
> arodun th llama app thing tp get all the repos) and clone them to replciate hte UI and
> these ddeisng. https://github.com/DavidHDev/react-bits.git
>
> Yeah. It's pretty important that you don't just use regular guy generate slot for UI. Every
> single thing, the widgets, the the live activities, the dynamic Allen stuff, the icons.
> Also, icons are very complicated right now. Make them simpler. Like, the Claude icon
> literally freak out where it's a orange and black thing. So make all the icons the same
> thing, the same picker thing. Like, revamp the entire onboarding flow kind of where you
> pick your name. Like, it's smooth and use all of the UI libraries I just gave you to
> actually, like, create it. And same for analysis. Right? Again, right now, we're just
> focusing analysis. I don't need social stuff right now, but, like, just keep working. I
> really ironed it out. I want you to keep working for Atelier quota, right, till you
> literally headquarter. If we bypass five hour limit, then we get five more quota, keep
> working. [...] I'll see you in around ten hours, I believe. [...] Use all the UI
> libraries. I want literally zero of your normal AI slot where you use, like, gradients or
> where you have, like, um, some background and then the border of one color and the and the
> letter version and the same color of the background. [...] the biggest lever I wanna see
> is, first of all, implement live activities, implement all the features sent you, and make
> sure you you create them and implement them well and clean. [...] run on the simulator and
> Expo. And they get pictures of everything. A lot of activity, dynamic island,
> identifications, how the ETA looks, how, you know, how you're making the the mission
> control thing look exactly how I ask it to. [...] once you hit quota, see how much time you
> have left [...] as soon as you get that quota back, keep working. [...] if you somehow do
> finish all this stuff [...] do a slash loop thing [...] and keep iterating [...] five test
> runs minimum [...] make it a lot artifact. I wanna wake up to an artifact that will every
> single feature map and every single thing works and use my Claude code sessions on this
> repo and on the [...] ride GT repo [...] has, like, tests for this analysis. [...] for all
> the live analysis stuff too, I want you to test it on this exact current thing. [...] take
> screenshots of that as well. Of literally every feature you build. [...] verify it off
> code audits, review audits, check your code code reviews, and then make sure AI UI is
> actually good. [...] I wanna see every single user app pitch thing you use, every single
> lumbar thing you use [...] Do research on good UI and [...] really dynamic stuff. [...]
> Phantom. I love the UI. So really a lot of expression on that, but don't copy obviously.
> [...] most probably use it from those libraries that gave you. [...] Make a deliverable
> [...] artifact [...] ten hours of red work. That's at least two sessions, three [...] of
> token resets [...] Just keep working, and you should be good. Good night.
>
> Also, store this entire prompt in an [MD file]. Like, not just copy and paste this stuff,
> but everything afterwards too. [...] so we can refer to it pretty easily.
>
> i expect u to intergtate with the existing stuff an work there is to uncaes twe are
> missing features. and integrate all of these paxel prompts too [screenshot of 15 Paxel
> cards, table C above] do reserahc in case i mixed stuff
