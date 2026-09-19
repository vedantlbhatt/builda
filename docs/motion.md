# Motion: one object that grows to say more

The design direction for the overnight overhaul of 2026-09-19 (`brief-motion.md`). Read this
before touching anything under `mobile/src/motion/`, `mobile/src/island/`, the drops wall, the
demo kit, or the Mac notch.

## Why the app looked the same everywhere

Measured, not felt (`MOTION-PROGRESS.md` has the audit): the same hero sits on nine screens. A
hue `Band` prints in over 560 ms, a `CreaturePrint` draws itself in, the words rise, a big number
counts up from zero. `Band` is on 30 files (52 instances), `Num` and `BandFigure` count up on 50,
and every band carries the same 36 pt Bayer dither fringe. Eleven different spring configs and a
hand written one disagree about how anything moves. Each part is good. Nine copies of the same
entrance is a template, and a template is what reads as generated.

## The source

`~/Downloads/notch-motion-kit` and the 53 s clip it was measured from, read frame by frame at
30 fps (every second as a contact sheet; the morphs at full resolution). What the clip does that
Builda did not:

1. **One object changes size to change what it says.** A 210 x 34 pill becomes a 420 x 116 task
   panel becomes a 500 x 96 summary becomes the pill again. Nothing is pushed, nothing slides in.
2. **One spring per morph, underdamped.** `damping 17, stiffness 210, mass 1`: first peak at
   ~300 ms, ~10% past target, settled at ~450 ms. Width, height and radius all interpolate off
   ONE `progress` value, so the corners never wobble under interruption. Radius clamps; size
   extends past its target and comes back.
3. **Content lags its container.** The outgoing layer is gone by `progress 0.28` and scales UP
   (to 1.22) as it leaves; the incoming one starts at 0.34 on a stiffer spring
   (`damping 22, stiffness 320, mass 0.9`) so it settles before the box does.
4. **Stagger in, never out.** Chips 45 ms apart, rail faces 60 ms, words 55 ms. Everything
   leaves together in 120 ms.
5. **State is colour on the character, not a label.** Blue glow working, violet thinking, amber
   waiting, red error (eyes flatten to lines), green done (eyes become arcs). Tint and glow
   spring between states, so a status change is itself an animation.
6. **Idle loops never sync.** Breathe 1500/1700 ms, jelly 900/1100 ms, blink on a random
   1.8 to 5 s timer with a 25% double. Mismatched on purpose.
7. **The active line shimmers.** The current step in the wheel has a light sweep across its
   letters; the steps above and below are dimmer and smaller.
8. **Washes, not fills.** A state paints a gradient INTO the black (warm from the top, red from
   the bottom, green across), never a tinted rectangle.

What it does that Builda must NOT copy: the file upload bin (a phone has no desktop to drag
from), the particle greeting, the prompt composer inside the island (Builda never takes typing
there), and the Grok bot's face itself. Builda already has a character: the builder's own pixel
creature. It gets the face's STATE MACHINE (glow, eye shapes, breathing, blinking), not its
3D sphere.

## The constants

`mobile/src/motion/spec.ts` is the only place they live (plain numbers, so tests read them), and
the Swift side (`Packages/BuilderKit/Sources/BuilderUI/IslandMotion.swift` and the widget) copies
them with a test holding the two equal. The old `motionSpec.ts` values that survive are
re-expressed there; the eleven ad hoc springs are gone.

| name | config | for |
|---|---|---|
| `ISLAND` | damping 17, stiffness 210, mass 1 | every container morph: island, card to page, sheet |
| `CONTENT` | damping 22, stiffness 320, mass 0.9 | what rides inside a container |
| `POP` | damping 14, stiffness 260, mass 0.7 | small things arriving: chips, faces, badges |
| `WHEEL` | damping 20, stiffness 190, mass 1 | the status wheel and anything list-like that moves as one |
| `SNAP` | damping 33, stiffness 300, mass 1 | a finger let go: settle with no bounce (ζ 0.95; 0.75 still wobbles under a thumb) |

## The island is one object, everywhere

The Dynamic Island is where the app lives when you are not looking at it. So the question for
every piece of content is the one the owner asked: **what belongs there that cannot live
anywhere else, or is more useful there?** The answer is anything that is HAPPENING SOMEWHERE
ELSE, ON YOUR BEHALF, that you might need to act on before you would otherwise open the app.
Builda's work happens on the Mac. You are on the phone. That gap is the island's whole job.

In the island (and on the Mac notch, and on the Windows pill):

