/**
 * The few things a desktop page needs that React Native styles cannot say, as one stylesheet
 * injected once on web: a pointer and a hover wash on anything pressable, a focus ring for the
 * keyboard, quiet scrollbars, and the drag region the desktop shell's hidden title bar needs.
 *
 * HOVER IS A WASH, NOT A COLOUR. Rows, doors and bands each own their fill; a hover that swapped
 * it would need every component to know about hover. An inset shadow as wide as the element
 * lays 5% of the warm white over whatever is there (the ground, a band's hue, a tile), follows
 * its corners, and leaves layout alone.
 */
import { nav } from '../nav/Skeleton';

const ID = 'builda-desktop-css';

/** A token's hex with an alpha, for the few washes CSS and a scrim need. */
export function rgba(hex: string, alpha: number): string {
  const n = parseInt(hex.slice(1), 16);
  return `rgba(${(n >> 16) & 255}, ${(n >> 8) & 255}, ${n & 255}, ${alpha})`;
}

export function desktopCss(): string {
  const wash = rgba(nav.text, 0.05);
  const washDown = rgba(nav.text, 0.09);
  return `
html, body { background: ${nav.bg}; overscroll-behavior: none; }
body { -webkit-font-smoothing: antialiased; }
[tabindex="0"]:not(input):not(textarea) { cursor: pointer; transition: box-shadow 120ms ease-out; }
[tabindex="0"]:not(input):not(textarea):hover { box-shadow: inset 0 0 0 100vmax ${wash}; }
[tabindex="0"]:not(input):not(textarea):active { box-shadow: inset 0 0 0 100vmax ${washDown}; }
[data-builda-nowash] [tabindex="0"]:hover, [data-builda-nowash][tabindex="0"]:hover { box-shadow: none; }
:focus { outline: none; }
:focus-visible { outline: 2px solid ${rgba(nav.text, 0.6)}; outline-offset: 2px; }
input:focus-visible, textarea:focus-visible { outline: none; }
::selection { background: ${rgba(nav.text, 0.25)}; }
* { scrollbar-width: thin; scrollbar-color: ${rgba(nav.text, 0.16)} transparent; }
::-webkit-scrollbar { width: 10px; height: 10px; }
::-webkit-scrollbar-track { background: transparent; }
::-webkit-scrollbar-thumb { background: ${rgba(nav.text, 0.16)}; border-radius: 10px; border: 3px solid transparent; background-clip: content-box; }
::-webkit-scrollbar-thumb:hover { background: ${rgba(nav.text, 0.3)}; border: 3px solid transparent; background-clip: content-box; }
[data-builda-drag="true"] { -webkit-app-region: drag; app-region: drag; }
[data-builda-drag="true"] [tabindex], [data-builda-drag="true"] input, [data-builda-drag="true"] a { -webkit-app-region: no-drag; app-region: no-drag; }
`;
}

/**
 * The mono role on web. The app names SF Mono by its CSS keyword, `ui-monospace` (`theme.MONO_FAMILY`),
 * which only Safari knows: Chromium, and so the desktop shell, read it as a family nobody has and
 * fell back to Times, so every repo name, clock and path on web was set in a serif. MEASURED on
 * the first desktop screenshots, 2026-09-19. A face DECLARED under that name, from the fonts each
 * system actually has (SF Mono or Menlo on a Mac, Cascadia Mono or Consolas on Windows, DejaVu on
 * Linux), fixes every use without touching one.
 */
export function fontCss(): string {
  const regular = ['SFMono-Regular', 'SF Mono', 'Menlo-Regular', 'Menlo', 'CascadiaMono-Regular', 'Cascadia Mono', 'Consolas', 'DejaVu Sans Mono'];
  const bold = ['SFMono-Semibold', 'SF Mono Semibold', 'Menlo-Bold', 'CascadiaMono-SemiBold', 'Cascadia Mono SemiBold', 'Consolas Bold', 'DejaVu Sans Mono Bold'];
  const src = (names: string[]) => names.map((n) => `local('${n}')`).join(', ');
  return `
@font-face { font-family: 'ui-monospace'; src: ${src(regular)}; font-weight: 100 549; }
@font-face { font-family: 'ui-monospace'; src: ${src(bold)}; font-weight: 550 900; }
`;
}

function inject(id: string, css: string): void {
  if (typeof document === 'undefined' || document.getElementById(id)) return;
  const el = document.createElement('style');
  el.id = id;
  el.textContent = css;
  document.head.appendChild(el);
}

/** The desktop stylesheet, once; a second call is a no-op. */
export function injectDesktopCss(): void {
  inject(ID, desktopCss());
}

/** The fonts, once, on every web page (the island and the phone layout too). */
export function injectFontCss(): void {
  inject(`${ID}-fonts`, fontCss());
}
