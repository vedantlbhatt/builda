import * as AppleAuthentication from 'expo-apple-authentication';
import Constants from 'expo-constants';
import { Stack, useRouter } from 'expo-router';
import React, { useCallback, useEffect, useState, type ReactNode } from 'react';
import * as ReactNative from 'react-native';
import { Alert, Pressable, ScrollView, StyleSheet, Switch, useWindowDimensions, View } from 'react-native';
import Animated from 'react-native-reanimated';

import { isGoogleConfigured, onGoogleSignIn, startGoogleSignIn } from '../src/auth/googleFlow';
import { ApiError, type CaptureKey, type CaptureKeyCreated, type Me, type PrivacyPrefs } from '../src/data/api';
import { forgetCachedQuotes } from '../src/data/builderCache';
import * as cache from '../src/data/cache';
import {
  FILE_NAMES_DETAIL,
  FILE_NAMES_TITLE,
  loadPrivacyPrefs,
  LOCK_SCREEN_TITLE,
  lockScreenDetail,
  type PrivacySwitch,
  QUOTES_DETAIL,
  QUOTES_MACHINE_COMMAND,
  QUOTES_MACHINE_HINT,
  QUOTES_TITLE,
  setPrivacySwitch,
} from '../src/data/privacy';
import {
  appendKey,
  atKeyCap,
  CAPTURE_KEY_DEFAULT_NAME,
  CAPTURE_KEY_MAX_LIVE,
  CAPTURE_KEY_NAME_MAX,
  CAPTURE_KEY_PASTE_HINT,
  captureKeyNameProblem,
  keyLabel,
  lastUsedLabel,
  withoutKey,
  hookInstallSnippet,
} from '../src/data/captureKeys';
import { api, API_BASE_URL } from '../src/data/client';
import { getMachineId } from '../src/data/machine';
import { Band, BandWords } from '../src/insights/Band';
import { CreaturePrint } from '../src/insights/Creature';
import { fitSize, numSpec } from '../src/insights/format';
import { figure, GUTTER } from '../src/insights/kit';
import { Num } from '../src/insights/Num';
import { GROUND, ON_HUE } from '../src/insights/palette';
import { Block, RevealPage, Section, usePageReveal } from '../src/insights/reveal';
import { useRevealScroll } from '../src/insights/RevealScroll';
import { AccentButton, WordLink } from '../src/nav/chrome';
import { getLocalName } from '../src/nav/name';
import { sendPendingName } from '../src/nav/onboarding';
import { colourLine, creatureLabel, identityLines, keysCaption } from '../src/nav/settingsCopy';
import { registerForPush } from '../src/push/push';
import {
  describeHandleConflict,
  displayNameProblem,
  handleProblem,
  HANDLE_MAX,
  HANDLE_MIN,
  isValidHandle,
  MAX_DISPLAY_NAME,
  normalizeHandle,
} from '../src/social/account';
import { colors, space, TAP_TARGET } from '../src/theme';
import { refreshAccent, useAccent, type AccentState } from '../src/theme/accent';
import { Button, Hairline, SHAPE, T, TextField, useReduceMotion } from '../src/ui';

/**
 * Settings, on the chapter grammar (design-refs/HOUSE-STYLE.md): not a stack of boxed rows but a
 * column of chapters on the warm dark ground, opened by one band.
 *
 * The band is the builder, in the builder's hue: it prints itself in pixels when the page lands,
 * their creature printed on it, their name set large in dark ink, their handle under it, and the
 * one sentence that says what this app's colour is and how to change it (the owner, 2026-09-13:
 * "what even is the theme of this app?"). Tapping the creature opens the picker, and coming back
 * repaints the band, the bar and every button in the new hue (`src/theme/accent.tsx`).
 *
 * Under it, each chapter is a hairline, a heading and one plain sentence, then its content open
 * on the ground: the privacy switches each with their sentence, fields as lines, keys as lines,
 * actions as words. The one primary action per chapter is the accent capsule (`AccentButton`);
 * the kit's amber button is not used here. Sections play as they arrive, once (`RevealPage`).
 *
 * Borrowed, by name: the band and its reveal are the analysis page's (`src/insights/`); the
 * profile at the top of settings, Revolut's (design-md/finance/revolut: avatar, name and plan
 * first, then the account); a number set large where there is one to count, Duolingo's ("numbers
 * are stars", design-md/misc/duolingo), for the live capture keys.
 */

/** The sign-in buttons: the same 52pt capsule as every primary action. */
const SIGN_IN_HEIGHT = 52;

/** Google's sign-in button is white by their guideline (`colors().googleButton`). */
const GOOGLE_WHITE = colors('dark').googleButton;

/** "Builda · v0.1.0": the version is read from the config, never typed here twice. */
function appLine(): string {
  const v = Constants.expoConfig?.version;
  return v ? `Builda · v${v}` : 'Builda';
}

/** Settings stages no chapters (they are few and light), so a first scroll has nothing to hurry. */
const NOTHING = () => {};

