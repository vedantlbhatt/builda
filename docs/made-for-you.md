# Made for you: what Builda generates without being asked

The brief asked for demos that start by themselves and then: "think about what else to generate
proactively." Three things are made now without a tap. Each is offered once, on the island (the
app's one voice, `src/island/store.ts`), and each opens as a card you can post.

| what | when | where the number comes from | code |
|---|---|---|---|
| a demo of a project | a session ships in it (`capture/demo`, docs/demos.md) | the project, filmed on your Mac | `src/shipkit/`, `capture/demo/` |
| last week's card | Monday to Wednesday, the first time the app is in front, if last week had any finished session; and a notification at 09:00 on Monday for someone who does not open the app | the profile graph, never the list | `src/share/weekOffer.ts`, `src/push/weekly.ts` |
| an hours milestone | your total passes 10, 25, 50, 100, 250, 500 or 1000 hours | the profile's `totals.active_seconds` | `src/share/milestones.ts`, `src/share/milestoneOffer.ts` |

## The rules, and where each came from

- **Once.** Each has a kv row that makes it once: `week.offered` holds the Monday it was offered for,
  `milestone.hours` the highest milestone already said. The module also remembers the Monday it
  checked for the life of the app, so the minute poll asks the server nothing after the first pass.
- **Backfill is silent** (CLAUDE.md: first launch announced 71 historical sessions). The first time
  the milestone rule reads a total it only remembers what is already behind you: 300 hours on first
  launch is not "you passed 250 hours".
- **Never both** (the rule `server/builder/notify.py` states for banners and Live Activities). The
  island does not offer last week's card when Monday's notification is already in Notification
  Center, and opening the card from either marks the week offered. One card a pass: when last
  week's card and a milestone are both due, the week goes first and the milestone waits.
- **No number written ahead of time.** Monday's notification is scheduled days before the week ends,
  so it says no figure; the card reads the profile when it opens.
- **Never a sum that can overlap.** The week card's rows are one per title at the longest session's
  own time. A first version summed sessions with one title and printed 14h 37m under a week of 14
  hours, because sessions that run at once overlap (the same trap as the commits in CLAUDE.md).
- **Honest comparisons.** The Sessions band's "Same days last week: 13.7 hours" is last week up to
  today's weekday; against the whole of last week a Tuesday reads as a collapse.

## The cards

360 x 450 points, captured at 3x as 1080 x 1350 (4:5, the portrait post), through one preview
(`src/share/SharePreview.tsx`): the share sheet on a phone, Save image on a desktop (Downloads and the
clipboard, `desktop/src/image.js`). They are made of the app's own pixels: a band in your creature's
colour with its dithered dissolve, the figure, your creature, and under it the week's days as pixel
columns or the milestone ladder as pixel squares.
