/**
 * The desktop layout, around the router's stack (web only; `DesktopFrame.tsx` is the phone's,
 * which returns its children untouched).
 *
 *   [ sidebar | the section's list, when it has one | the stack: the screen, or the detail ]
 *
 * From `DESKTOP_MIN_WIDTH` up. Every screen is the phone's own screen: this frame only decides
 * where each one sits and tells it how wide its pane is (`PaneSize`), so parity is structural,
 * not a second implementation. Under that width, and on the phone, nothing here renders.
 *
 * Also here, because a desktop needs them and a phone does not: the keyboard (Cmd/Ctrl+1..5,
 * Cmd/Ctrl+, Cmd/Ctrl+K, Cmd/Ctrl+\, Esc; `rules.commandFor`), the command palette, the hover
 * and focus stylesheet, `builder://` links arriving from the desktop shell, and its menu.
 */
import { DarkTheme, ThemeProvider, type Theme } from '@react-navigation/native';
import { usePathname, useRouter } from 'expo-router';
import React, { useCallback, useEffect, useMemo, useState, type ReactNode } from 'react';
import { StyleSheet, View } from 'react-native';

import { aliasPath, dropPath, recapPath } from '../../app/+native-intent';
import { handleIncomingUrl } from '../auth/googleFlow';
import { api } from '../data/client';
import { nav } from '../nav/Skeleton';
import { PaneSize, useWindowSize } from '../web/useWindowDimensions.web';
import { desktopBridge } from './bridge';
import { CommandPalette } from './CommandPalette';
import { injectDesktopCss, injectFontCss } from './css';
import { DesktopSignIn } from './DesktopSignIn';
import { EmptyDetail } from './EmptyDetail';
import { MasterColumn, type MasterName } from './Master';
import { publishFrame } from './morphTarget';
import {
  commandFor,
  DESKTOP_MIN_WIDTH,
  frameLayout,
  placeOf,
  sectionPath,
  SIDEBAR_FOLDED,
  SIDEBAR_WIDTH,
  type Command,
} from './rules';
import { Sidebar } from './Sidebar';
import { isIslandWindow } from './windowKind';

const FOLD_KEY = 'builda.sidebar.folded';
/** "Not now" on the sign in, for this launch (sessionStorage dies with the window). */
const SKIP_KEY = 'builda.signin.skipped';
/** Onboarding is a phone's flow; on a desktop it sits in a phone-wide column in the middle. */
const ONBOARDING_WIDTH = 440;

function readFolded(): boolean {
  try {
    return localStorage.getItem(FOLD_KEY) === '1';
  } catch {
    return false;
  }
}

/** A `builder://` link as the route it opens (the phone's own rewrites, `app/+native-intent.ts`). */
export function routeForLink(url: string): string {
  const known = dropPath(url) ?? recapPath(url) ?? aliasPath(url);
  if (known) return known;
  const m = /^[a-z][a-z0-9+.-]*:\/{2,3}(.*)$/i.exec(url.trim());
  const rest = m ? m[1]! : url.trim();
  return `/${rest.replace(/^\/+/, '')}`;
}

function isTyping(): boolean {
  if (typeof document === 'undefined') return false;
  const el = document.activeElement as HTMLElement | null;
  if (!el) return false;
  return el.tagName === 'INPUT' || el.tagName === 'TEXTAREA' || el.isContentEditable;
}

/**
 * The navigators' own theme on web. With none given React Navigation paints its light default
 * (`rgb(242, 242, 242)`) behind every screen, which showed as a grey sheet behind the island's
 * transparent window and as a light flash between screens. The warm ground, and nothing at all
 * behind the island.
 */
function navTheme(island: boolean): Theme {
  return {
    ...DarkTheme,
    colors: { ...DarkTheme.colors, background: island ? 'transparent' : nav.bg, card: nav.bg, text: nav.text, border: nav.border },
  };
}
const MAIN_THEME = navTheme(false);
const ISLAND_THEME = navTheme(true);

export function DesktopFrame({ children }: { children: ReactNode }) {
  return <DesktopFrameInner>{children}</DesktopFrameInner>;
}

function Themed({ island, children }: { island: boolean; children: ReactNode }) {
  return <ThemeProvider value={island ? ISLAND_THEME : MAIN_THEME}>{children}</ThemeProvider>;
}