export default function SettingsScreen() {
  const router = useRouter();
  const { width } = useWindowDimensions();
  const accent = useAccent();
  const reduced = useReduceMotion();
  const page = usePageReveal(reduced);
  const { scrollRef, onScroll, onLayout } = useRevealScroll(page, NOTHING);

  // null until the keychain has answered: the band says "Signed in" or "Not signed in", and it
  // must not say the wrong one for a frame.
  const [signedIn, setSignedIn] = useState<boolean | null>(null);
  const [localName, setLocalName] = useState<string | null>(null);
  const [pairCode, setPairCode] = useState('');
  const [me, setMe] = useState<Me | null>(null);
  const [meError, setMeError] = useState<string | null>(null);
  // The outcome of the last thing done, said where the eye is after the tap: under the band
  // for what changes the whole page (signed in, signed out), in its chapter for the rest.
  const [topLine, setTopLine] = useState<string | null>(null);
  const [signInLine, setSignInLine] = useState<string | null>(null);
  const [macLine, setMacLine] = useState<string | null>(null);
  const [accountLine, setAccountLine] = useState<string | null>(null);
  const googleReady = isGoogleConfigured();

  const readLocalName = useCallback(() => {
    getLocalName(cache)
      .then(setLocalName)
      .catch(() => setLocalName(null));
  }, []);

  useEffect(() => {
    readLocalName();
    void api.isSignedIn().then(setSignedIn);
    // The Google redirect is finished by the root layout; this screen only learns the
    // outcome, so it updates in place when the browser hands control back.
    return onGoogleSignIn((r) => {
      if (r.ok) {
        setSignedIn(true);
        setSignInLine(null);
        setTopLine('Signed in with Google. Pull to refresh on Sessions.');
      } else {
        setSignInLine(r.message);
      }
    });
  }, [readLocalName]);

  // The viewer's own row, once there is a viewer. Re-read whenever sign-in flips on, so a
  // fresh sign-in shows the handle it already has rather than "No handle yet".
  useEffect(() => {
    if (!signedIn) {
      setMe(null);
      setMeError(null);
      return;
    }
    let cancelled = false;
    api
      .getMe()
      .then((m) => {
        if (!cancelled) setMe(m);
      })
      .catch((e: unknown) => {
        if (!cancelled) setMeError(e instanceof Error ? e.message : 'could not load your profile');
      });
    return () => {
      cancelled = true;
    };
  }, [signedIn]);

  const signIn = useCallback(async () => {
    try {
      const credential = await AppleAuthentication.signInAsync({
        requestedScopes: [AppleAuthentication.AppleAuthenticationScope.EMAIL],
      });
      if (!credential.identityToken) throw new Error('no identity token');

      const machineId = await getMachineId();
      const tokens = await api.signInWithApple(credential.identityToken, machineId);
      await api.setTokens(tokens.access_token, tokens.refresh_token);
      setSignedIn(true);
      setSignInLine(null);
      setTopLine('Signed in. Pull to refresh on Sessions.');
      void registerForPush(api);
      // The name picked in onboarding while signed out, if it has not reached the account yet.
      void sendPendingName();
    } catch (e) {
      if ((e as { code?: string }).code === 'ERR_REQUEST_CANCELED') return;
      setSignInLine(e instanceof Error ? e.message : 'sign in failed');
    }
  }, []);

  const signInGoogle = useCallback(async () => {
    try {
      setSignInLine('Continue in the browser…');
      await startGoogleSignIn();
    } catch (e) {
      setSignInLine(e instanceof Error ? e.message : 'could not open Google sign-in');
    }
  }, []);

  const pair = useCallback(async () => {
    try {
      const result = await api.approvePairing(pairCode.trim().toUpperCase());
      setMacLine(`Paired with ${result.label}.`);
      setPairCode('');
    } catch {
      setMacLine('That code was not recognised, or it expired.');
    }
  }, [pairCode]);

  // Signing out clears everything this phone saved but its device keys, the chosen creature and
  // the onboarding name with it (`cache.clear`), so the band and the app's colour are read again.
  const afterLeaving = useCallback(() => {
    readLocalName();
    void refreshAccent();
  }, [readLocalName]);

  const signOut = useCallback(async () => {
    await api.clearTokens();
    // Cached sessions are the user's data, not ours to keep once they leave.
    await cache.clear();
    setSignedIn(false);
    setMacLine(null);
    setAccountLine(null);
    setTopLine('Signed out. Local copies deleted.');
    afterLeaving();
  }, [afterLeaving]);

  const deleteAccount = useCallback(() => {
    // In-app account deletion, not an email link. App Review guideline 5.1.1(x) treats a
    // "contact us to delete" link as an automatic rejection.
    Alert.alert(
      'Delete your account?',
      'Every session, device and token on the server is deleted immediately. This cannot be undone.',
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Delete everything',
          style: 'destructive',
          onPress: async () => {
            try {
              const result = await api.deleteAccount();
              await api.clearTokens();
              await cache.clear();
              setSignedIn(false);
              setAccountLine(null);
              setTopLine(`Deleted. Receipt ${result.receipt.slice(0, 12)}…`);
              afterLeaving();
            } catch {
              setAccountLine('Could not reach the server. Nothing was deleted.');
            }
          },
        },
      ]
    );
  }, [afterLeaving]);

  const known = signedIn !== null;

  return (
    <>
      {/* The chapter pages' bar (the analysis page and the You pages): the large title on the
          ground, no rule under it, the band right below. */}
      <Stack.Screen
        options={{
          title: 'Settings',
          headerLargeTitle: true,
          headerLargeTitleShadowVisible: false,
          headerShadowVisible: false,
          headerTransparent: false,
          headerBackground: undefined,
          headerStyle: { backgroundColor: GROUND.bg },
          headerLargeStyle: { backgroundColor: GROUND.bg },
          headerTintColor: GROUND.text,
          headerTitleStyle: { color: GROUND.text },
          headerLargeTitleStyle: { color: GROUND.text },
        }}
      />
      <Animated.ScrollView
        ref={scrollRef}
        style={styles.scroll}
        contentInsetAdjustmentBehavior="automatic"
        contentContainerStyle={styles.content}
        onScroll={onScroll}
        scrollEventThrottle={16}
        onLayout={onLayout}
        keyboardShouldPersistTaps="handled"
        automaticallyAdjustKeyboardInsets
      >
        <RevealPage page={page}>
          {known ? (
            <IdentityBand
              key={accent.animal}
              accent={accent}
              signedIn={signedIn}
              me={me}
              localName={localName}
              width={width}
              topLine={topLine}
              onCreature={() => router.push('/icon')}
            />
          ) : (
            <View style={styles.bandSkeleton} />
          )}

          {known && !signedIn ? (
            <Chapter
              title="Sign in"
              line="Builda works without an account. You are seeing a sample session. Sign in to sync your own from the Mac agent."
            >
              <View style={styles.stack}>
                <AppleAuthentication.AppleAuthenticationButton
                  buttonType={AppleAuthentication.AppleAuthenticationButtonType.SIGN_IN}
                  buttonStyle={AppleAuthentication.AppleAuthenticationButtonStyle.WHITE}
                  cornerRadius={SIGN_IN_HEIGHT / 2}
                  style={{ height: SIGN_IN_HEIGHT }}
                  onPress={signIn}
                />
                {/* White by Google's guideline, in either scheme; shaped like Apple's beside it.
                    A build without a Google client id has no button at all: a white capsule at
                    40% was a grey slab that looked broken and could not be pressed. */}
                {googleReady ? (
                  <Pressable
                    onPress={() => void signInGoogle()}
                    accessibilityRole="button"
                    style={({ pressed }) => [styles.google, { opacity: pressed ? 0.7 : 1 }]}
                  >
                    <T role="headline" tone="onAccent">
                      Continue with Google
                    </T>
                  </Pressable>
                ) : __DEV__ ? (
                  <T role="meta" tone="faint">
                    Google sign in is off in this build: no client id.
                  </T>
                ) : null}
                <Outcome line={signInLine} />
              </View>
            </Chapter>
          ) : null}

          {known && signedIn ? (
            <Chapter title="Profile" line="The name and handle on your account.">
              {me ? (
                <ProfileFields me={me} onChange={setMe} accent={accent} />
              ) : (
                <T role="row" weight={400} tone="dim">
                  {meError ?? 'Loading your profile…'}
                </T>
              )}
            </Chapter>
          ) : null}

          {known ? (
            <Chapter title="Privacy" line="What leaves your Mac, and what this phone shows.">
              <PrivacySwitches signedIn={signedIn} accent={accent} />
              <View style={styles.promise}>
                <T role="body">Your prompts, your code, your diffs and your file names stay on your machine.</T>
                <T role="row" weight={400} tone="dim">
                  What syncs is timings, counts, the shape of the session, and, only for repositories you mark public,
                  the repository name and the title your editor already wrote to your own disk.
                  {signedIn ? ' Quotes and file names are the only exceptions, and only while their switches above are on.' : ''}
                </T>
                {/* The command on a line of its own: run inline, the line breaker split it after
                    "--" and set "dry-run" on the next line, which no one can paste. */}
                <T role="row" weight={400} tone="dim">
                  The Mac agent is open source. This prints every byte it would send, without sending it:
                </T>
                <View style={styles.code}>
                  <T role="mono" selectable>
                    builder sync --dry-run --print-payload
                  </T>
                </View>
              </View>
            </Chapter>
          ) : null}

          {known && signedIn ? (
            <>
              <Chapter title="Your Mac">
                <T role="row" weight={400} tone="dim">
                  Run{' '}
                  <T role="mono" tone="text">
                    builder pair
                  </T>{' '}
                  on your Mac, then type the code it shows.
                </T>
                <View style={styles.inputRow}>
                  <TextField
                    value={pairCode}
                    onChangeText={setPairCode}
                    autoCapitalize="characters"
                    autoCorrect={false}
                    placeholder="XXXX-XXXX"
                    accessibilityLabel="Pairing code"
                    selectionColor={accent.ink}
                    cursorColor={accent.ink}
                    // SEEN ON WEB: a text input's intrinsic width (its `size`) is a flex
                    // minimum there, so `flex: 1` alone let it push the button off the
                    // row. minWidth 0 lets it shrink; a no-op on iOS.
                    style={styles.grow}
                  />
                  <AccentButton label="Pair" onPress={() => void pair()} disabled={pairCode.trim().length < 8} />
                </View>
                <WordLink title="Scan the code instead" onPress={() => router.push('/pair')} />
                <Outcome line={macLine} />
              </Chapter>

              <Chapter
                title="Cloud capture"
                line="Sessions from claude.ai/code run in a cloud container the Mac agent never sees. A capture key lets that container upload them, and do nothing else."
              >
                <CaptureKeysPanel accent={accent} />
              </Chapter>

              <Chapter title="Account">
                <View style={styles.action}>
                  <Button kind="secondary" size="compact" block={false} label="Sign out" onPress={() => void signOut()} />
                  <T role="row" weight={400} tone="dim">
                    Deletes what this phone saved, your creature and name included. Your sessions stay on your account.
                  </T>
                </View>
                <Hairline />
                <View style={styles.action}>
                  <Button kind="secondary" size="compact" block={false} destructive label="Delete account and all data" onPress={deleteAccount} />
                  <T role="row" weight={400} tone="dim">
                    Every session, device and token on the server, at once. There is no undo.
                  </T>
                </View>
                <Outcome line={accountLine} />
              </Chapter>
            </>
          ) : null}

          {known ? (
            <Section style={styles.footer}>
              <Block>
                <T role="meta" tone="faint">
                  {appLine()}
                </T>
              </Block>
            </Section>
          ) : null}
        </RevealPage>
      </Animated.ScrollView>
    </>
  );
}

