# The motion brief

What was asked on 2026-09-19 (~02:00 local), overnight, owner asleep, 10 hours minimum, no
questions. `MOTION-PROGRESS.md` is where it stands — read that one first when resuming.

Branch `claude/motion`, worktree `~/Downloads/projects/builda-motion`, based on `claude/drops`
(7a7ac16, the web board committed green). The other checkouts are left alone. The local stack
runs from this worktree: `OVERNIGHT_HOME=~/.builder-drops-stack OVERNIGHT_DB=builder_overnight_drops
OVERNIGHT_TEST_DB=builder_overnight_drops_test OVERNIGHT_PORT=8788 bash scripts/overnight_stack.sh up`
(`server/.venv` is a symlink to builder-drops' venv; `mobile/node_modules` and `mobile/ios` are
APFS clones of builder-drops').

## The ask, as requirements

1. **Drops, rethought.** "The current reel sending system sucks." A new way to show it, less AI
   looking, and a reason for reels to be in a build app that is not only "build something off a
   reel" (too narrow) and not "do anything with reels" (other apps already exist). Reels as
   context for builds is interesting but too niche on its own. Fix and finalise it.
2. **UI repetition.** Too much pixel art and too many dynamic numbers that all look the same.
   Keep the pixel identity (the owner likes it), stop overdoing it. Take inspiration widely.
3. **A new motion and design language for the whole app**, from the notch motion kit
   (`~/Downloads/notch-motion-kit`) and its source video (`~/Downloads/Video-48534.mp4`, studied
   frame by frame): one underdamped spring per morph, content lagging its container, stagger in
   and never out, idle loops that never sync. Fluid, alive. Not the Grok bot's gimmicks (no file
   upload bin on a phone).
4. **Dynamic Island, meaningfully.** Not data moved from elsewhere because it was asked for: what
   belongs in the island that cannot live anywhere else, or is more useful there. Research it,
   design it, implement it.
5. **Grok bot functionality** where it earns its place: the face with states, the status wheel,
   the agent rail, the aura around what an agent is driving.
6. **Demos, fleshed out.** Reference `latent-spaces/brag`: generate context for sharing what you
   built. Fix its flaws: a defined device size table (it produced an elongated iPhone), a button
   to start a demo AND proactive demos that start by themselves, one click share of the demo
   and/or chosen screenshots to any platform. Think about what else to generate proactively.
7. **Mac app, and Windows.** Cross platform, parity for every feature, the same design
   principles; structure may differ. The island idea on the Mac (the notch) and wherever makes
   sense elsewhere.
8. **Screenshots and screen recordings** as it goes, **commit incrementally and push**, and a
   report in an Artifact at the end.
9. **Performance boosts and fixes** anywhere.
10. When all of that is done: iterate on tests, make sure no UI reads as AI, then invent features.

## The verbatim ask (abridged only for length, spelling as written)

> the current reel sending system thing agenst sucks dick. awe need a new way to show this UI.
> also make it actually fit build ai feel is kisnra random in a way but also not. onie way its
> like build somethig off reels but that sonl y one way of using reels too bc u can cook and shit
> to rigt. maybe someway for us to use htme ans context but aybe thats just too narrow of a sue
> case idk. ... i feel like a lot o fht eUI is kind arepeptiv ewith th epixel sutf adn the numebrs
> ydamic iit loos cool but a lot of it loos hte exact same. ... this lfuid tpy ean yjiation here
> is ocol: /Users/vedantbhatt/Downloads/notch-motion-kit ... add ucntioanltiy for grok bot shit but
> also liek use this anioation systyle everyhwer.e ... integaret the iphone notch more in our app.
> by that i mean yanmic island ... what ameks s ense to put in dyunamic island hta tu cnat put
> elsehwere o rhat its more useufl for ... alos compeltle flesh out a demo feature! ...
> https://github.com/latent-spaces/brag.git ... iphone demo tool they have ha sincorrect isizgn
> for iphone someitmse ... have defiens iphone sizes ... one click share of demo and/or
> screenshots (user-seelction) of whatver to any paltform ... also start working ont he mac app
> too. and iwndow swhater. cross platform ... hav eparity for all feautes ... ydnamci island thing
> ... incldue it here maybe ... take screen shots, commit incrementally ... ui overhalf too, mac
> app, the rpeo clio.demo/screenshots oerview, fixign, perfomacne boosts ... DO NOT STOP.

## Working rules carried over

Commit incrementally and push each commit (`origin` redirects to `vedantlbhatt/builda`). Scan
for private identifiers before the first push of a new branch. Keep `MOTION-PROGRESS.md` current
so a cold resume works. The measurement rule in CLAUDE.md still holds. Do not stop.
