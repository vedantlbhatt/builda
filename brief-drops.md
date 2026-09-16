# The drops brief

What was asked on 2026-09-15, and the scope it settled into. `docs/drops.md` is the design;
`DROPS-PROGRESS.md` is where it stands — read that one first when resuming.

Branch `claude/drops`, worktree `~/Downloads/projects/builder-drops`, based on
`claude/overnight-analysis` (the most complete branch). The main checkout and the overnight
worktree are left alone.

## The verbatim ask

> on builda project build out a feature that allows me to send reels or tiktoks to the builda
> app. and then we shoudl be able to spin up projects, or whatevr the reel is raely about to
> stuff lie that. i shoudl ebba le to click shre ona reel or whatever for exmapel and then
> click buikda and then a clean builda-sryle ui sheet popos up affter u share it. and in buila
> im iamgingin this lie clean gri d ordotted background where u see all the reel su put or
> maybe its just alike a x # of rows and 2 oclumsn of evryhtign. and every reel u send,w e
> actually do soemthgi wit it. if its aclaude cod eskill thing, find it cuatomaitcally and have
> it reay o odwnaldo. if it s acoding optizmiaotn thing hten ahve it ready do do/simplement. or
> a proejc tidea then strat iplementing or have one button to starti impelentnign (go wit
> latter) or whater ifiis, if its a recipe video find all th eingendeiiencs, the uantitiy, the
> steps, an dmake like a u tha tshows the reipc estpe by step.
>
> there ar emany apps lk ehtis already so fiind them, find opee osruce things that do this too.
> abscialyl share ahtever reel uw ant and acutally tkak eavtion on it. i wanst t scope eths
> more so for builders and shit yk? but yeah whoekpoint is os that u can start budlign adn feed
> in this context anywhere and kick off tasks just form a reel or atealts liek shrae reel,
> claud ecreate aplan of possible thign sto do with it, u can come , select any/all u want ot do
> and then start off with it. pwoer this with claude ocd an dimplent dont stop unitl fulyl one.
> litearlly code for liek u hit otken lkimit. a dn the ncoding until until it refrehsed and u
> get more otens. do not stop for 10 hour straight. begin now.

## Read as requirements

1. Share a reel or a TikTok into Builda from the OS share sheet. One tap from the video.
2. A clean Builda sheet comes up on the share, not a form.
3. A board: dotted ground, two columns, every drop on it.
4. Every drop gets acted on, by kind:
   - a Claude Code skill: **find it automatically**, ready to install;
   - a coding optimisation: ready to do/implement;
   - a project idea: **one button** that starts implementing (the owner's explicit pick over
     starting automatically);
   - a recipe: every ingredient, its quantity, the steps, and a step-by-step screen.
5. Claude writes a plan of the possible things to do; the person picks any or all; then it runs.
6. Powered by Claude Code.
7. Scoped for builders. Recipe stays because it was asked for, and it earns its place as the
   control case (`docs/drops.md`).
8. Find the apps that already do this, open source ones included. Done, in `docs/drops.md`.

## Explicitly not in scope

No social layer for drops (no shared boards, no feed of other people's reels) — the overnight
brief's "I don't need social stuff right now" still holds. No video download, no audio
transcription, no logged-in scraping. No auto-run: a move is inert until tapped, which is
requirement 4's "have one button to start implementing" taken literally and applied to every
kind, not just project ideas.

## Working rules carried over

Commit incrementally and push each commit. Scan for private identifiers before the first push.
Keep `DROPS-PROGRESS.md` current so a cold resume works. Do not stop early.