/**
 * The band: the builder, in their hue. Keyed by the creature where it is used, so a new creature
 * prints a new band rather than recolouring the old one in place.
 */
function IdentityBand({
  accent,
  signedIn,
  me,
  localName,
  width,
  topLine,
  onCreature,
}: {
  accent: AccentState;
  signedIn: boolean;
  me: Me | null;
  localName: string | null;
  width: number;
  topLine: string | null;
  onCreature: () => void;
}) {
  const id = identityLines({ signedIn, me, localName });
  const inner = width - GUTTER * 2;
  const creature = Math.min(112, Math.floor((inner * 0.32) / 16) * 16);
  const nameSize = fitSize(id.name, inner, 56, 34);
  return (
    <Section>
      <Band hue={accent} title={id.title}>
        <BandWords delay={260}>
          <T
            role="hero"
            accessibilityRole="header"
            numberOfLines={1}
            adjustsFontSizeToFit
            minimumFontScale={0.6}
            style={{ color: ON_HUE, fontSize: nameSize, lineHeight: Math.round(nameSize * 1.04) }}
          >
            {id.name}
          </T>
        </BandWords>
        <View style={styles.bandRow}>
          <View style={styles.bandWords}>
            {id.handle ? (
              <BandWords delay={340}>
                <T role="headline" style={{ color: ON_HUE }}>
                  {id.handle}
                </T>
              </BandWords>
            ) : null}
            <BandWords delay={420}>
              <T role="row" weight={500} style={styles.bandNote}>
                {colourLine(accent.animal, accent.name)}
              </T>
            </BandWords>
          </View>
          <Pressable
            onPress={onCreature}
            accessibilityRole="button"
            accessibilityLabel={creatureLabel(accent.animal)}
            hitSlop={8}
            // The creature gives a little under a thumb, as a doorway band does: scale, never a
            // dimmed hue.
            style={({ pressed }) => ({ transform: [{ scale: pressed ? 0.96 : 1 }] })}
          >
            <CreaturePrint animal={accent.animal} size={creature} color={ON_HUE} delay={200} spread={620} />
          </Pressable>
        </View>
      </Band>
      {topLine ? (
        <Block style={styles.under}>
          <T role="row" weight={600} accessibilityLiveRegion="polite">
            {topLine}
          </T>
        </Block>
      ) : null}
    </Section>
  );
}