function DesktopFrameInner({ children: stack }: { children: ReactNode }) {
  const island0 = isIslandWindow();
  const children = <Themed island={island0}>{stack}</Themed>;
  const island = isIslandWindow();
  const win = useWindowSize();
  const desktop = !island && win.width >= DESKTOP_MIN_WIDTH;
  const pathname = usePathname();
  const router = useRouter();
  const place = useMemo(() => placeOf(pathname), [pathname]);
  const [folded, setFolded] = useState(readFolded);
  const [palette, setPalette] = useState(false);
  const [visited, setVisited] = useState<ReadonlySet<MasterName>>(() => new Set());
  // Inside the shell a window with no tokens asks the phone first (`DesktopSignIn`); null while
  // the store is read, so a signed in launch never flashes the sign in screen.
  const [needsSignIn, setNeedsSignIn] = useState<boolean | null>(() => (desktopBridge() && !island ? null : false));

  useEffect(() => {
    if (needsSignIn !== null) return;
    let skipped = false;
    try {
      skipped = sessionStorage.getItem(SKIP_KEY) === '1';
    } catch {
      skipped = false;
    }
    void api.isSignedIn().then((yes) => setNeedsSignIn(!yes && !skipped));
  }, [needsSignIn]);

  useEffect(() => {
    injectFontCss();
    if (!island) injectDesktopCss();
  }, [island]);

  // Where the frame puts things, for a morph that grows into the pane a push will open
  // (`morphTarget.web.ts`): read at the moment of a tap, so a plain value is enough.
  const framedNow = !island && desktop && !place.bare;
  useEffect(() => {
    publishFrame({ desktop: framedNow, sidebar: framedNow ? (folded ? SIDEBAR_FOLDED : SIDEBAR_WIDTH) : 0, path: pathname });
  }, [framedNow, folded, pathname]);

  // The site root has no route (the phone's first tab is `/now`, and `+native-intent` only runs
  // on a phone). A browser or the shell opening `/` lands on the first tab.
  useEffect(() => {
    if (!island && (pathname === '/' || pathname === '')) router.replace('/now');
  }, [island, pathname, router]);

  useEffect(() => {
    if (place.master && !visited.has(place.master)) setVisited(new Set([...visited, place.master]));
  }, [place.master, visited]);

  const toggleFold = useCallback(() => {
    setFolded((f) => {
      try {
        localStorage.setItem(FOLD_KEY, f ? '0' : '1');
      } catch {
        // The fold is a preference; losing it costs one click.
      }
      return !f;
    });
  }, []);

  const run = useCallback(
    (c: Command) => {
      switch (c.kind) {
        case 'section':
          router.navigate(sectionPath(c.section));
          return;
        case 'settings':
          router.push('/settings');
          return;
        case 'search':
          setPalette(true);
          return;
        case 'sidebar':
          toggleFold();
          return;
        case 'back':
          if (palette) setPalette(false);
          else if (router.canGoBack()) router.back();
          return;
        case 'refresh':
          if (typeof window !== 'undefined') window.location.reload();
          return;
      }
    },
    [router, toggleFold, palette],
  );

  // The keyboard. Web only, and only in the app's own window (the island takes no keys).
  useEffect(() => {
    if (island || typeof window === 'undefined') return;
    const mac = /Mac|iPhone|iPad/.test(navigator.platform ?? '');
    const onKey = (e: KeyboardEvent) => {
      const c = commandFor({
        key: e.key,
        mod: mac ? e.metaKey && !e.ctrlKey : e.ctrlKey && !e.metaKey,
        shift: e.shiftKey,
        alt: e.altKey,
        typing: isTyping(),
      });
      if (!c) return;
      // In the shell, Cmd+R belongs to the menu's own reload.
      if (c.kind === 'refresh' && desktopBridge()) return;
      e.preventDefault();
      run(c);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [island, run]);

  // The shell's menu and its `builder://` links (a click in another app, a second launch, a
  // notification's click).
  useEffect(() => {
    const bridge = desktopBridge();
    if (!bridge || island) return;
    const offCommand = bridge.onCommand((command) => {
      const [kind, arg] = command.split(':');
      if (kind === 'tab' && arg) run({ kind: 'section', section: arg as never });
      else if (kind === 'settings') run({ kind: 'settings' });
      else if (kind === 'search') run({ kind: 'search' });
      else if (kind === 'sidebar') run({ kind: 'sidebar' });
      else if (kind === 'back') run({ kind: 'back' });
      else if (kind === 'go' && arg) router.push(command.slice('go:'.length) as never);
    });
    const offLink = bridge.onDeepLink((url) => {
      // Google's redirect comes back through the scheme, as on the phone, and is a sign in, not
      // a route (`app/_layout.tsx` does the same with Linking, which a web page never hears).
      void handleIncomingUrl(url, api).then((signedIn) => {
        if (signedIn) router.push('/settings');
        else router.push(routeForLink(url) as never);
      });
    });
    return () => {
      offCommand();
      offLink();
    };
  }, [island, run, router]);

  if (island) return <>{children}</>;
  if (needsSignIn === null) return <View style={styles.row} />;
  if (needsSignIn) {
    return (
      <DesktopSignIn
        onSkip={() => {
          try {
            sessionStorage.setItem(SKIP_KEY, '1');
          } catch {
            // Skipping is for this launch only; losing it asks again, which is fine.
          }
          setNeedsSignIn(false);
        }}
      />
    );
  }

  // ONE tree in every mode, the stack always the keyed child of the same pane: a window resized
  // across 900, or onboarding finishing, re-lays the frame around the stack instead of
  // remounting the stack (which would drop its history).
  const onboarding = desktop && place.bare;
  const framed = desktop && !place.bare;
  const side = framed ? (folded ? SIDEBAR_FOLDED : SIDEBAR_WIDTH) : 0;
  // A page with no list beside it stops at a readable width and sits in the middle (the rule is
  // `rules.frameLayout`, which a morph reads too); onboarding, a phone's flow, sits in a
  // phone-wide column.
  const frame = frameLayout(framed ? place : { ...place, master: null }, win.width, win.height, side);
  const masterWidth = framed ? frame.master : 0;
  const paneWidth = frame.room;
  const contentWidth = onboarding ? ONBOARDING_WIDTH : framed ? frame.content.w : paneWidth;
  const hideStack = framed && place.masterRoot;

  return (
    <View style={styles.row}>
      {framed ? (
        <View key="sidebar" style={styles.side} {...({ dataSet: { buildaNowash: 'true' } } as object)}>
          <Sidebar
            place={place}
            width={side}
            folded={folded}
            onSection={(s) => run({ kind: 'section', section: s })}
            onSettings={() => run({ kind: 'settings' })}
            onToggle={toggleFold}
          />
        </View>
      ) : null}
      {framed
        ? (['sessions', 'drops', 'projects'] as const).map((m) =>
            visited.has(m) || place.master === m ? (
              <MasterColumn key={m} which={m} visible={place.master === m} width={place.master === m ? masterWidth : 0} height={win.height} x={side} />
            ) : null,
          )
        : null}
      <View key="pane" style={styles.pane}>
        <View style={[styles.content, desktop ? { width: contentWidth } : styles.phone, onboarding ? styles.onboardingColumn : null]}>
          <PaneSize size={desktop ? { width: contentWidth, height: win.height, x: side + masterWidth + Math.max(0, (paneWidth - contentWidth) / 2) } : null}>
            {children}
          </PaneSize>
        </View>
        {/* At a list's own tab (`/sessions`) the list is the master and nothing is open yet. The
            stack stays mounted AND laid out underneath: a screen that first mounts under
            display:none measures 0 by 0 and never plays its reveal (MEASURED: You and Settings came
            up blank after the stack had been hidden for a list), so it is covered, not hidden. */}
        {hideStack && place.master ? (
          <View style={styles.cover}>
            <EmptyDetail master={place.master} />
          </View>
        ) : null}
      </View>
      {framed ? <CommandPalette open={palette} onClose={() => setPalette(false)} /> : null}
    </View>
  );
}

const styles = StyleSheet.create({
  row: { flex: 1, flexDirection: 'row', backgroundColor: nav.bg },
  side: { alignSelf: 'stretch' },
  pane: { flex: 1, alignItems: 'center', backgroundColor: nav.bg, overflow: 'hidden' },
  content: { flex: 1 },
  phone: { alignSelf: 'stretch' },
  cover: { ...StyleSheet.absoluteFillObject, zIndex: 1 },
  onboardingColumn: { borderLeftWidth: StyleSheet.hairlineWidth, borderRightWidth: StyleSheet.hairlineWidth, borderColor: nav.border },
});
