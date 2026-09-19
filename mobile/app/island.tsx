/**
 * The desktop island: the pill the desktop shell (`desktop/`) shows at the top of the screen, on
 * its own transparent window, drawn from this same bundle. Web only (`app/_layout.tsx` guards it
 * with `Platform.OS === 'web'`); the phone's island is the system's and `src/island/`'s.
 *
 * `?sample=needsYou|crew|drop|shipped|idle` draws a fixed activity for the screenshot harness,
 * `?expand=1` holds it open, and `?nw=&nh=` is the notch the shell measured, when there is one.
 * The screen and its rules live in `src/desktop/island/`.
 */
import { IslandScreen } from '../src/desktop/island/IslandScreen';

export default IslandScreen;