/**
 * A chapter under the band: a hairline, its heading and one plain sentence, then its content open
 * on the ground. Two blocks, so the heading plays when it arrives and the content right after.
 */
function Chapter({ title, line, children }: { title: string; line?: string; children: ReactNode }) {
  return (
    <Section style={styles.chapter}>
      <Block>
        <Hairline />
        <T role="title" accessibilityRole="header" style={styles.chapterTitle}>
          {title}
        </T>
        {line ? (
          <T role="row" weight={400} tone="dim" style={styles.chapterLine}>
            {line}
          </T>
        ) : null}
      </Block>
      <Block style={styles.chapterBody}>{children}</Block>
    </Section>
  );
}

/** What the last action in a chapter did, in a sentence, where the tap was. */
function Outcome({ line }: { line: string | null }) {
  if (!line) return null;
  return (
    <T role="row" weight={600} accessibilityLiveRegion="polite">
      {line}
    </T>
  );
}

/**
 * One switch, open on the ground: what it does in a headline with the platform's switch beside it
 * (native, in the accent), its sentence under it, and anything the switch needs said while on.
 */
function SwitchLine({
  title,
  sentence,
  value,
  disabled,
  onChange,
  accent,
  first = false,
  below,
}: {
  title: string;
  sentence: string;
  value: boolean;
  disabled?: boolean;
  onChange: (on: boolean) => void;
  accent: AccentState;
  first?: boolean;
  below?: ReactNode;
}) {
  return (
    <View style={[styles.switchLine, first ? null : styles.hairTop]}>
      <View style={styles.switchHead}>
        <T role="headline" style={styles.grow}>
          {title}
        </T>
        <Switch
          value={value}
          disabled={disabled}
          onValueChange={onChange}
          trackColor={{ true: accent.fill, false: GROUND.raised }}
          ios_backgroundColor={GROUND.raised}
          accessibilityLabel={title}
        />
      </View>
      <T role="row" weight={400} tone="dim">
        {sentence}
      </T>
      {below}
    </View>
  );
}