| what | why it belongs there | compact | expanded |
|---|---|---|---|
| **needs you** | a Claude Code run on your Mac is blocked on you. Every second it waits is lost work, and you are in another app | creature with flat eyes on amber, "waiting 2m" | the project, what it is waiting on, how long |
| **the crew** | several agents at once is the thing you cannot see from the sofa | creature left, 2x2 agent dots right (the clip's right ear) | the wheel: each agent's current step, the active one shimmering |
| **a reel being read** | you shared from Instagram and are still in Instagram. A banner would pull you out; the island lets you keep scrolling and see the answer land | a wheel of `reading → planning → checking` | the moves it found, the first one with a Start button |
| **a demo being cut** | the Mac records your app after a session ships; you want to post it the moment it is ready | a thin progress thumb | the poster frame and Share |
| **shipped** | the one moment worth a beat | green arc eyes | the summary, a word at a time |

NOT in the island: streaks, totals, weekly hours, anything that is true all day. Those are the
widget's and the app's. An island that shows a number that has not changed since breakfast is
an island you learn to ignore, and then the one that needs you is ignored too.

**One object in three places.** iOS never shows your own app's Live Activity while your app is
in front. So inside the app Builda draws the island itself, fused to the hardware island at the
hardware island's own frame (`mobile/src/island/`), with the same content; leave the app and
the system island carries on with it. The in-app one can do what ActivityKit cannot (springs,
the wheel, the wash), and it also carries app-local news: a drop landed, a move started, a
share finished. It never shows a toast in any other place: the island is the app's one voice.

## The pixels stay; each item arrives its own way

**Corrected 2026-09-19, 05:45, by the owner.** The first answer to "the UI is repetitive with the
pixel stuff" was a "pixel diet": the dither fringe removed, bands turned into cards that grow, tiles
turned into dark cards with a wash of hue. That was the wrong reading and it is undone: "do not
change the pixel stuff to gradients ... just itemize motion in some new novel way." The pixels are
the identity. What repeated was that every one of them arrived THE SAME WAY.

So the rule is:

- **Every pixel surface keeps its pixels**: full bleed bands in the 1-bit Bayer dither with the
  36 pt dissolve (`insights/Band.tsx`), tiles printed in their run's hue (`live/MissionTile.tsx`),
  the live strip on a session page, the creature printed cell by cell (`insights/Creature.tsx`),
  dither fields, the ship kit's dithered band. No gradient stands in for any of them.
- **Each item arrives its own way.** `motion/pixelMotion.ts` holds eight arrival orders, each a
  different physical thing: `rain` (random, biased down: the original), `scan` (a CRT drawing its
  frame), `ripple` (rings from a point, a tap or the Continue button), `rise` (columns filling like
  a level meter), `interlace` (two fields), `blocks` (a progressive image), `spiral` (a lens
  opening), `wipe` (a page turned). An item takes its order from its own name, so it always
  arrives the same way; a page hands out the next free order when two of its bands would share
  one (`takeOrder` through `RevealPage`). Onboarding's eight steps take one each (`STEP_MOTION`).
  The orders exist once, as `cellOrderWith` in JS and `orderSksl` in SkSL over each shader's own
  hash, and a CanvasKit test holds every cell of all eight to the twin.
- **The one number a screen moves arrives one of four ways**: counting up, a split flap scramble
  settling left to right, typed in, or ticking over in tenths (`NUM_MOTIONS`). Every other figure
  on the screen is set still.
- **The island is the notch kit's**, black, with its washes: that is a different object with its
  own language, and it is the only place a wash is the right tool.

## Navigation grows out of what you touched

`mobile/src/motion/MorphNav.tsx`. A mission tile, a session row, a project door or a door on You
does not slide a page in beside it: a window the size and colour of the thing you touched grows
to the whole phone on the island spring, turning into the page's ground as it grows, and the page
is pushed underneath with no slide of its own (`?morph=1`; the root stack's `screenOptions` turn
the animation off for any push that carries it). Back stays the platform's swipe and slide: a page
you are leaving has no rectangle still on screen to shrink into once you have scrolled. A drop
opening out of its poster is the same idea with the page laid out at full size behind a growing
window (`drops/wall/Opening.tsx`), because the page IS the poster.

## Drops: seen, built, shown

The owner's point, taken whole: "build something off a reel" is one way to use reels, and "do
anything with a reel" is out of scope and already exists. What fits a Strava for builders is
that **reels are how builders learn AND how they show what they made.** So a drop is not a
card on a board. It is the first frame of a story whose last frame is a reel you post:

1. **Seen.** You share a reel. It lands on the wall as its own poster, 9:16, the way it looked
   where you found it; with no poster (Instagram serves none) it is a typographic poster of its
   own first line. Nothing generated, no glyph.
2. **Picked.** The moves are ON the poster. One tap starts one; the wall does not make you open
   anything to act.
3. **Built.** A started move is a Claude Code run, so it is a session: the poster gets the aura
   while an agent is driving it, and the island carries it.
4. **Shown.** When that session ships, the demo kit cuts a vertical reel of what you built, and
   the drop becomes a pair: the reel that started it beside the reel you made. That pair is the
   share card no other product can make, because no other product saw both ends.

Reels that are not about building (a recipe, a place) still get the structured card, filed as
kept. They are allowed; they are not the story. Techniques you keep become a playbook the
session analysis can point back to ("you saved a reel about this prompt; it would have saved
the retry here"), which is the "reels as context" idea in the one place it is not niche: when
it explains your own session.

## Demos: the ship kit

`docs/demos.md` has the capture pipeline. What changes (`docs/ship-kit.md` once written): a
device table that is the only place a frame size lives (every current iPhone, iPad and a Mac
window, in points and pixels, from Apple's own numbers), a kit that starts BY ITSELF when a
session ships something runnable (and a button for when it did not), and one screen where you
pick the video and any screenshots and send them anywhere in one tap. The kit also writes what
a builder posts next to a demo: the post itself per platform, the changelog, a before and after.

## Mac and Windows

The Mac already has the capture daemon, so it knows what is running without a network. The notch
is the island's Mac body: an `NSPanel` fused to the notch (a pill under the menu bar where there
is no notch), the same states, the same springs in SwiftUI, and the one input the clip earned:
drag a link onto the notch and it is a drop. Windows gets the same pill at the top of the
screen from the desktop shell (`desktop/`), which runs the phone's own screens through
react-native-web so every feature is the same code.