/**
 * The privacy switches. Two belong to the account and are the only way words from your
 * machine reach the server (contract v4): Quotes, and File names. Both start off, and
 * turning either off deletes what it let through (`src/data/privacy.ts`). The third,
 * Show details on Lock Screen, belongs to this phone: the Lock Screen is public.
 *
 * A switch flips when the server agrees, not before: a privacy switch that shows "off"
 * while the server still holds the quotes would be the one wrong state that matters.
 */
function PrivacySwitches({ signedIn, accent }: { signedIn: boolean; accent: AccentState }) {
  // undefined: still loading. null: this server has no such switches (hidden, not "off").
  const [prefs, setPrefs] = useState<PrivacyPrefs | null | undefined>(undefined);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [busy, setBusy] = useState<PrivacySwitch | null>(null);
  const [line, setLine] = useState<string | null>(null);
  const [lockDetails, setLockDetails] = useState<boolean | null>(null);

  useEffect(() => {
    void cache.getLockScreenDetails().then(setLockDetails);
  }, []);

  useEffect(() => {
    setLine(null);
    if (!signedIn) {
      setPrefs(undefined);
      setLoadError(null);
      return;
    }
    let cancelled = false;
    loadPrivacyPrefs(api)
      .then((p) => {
        if (!cancelled) setPrefs(p);
      })
      .catch((e: unknown) => {
        if (!cancelled) setLoadError(e instanceof Error ? e.message : 'could not load your privacy settings');
      });
    return () => {
      cancelled = true;
    };
  }, [signedIn]);

  const flip = useCallback(
    async (key: PrivacySwitch, on: boolean) => {
      if (!prefs || busy) return;
      setBusy(key);
      const out = await setPrivacySwitch(api, prefs, key, on, cache.forgetLiveNames, () => forgetCachedQuotes(cache));
      setPrefs(out.prefs);
      setLine(out.message);
      setBusy(null);
    },
    [prefs, busy]
  );

  const flipLock = useCallback(async (on: boolean) => {
    setLockDetails(on);
    await cache.setLockScreenDetails(on);
  }, []);

  const accountSwitches = signedIn && prefs;
  return (
    <View>
      {accountSwitches ? (
        <>
          <SwitchLine
            first
            title={QUOTES_TITLE}
            sentence={QUOTES_DETAIL}
            value={prefs.quotes}
            disabled={busy !== null}
            onChange={(v) => void flip('quotes', v)}
            accent={accent}
            below={
              prefs.quotes ? (
                <View style={styles.below}>
                  <T role="row" weight={400} tone="dim">
                    {QUOTES_MACHINE_HINT}
                  </T>
                  <View style={styles.code}>
                    <T role="mono" selectable>
                      {QUOTES_MACHINE_COMMAND}
                    </T>
                  </View>
                </View>
              ) : undefined
            }
          />
          <SwitchLine
            title={FILE_NAMES_TITLE}
            sentence={FILE_NAMES_DETAIL}
            value={prefs.live_names}
            disabled={busy !== null}
            onChange={(v) => void flip('live_names', v)}
            accent={accent}
          />
        </>
      ) : signedIn && prefs === undefined ? (
        <T role="row" weight={400} tone="dim" style={styles.switchLine}>
          {loadError ?? 'Loading your privacy settings…'}
        </T>
      ) : null}
      <SwitchLine
        first={!accountSwitches}
        title={LOCK_SCREEN_TITLE}
        sentence={lockScreenDetail(lockDetails ?? cache.LOCK_SCREEN_DETAILS_DEFAULT)}
        value={lockDetails ?? cache.LOCK_SCREEN_DETAILS_DEFAULT}
        disabled={lockDetails === null}
        onChange={(v) => void flipLock(v)}
        accent={accent}
      />
      <Outcome line={line} />
    </View>
  );
}

/**
 * Capture keys: the credential a Claude Code cloud container uploads with, because the
 * pairing flow's rotating refresh token cannot be shared between containers
 * (docs/cloud-capture.md). The list shows name, prefix and last use; "New key" shows the
 * plaintext ONCE, with a copy button, and forgets it when dismissed: the server keeps a
 * hash, so there is no second look. Revoke asks first: the container holding that key
 * gets a 401 from its next upload on.
 *
 * How many are live is set large, counted up once, beside the cap: the one number here.
 */
function CaptureKeysPanel({ accent }: { accent: AccentState }) {
  const [keys, setKeys] = useState<CaptureKey[] | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [name, setName] = useState('');
  const [minting, setMinting] = useState(false);
  const [mintError, setMintError] = useState<string | null>(null);
  const [created, setCreated] = useState<CaptureKeyCreated | null>(null);
  const [setupCopied, setSetupCopied] = useState(false);
  const [copied, setCopied] = useState(false);
  const [revoking, setRevoking] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    api
      .captureKeys()
      .then((r) => {
        if (!cancelled) setKeys(r.keys);
      })
      .catch((e: unknown) => {
        if (!cancelled) setLoadError(e instanceof Error ? e.message : 'could not load your keys');
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const mint = useCallback(async () => {
    if (minting) return;
    const chosen = name.trim() || CAPTURE_KEY_DEFAULT_NAME;
    if (captureKeyNameProblem(chosen)) return;
    setMinting(true);
    setMintError(null);
    try {
      const made = await api.createCaptureKey(chosen);
      setCreated(made);
      setSetupCopied(false);
      setCopied(false);
      setName('');
      setKeys((prev) => appendKey(prev ?? [], { ...made, last_used_at: null }));
    } catch (e) {
      setMintError(
        e instanceof ApiError && e.status === 409
          ? `You already have ${CAPTURE_KEY_MAX_LIVE} keys. Revoke one first.`
          : e instanceof Error
            ? e.message
            : 'could not create a key'
      );
    } finally {
      setMinting(false);
    }
  }, [minting, name]);

  const copy = useCallback(() => {
    if (!created) return;
    // React Native's Clipboard is deprecated in favour of expo-clipboard, which is not a
    // dependency yet; accessed through the namespace so the deprecation notice fires on
    // the tap, not at app start. The key is also `selectable` below for long-press copy.
    ReactNative.Clipboard.setString(created.key);
    setCopied(true);
  }, [created]);

  const revoke = useCallback((k: CaptureKey) => {
    Alert.alert(
      `Revoke ${k.name}?`,
      `${keyLabel(k.key_prefix)} stops working immediately. Anything still using it will fail to upload until you mint a new key and paste it there.`,
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Revoke',
          style: 'destructive',
          onPress: async () => {
            setRevoking(k.id);
            try {
              await api.revokeCaptureKey(k.id);
              setKeys((prev) => withoutKey(prev ?? [], k.id));
              setCreated((cur) => (cur && cur.id === k.id ? null : cur));
            } catch (e) {
              Alert.alert('Could not revoke', e instanceof Error ? e.message : 'try again');
            } finally {
              setRevoking(null);
            }
          },
        },
      ]
    );
  }, []);

  const nameProblem = name.trim() ? captureKeyNameProblem(name) : null;
  const capped = keys !== null && atKeyCap(keys);
  const canMint = !minting && keys !== null && !capped && nameProblem === null;

  return (
    <View style={styles.stack}>
      {/* The one showing of a fresh key: marked by a rule in the accent down its edge, not a
          card. The key in mono on the level above the ground, and one primary action: copy. */}
      {created ? (
        <View style={styles.fresh}>
          <View style={[styles.freshRule, { backgroundColor: accent.ink }]} />
          <View style={styles.freshBody}>
            <T role="headline">{created.name}: copy it now</T>
            <T role="row" weight={400} tone="dim">
              This is the only time the key is shown. {CAPTURE_KEY_PASTE_HINT}
            </T>
            <View style={styles.code}>
              <T role="mono" selectable accessibilityLabel="Capture key">
                {created.key}
              </T>
            </View>
            <View style={styles.actions}>
              <AccentButton label={copied ? 'Copied' : 'Copy'} accessibilityHint="Copies the capture key" onPress={copy} />
              <Button kind="secondary" size="compact" block={false} label="Done" onPress={() => setCreated(null)} />
            </View>
            <T role="headline" style={styles.freshSetup}>
              Set up the hook, once, in a terminal
            </T>
            <View style={[styles.code, styles.codeFlush]}>
              {/* Code keeps its lines: it scrolls sideways rather than wrapping mid command. */}
              <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.codeScroll}>
                <T role="mono" tone="dim" selectable>
                  {hookInstallSnippet(API_BASE_URL, created.key)}
                </T>
              </ScrollView>
            </View>
            <Button
              kind="secondary"
              size="compact"
              block={false}
              label={setupCopied ? 'Setup copied' : 'Copy setup'}
              accessibilityHint="Copies the hook setup commands"
              onPress={() => {
                ReactNative.Clipboard.setString(hookInstallSnippet(API_BASE_URL, created.key));
                setSetupCopied(true);
              }}
            />
          </View>
        </View>
      ) : null}

      {keys === null ? (
        <T role="row" weight={400} tone="dim">
          {loadError ?? 'Loading your keys…'}
        </T>
      ) : keys.length === 0 ? (
        <T role="row" weight={400} tone="dim">
          No keys yet.
        </T>
      ) : (
        <View>
          <View style={styles.count}>
            <Num spec={numSpec(keys.length, String(keys.length))} textStyle={figure(44, accent.ink)} accessibilityLabel={`${keys.length} ${keysCaption(keys.length, CAPTURE_KEY_MAX_LIVE)}`} />
            <T role="headline" style={styles.grow}>
              {keysCaption(keys.length, CAPTURE_KEY_MAX_LIVE)}
            </T>
          </View>
          {keys.map((k) => (
            <View key={k.id} style={[styles.keyLine, styles.hairTop]}>
              <View style={styles.grow}>
                <T role="headline" numberOfLines={1}>
                  {k.name}
                </T>
                <T role="meta" tone="dim">
                  {`${keyLabel(k.key_prefix)} · ${lastUsedLabel(k.last_used_at)}`}
                </T>
              </View>
              <Button
                kind="secondary"
                destructive
                size="compact"
                block={false}
                label={revoking === k.id ? 'Revoking…' : 'Revoke'}
                busy={revoking === k.id}
                accessibilityHint={`Revokes ${k.name}`}
                onPress={() => revoke(k)}
              />
            </View>
          ))}
        </View>
      )}

      <View style={styles.stackTight}>
        <View style={styles.inputRow}>
          <TextField
            value={name}
            onChangeText={(t) => {
              setMintError(null);
              setName(t.slice(0, CAPTURE_KEY_NAME_MAX + 8));
            }}
            placeholder={CAPTURE_KEY_DEFAULT_NAME}
            autoCapitalize="none"
            autoCorrect={false}
            editable={!minting}
            onSubmitEditing={() => void mint()}
            returnKeyType="done"
            accessibilityLabel="New key name"
            selectionColor={accent.ink}
            cursorColor={accent.ink}
            style={styles.grow}
          />
          <AccentButton
            label="New key"
            busy={minting}
            busyLabel={'Minting…'}
            disabled={!canMint && !minting}
            onPress={() => void mint()}
          />
        </View>
        <T role="meta" tone={mintError || nameProblem ? 'del' : 'dim'}>
          {mintError ??
            nameProblem ??
            (capped
              ? `Up to ${CAPTURE_KEY_MAX_LIVE} keys; revoke one to make room.`
              : 'Name it after where it lives. One key per cloud environment is plenty.')}
        </T>
      </View>
    </View>
  );
}

/**
 * Handle, display name, and whether the profile is public, as lines. Each field saves on its
 * own: the handle is the one with a 30-day rule and a uniqueness race, and a person fixing a
 * typo in their display name should not be told their handle is locked.
 */
function ProfileFields({ me, onChange, accent }: { me: Me; onChange: (next: Me) => void; accent: AccentState }) {
  const [publicBusy, setPublicBusy] = useState(false);

  const saveHandle = useCallback(
    async (raw: string) => {
      const next = await api.patchMe({ handle: normalizeHandle(raw) });
      onChange(next);
    },
    [onChange]
  );

  const saveDisplayName = useCallback(
    async (raw: string) => {
      const next = await api.patchMe({ display_name: raw.trim() || null });
      onChange(next);
    },
    [onChange]
  );

  const setPublic = useCallback(
    async (value: boolean) => {
      if (publicBusy) return;
      setPublicBusy(true);
      // Flip now, keep it only if the server agrees.
      onChange({ ...me, profile_public: value });
      try {
        onChange(await api.patchMe({ profile_public: value }));
      } catch (e) {
        onChange(me);
        Alert.alert('Could not update', e instanceof Error ? e.message : 'try again');
      } finally {
        setPublicBusy(false);
      }
    },
    [me, onChange, publicBusy]
  );

  return (
    <View>
      <InlineField
        first
        label="Handle"
        value={me.handle}
        placeholder="pick a handle"
        empty="not set"
        prefix="@"
        maxLength={HANDLE_MAX}
        hint={`${HANDLE_MIN} to ${HANDLE_MAX} characters: a to z, 0 to 9 and _. Changeable once every 30 days after the first pick.`}
        normalize={normalizeHandle}
        problem={handleProblem}
        canSave={(raw) => isValidHandle(raw) && normalizeHandle(raw) !== (me.handle ?? '')}
        onSave={saveHandle}
        describeError={(e) => (e.status === 409 ? describeHandleConflict(e.message) : e.message)}
        autoCapitalize="none"
        accent={accent}
      />
      <InlineField
        label="Display name"
        value={me.display_name}
        placeholder="how your name reads"
        empty="none"
        maxLength={MAX_DISPLAY_NAME + 8}
        hint={`Optional, up to ${MAX_DISPLAY_NAME} characters. Shown next to your handle.`}
        problem={displayNameProblem}
        canSave={(raw) => displayNameProblem(raw) === null && (raw.trim() || null) !== me.display_name}
        onSave={saveDisplayName}
        describeError={(e) => e.message}
        accent={accent}
      />
      <SwitchLine
        title="Public profile"
        sentence={me.profile_public ? 'Anyone can follow you at once.' : 'Follows need your approval.'}
        value={me.profile_public}
        disabled={publicBusy}
        onChange={(v) => void setPublic(v)}
        accent={accent}
      />
    </View>
  );
}

/**
 * A labelled value with an Edit word that turns into a text field, a live rule under it, and
 * Cancel and Save. The rule (`problem`) is the phone's copy of the server's; the server's own
 * refusal (`describeError`) replaces it when the save comes back.
 */
function InlineField({
  label,
  value,
  placeholder,
  empty,
  prefix = '',
  maxLength,
  hint,
  normalize = (raw) => raw,
  problem,
  canSave,
  onSave,
  describeError,
  autoCapitalize,
  accent,
  first = false,
}: {
  label: string;
  value: string | null;
  placeholder: string;
  empty: string;
  prefix?: string;
  maxLength: number;
  hint: string;
  normalize?: (raw: string) => string;
  problem: (raw: string) => string | null;
  canSave: (raw: string) => boolean;
  onSave: (raw: string) => Promise<void>;
  describeError: (e: ApiError) => string;
  autoCapitalize?: 'none' | 'sentences' | 'words' | 'characters';
  accent: AccentState;
  first?: boolean;
}) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState('');
  const [saving, setSaving] = useState(false);
  const [serverError, setServerError] = useState<string | null>(null);

  const begin = () => {
    setDraft(value ?? '');
    setServerError(null);
    setEditing(true);
  };

  const save = async () => {
    if (saving || !canSave(draft)) return;
    setSaving(true);
    setServerError(null);
    try {
      await onSave(draft);
      setEditing(false);
    } catch (e) {
      setServerError(
        e instanceof ApiError ? describeError(e) : e instanceof Error ? e.message : 'could not save'
      );
    } finally {
      setSaving(false);
    }
  };

  if (!editing) {
    return (
      <View style={[styles.fieldLine, first ? null : styles.hairTop]}>
        <View style={styles.grow}>
          <T role="label" tone="dim">
            {label.toLocaleLowerCase()}
          </T>
          <T role="headline" tone={value ? 'text' : 'dim'} numberOfLines={1}>
            {value ? `${prefix}${value}` : empty}
          </T>
        </View>
        <Button
          kind="secondary"
          size="compact"
          block={false}
          label="Edit"
          accessibilityHint={`Edits your ${label.toLowerCase()}`}
          onPress={begin}
        />
      </View>
    );
  }

  const rule = serverError ?? problem(draft);
  const ok = !saving && canSave(draft);
  return (
    <View style={[styles.fieldEdit, first ? null : styles.hairTop]}>
      <T role="label" tone="dim">
        {label.toLocaleLowerCase()}
      </T>
      <View style={styles.inputRow}>
        {prefix ? (
          <T role="body" tone="dim">
            {prefix}
          </T>
        ) : null}
        <TextField
          value={draft}
          onChangeText={(t) => {
            setServerError(null);
            setDraft(normalize(t).slice(0, maxLength));
          }}
          placeholder={placeholder}
          autoCapitalize={autoCapitalize}
          autoCorrect={false}
          autoFocus
          editable={!saving}
          onSubmitEditing={() => void save()}
          returnKeyType="done"
          accessibilityLabel={label}
          selectionColor={accent.ink}
          cursorColor={accent.ink}
          style={styles.grow}
        />
      </View>
      <T role="meta" tone={rule ? 'del' : 'dim'}>
        {rule ?? hint}
      </T>
      <View style={styles.actions}>
        <AccentButton label="Save" busy={saving} busyLabel={'Saving…'} disabled={!ok && !saving} onPress={() => void save()} />
        <Button kind="secondary" size="compact" block={false} label="Cancel" disabled={saving} onPress={() => setEditing(false)} />
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  scroll: { flex: 1, backgroundColor: GROUND.bg },
  content: { paddingBottom: space.xxl },
  bandSkeleton: { height: 220, backgroundColor: GROUND.raised },
  bandRow: { flexDirection: 'row', alignItems: 'flex-end', justifyContent: 'space-between', gap: space.tile, marginTop: space.tile },
  bandWords: { flex: 1, gap: space.sm, paddingBottom: space.xs },
  bandNote: { color: ON_HUE, opacity: 0.8 },
  under: { paddingHorizontal: GUTTER, marginTop: space.md },
  chapter: { paddingHorizontal: GUTTER, marginTop: space.xl },
  chapterTitle: { marginTop: space.lg },
  chapterLine: { marginTop: space.sm },
  chapterBody: { marginTop: space.md, gap: space.md },
  footer: { paddingHorizontal: GUTTER, marginTop: space.xxl },
  stack: { gap: space.tile },
  stackTight: { gap: space.sm },
  promise: { gap: space.sm, marginTop: space.sm },
  grow: { flex: 1, minWidth: 0 },
  inputRow: { flexDirection: 'row', alignItems: 'center', gap: space.tile },
  actions: { flexDirection: 'row', alignItems: 'center', gap: space.lg },
  action: { gap: space.xs, paddingVertical: space.xs },
  google: {
    height: SIGN_IN_HEIGHT,
    borderRadius: SHAPE.action,
    borderCurve: 'continuous',
    backgroundColor: GOOGLE_WHITE,
    alignItems: 'center',
    justifyContent: 'center',
  },
  hairTop: { borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: GROUND.border },
  switchLine: { paddingVertical: space.md, gap: space.xs },
  switchHead: { flexDirection: 'row', alignItems: 'center', gap: space.tile, minHeight: TAP_TARGET },
  below: { gap: space.xs, paddingTop: space.xs },
  code: {
    backgroundColor: GROUND.raised,
    borderRadius: SHAPE.inner,
    borderCurve: 'continuous',
    paddingHorizontal: space.tile,
    paddingVertical: space.sm,
    alignSelf: 'stretch',
  },
  codeFlush: { paddingHorizontal: 0, paddingVertical: 0 },
  codeScroll: { padding: space.tile },
  fresh: { flexDirection: 'row', gap: space.md, marginBottom: space.sm },
  freshRule: { width: 3 },
  freshBody: { flex: 1, gap: space.tile },
  freshSetup: { marginTop: space.sm },
  count: { flexDirection: 'row', alignItems: 'baseline', gap: space.tile, paddingBottom: space.sm },
  keyLine: { flexDirection: 'row', alignItems: 'center', gap: space.tile, paddingVertical: space.tile },
  fieldLine: { flexDirection: 'row', alignItems: 'center', gap: space.tile, minHeight: TAP_TARGET, paddingVertical: space.tile },
  fieldEdit: { gap: space.sm, paddingVertical: space.tile },
});
