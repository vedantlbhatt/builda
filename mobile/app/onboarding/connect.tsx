import * as AppleAuthentication from 'expo-apple-authentication';
import { useLocalSearchParams, useRouter, type Href } from 'expo-router';
import React, { useCallback, useEffect, useRef, useState } from 'react';
import { Keyboard, useWindowDimensions, View } from 'react-native';

import * as cache from '../../src/data/cache';
import { api, API_BASE_URL } from '../../src/data/client';
import { hookInstallSnippet } from '../../src/data/captureKeys';
import { getMachineId } from '../../src/data/machine';
import { BandWords } from '../../src/insights/Band';
import { numSpec } from '../../src/insights/format';
import { BandFigure, Refusal } from '../../src/insights/kit';
import { ON_HUE } from '../../src/insights/palette';
import { sendPendingName } from '../../src/nav/onboarding';
import { parsePairingCode } from '../../src/pairing/parse';
import { copyText } from '../../src/onboarding/clipboard';
import { CONNECT, CONTINUE, grouped, NOT_NOW, pairedWith, sessionsArrived } from '../../src/onboarding/copy';
import { setDraftApple } from '../../src/onboarding/draft';
import { loadFacts, useFacts } from '../../src/onboarding/facts';
import { GUTTER, pathFor } from '../../src/onboarding/flow';
import { ACTION_HEIGHT, HueButton, LEDGE } from '../../src/onboarding/HueButton';
import { APPLE_NAME_KEY } from '../../src/onboarding/keys';
import { appleCallName } from '../../src/onboarding/names';
import { StepBand } from '../../src/onboarding/StepBand';
import { STEP_MOTION } from '../../src/onboarding/bandShader';
import { StepFrame, useBandInset } from '../../src/onboarding/StepFrame';
import { BAND_CAPTION, BAND_FIGURE, BAND_TITLE, HEADLINE } from '../../src/onboarding/type';
import { useAccent } from '../../src/theme/accent';
import { colors, MONO_FAMILY, space } from '../../src/theme';
import { ClickSpark } from '../../src/ui/bits/effects/ClickSpark';
import { failure, Hairline, PressableScale, SHAPE, success, SymbolIcon, T, TextField } from '../../src/ui';

const c = colors('dark');

/** Apple's button, as tall as the flow's action with its ledge, so the slots never jump. */
const SIGN_IN_HEIGHT = ACTION_HEIGHT + LEDGE;
/** The setup button: the tap floor, a capsule like every action. */
const SETUP_HEIGHT = 44;
/** What the key minted for the hook setup is called in Settings, so a person can find and revoke it. */
const HOOK_KEY_NAME = 'Claude Code hooks';
/** The pairing's sparks fly past the button's own edge, onto the ground. */
const PAIRED_SPARK_REACH = 2.5;

type Pairing =
  | { kind: 'idle' }
  | { kind: 'busy'; code: string }
  | { kind: 'paired'; text: string }
  | { kind: 'error'; text: string };

type Hook = { kind: 'idle' } | { kind: 'busy' } | { kind: 'copied' } | { kind: 'error'; text: string };

/**
 * Step 4: your sessions, as a chapter. How sessions reach this phone, said as what the step can
 * actually do in the state the person is in, on the band in the builder's colour:
 *
 *   - Signed out, the only thing to do is sign in, so that is the headline and the action:
 *     "Sign in to connect.", Sign in with Apple, and Not now of equal weight. Apple sends the
 *     name only on the first authorisation; it is kept for the name step of a later run.
 *   - Signed in with sessions already on the account, there is nothing to connect: the count of
 *     them, huge, counting up from 0 (the analysis page's `BandFigure`), "sessions have reached
 *     your account", Continue, and "Pair another Mac" for the one who has two.
 *   - Signed in with none: pair the Mac with the code `builder pair` shows (the approval
 *     `app/pair.tsx` and Settings make; the Mac's QR opens this step with the code in it), or
 *     copy the Claude Code hook setup (docs/hooks-capture.md) for a machine with nothing
 *     installed. A pairing that goes through throws react-bits ClickSpark sparks in the colour
 *     (the kit keeps sparks for commitments, and a paired Mac is one).
 *
 * The footer is two slots that never remount, so nothing in it fades or jumps: the primary
 * (Sign in with Apple, Pair, or Continue) and a text button (Not now, or Continue once the
 * setup is copied). It sits above the keyboard with the column shrinking to make room
 * (`StepFrame keyboard`), never over the column.
 */
export default function ConnectStep() {
  const router = useRouter();
  const { code: paramCode } = useLocalSearchParams<{ code?: string }>();
  const facts = useFacts();
  const accent = useAccent();
  const inset = useBandInset();
  const { width } = useWindowDimensions();
  const signedIn = facts.signedIn;

  const code = useRef(typeof paramCode === 'string' ? paramCode : '');
  const [codeOk, setCodeOk] = useState(parsePairingCode(code.current) !== null);
  const [pairing, setPairing] = useState<Pairing>({ kind: 'idle' });
  const [hook, setHook] = useState<Hook>({ kind: 'idle' });
  const [signInError, setSignInError] = useState<string | null>(null);
  const [pairAnother, setPairAnother] = useState(false);
  const [pairedKey, setPairedKey] = useState(0);
  // The setup carries a key that exists nowhere else; make one per visit, not per tap.
  const snippet = useRef<string | null>(null);

  const next = useCallback(() => {
    Keyboard.dismiss();
    router.push(pathFor('notify') as Href);
  }, [router]);

  const pair = useCallback(async () => {
    const parsed = parsePairingCode(code.current);
    if (!parsed) {
      failure();
      setPairing({ kind: 'error', text: CONNECT.badCode });
      return;
    }
    setPairing({ kind: 'busy', code: parsed });
    try {
      const paired = await api.approvePairing(parsed);
      success();
      Keyboard.dismiss();
      setPairing({ kind: 'paired', text: pairedWith(paired.label) });
      setPairedKey((k) => k + 1);
    } catch {
      failure();
      setPairing({ kind: 'error', text: CONNECT.rejected });
    }
  }, []);

  // The Mac's QR, scanned with the Camera app mid onboarding, lands here with the code in it
  // (`pathWhileOnboarding`). It is put in the field and a person presses Pair: a link never pairs
  // by itself (`app/pair.tsx` says why: anyone can get a code, and a link can come from anywhere).

  const signIn = useCallback(async () => {
    setSignInError(null);
    try {
      const credential = await AppleAuthentication.signInAsync({
        requestedScopes: [
          AppleAuthentication.AppleAuthenticationScope.FULL_NAME,
          AppleAuthentication.AppleAuthenticationScope.EMAIL,
        ],
      });
      if (!credential.identityToken) throw new Error('no identity token');
      const called = appleCallName(credential.fullName);
      if (called) {
        setDraftApple(called);
        await cache.setKv(APPLE_NAME_KEY, called);
      }
      const machineId = await getMachineId();
      const tokens = await api.signInWithApple(credential.identityToken, machineId);
      await api.setTokens(tokens.access_token, tokens.refresh_token);
      success();
      // The name typed two steps ago reaches the account now.
      void sendPendingName();
      await loadFacts(true);
    } catch (e) {
      if ((e as { code?: string }).code === 'ERR_REQUEST_CANCELED') return;
      setSignInError(CONNECT.signInFailed);
    }
  }, []);

  const copyHook = useCallback(async () => {
    if (snippet.current) {
      if (copyText(snippet.current)) setHook({ kind: 'copied' });
      return;
    }
    setHook({ kind: 'busy' });
    try {
      const key = await api.createCaptureKey(HOOK_KEY_NAME);
      snippet.current = hookInstallSnippet(API_BASE_URL, key.key);
      if (!copyText(snippet.current)) throw new Error(CONNECT.clipboardFailed);
      success();
      setHook({ kind: 'copied' });
    } catch (e) {
      failure();
      setHook({ kind: 'error', text: e instanceof Error && e.message ? e.message : CONNECT.keyFailed });
    }
  }, []);

  const paired = pairing.kind === 'paired';
  const hasCode = parsePairingCode(code.current) !== null;
  const total = facts.total ?? 0;
  const arriving = signedIn === true && total > 0 && !pairAnother && !paired && !hasCode && pairing.kind === 'idle';
  const form = signedIn === true && !arriving;

  // ─── the two slots ───
  let primary: React.ReactNode = null;
  let secondary: React.ReactNode = <HueButton kind="secondary" label={NOT_NOW} hue={accent} onPress={next} />;
  if (signedIn === false) {
    primary = (
      <AppleAuthentication.AppleAuthenticationButton
        buttonType={AppleAuthentication.AppleAuthenticationButtonType.SIGN_IN}
        buttonStyle={AppleAuthentication.AppleAuthenticationButtonStyle.WHITE}
        cornerRadius={ACTION_HEIGHT / 2}
        style={{ height: ACTION_HEIGHT, marginTop: LEDGE }}
        onPress={() => void signIn()}
      />
    );
  } else if (arriving) {
    primary = <HueButton label={CONTINUE} hue={accent} onPress={next} />;
    secondary = <HueButton kind="secondary" label={CONNECT.pairAnother} hue={accent} onPress={() => setPairAnother(true)} />;
  } else if (paired) {
    primary = <HueButton label={CONTINUE} hue={accent} onPress={next} />;
    // The slot keeps its height, so Continue does not drop when there is nothing beside it.
    secondary = <View style={{ height: SIGN_IN_HEIGHT }} />;
  } else if (signedIn === true) {
    primary = (
      <HueButton
        label={CONNECT.pair}
        hue={accent}
        onPress={() => void pair()}
        disabled={!codeOk}
        busy={pairing.kind === 'busy'}
        busyLabel={pairing.kind === 'busy' ? `${CONNECT.pairing} ${pairing.code}` : undefined}
      />
    );
    if (hook.kind === 'copied') secondary = <HueButton kind="secondary" label={CONTINUE} hue={accent} onPress={next} />;
  } else {
    // The keychain has not answered yet: the slot holds its place.
    primary = <View style={{ height: SIGN_IN_HEIGHT }} />;
  }

  const headline = signedIn === false ? CONNECT.signedOutHeadline : signedIn === true ? CONNECT.headline : ' ';

  const band = (
    <StepBand motion={STEP_MOTION.connect} hue={accent} inset={inset}>
      <T role="label" style={[BAND_TITLE, { color: ON_HUE }]}>
        {CONNECT.label}
      </T>
      {arriving ? (
        <View style={{ marginTop: space.sm }}>
          <BandWords delay={260}>
            <T role="display" accessibilityRole="header" style={[HEADLINE, { color: ON_HUE }]}>
              {CONNECT.arrivingHeadline}
            </T>
          </BandWords>
          <BandFigure
            spec={numSpec(total, grouped(total))}
            width={width - 2 * GUTTER}
            max={BAND_FIGURE.max}
            min={BAND_FIGURE.min}
            delay={420}
            label={sessionsArrived(total, facts.partial)}
          />
          <BandWords delay={480}>
            <T role="headline" style={[BAND_CAPTION, { color: ON_HUE }]}>
              {total === 1 && !facts.partial ? CONNECT.arrivedCaptionOne : CONNECT.arrivedCaption}
            </T>
          </BandWords>
        </View>
      ) : (
        <BandWords delay={260}>
          <T role="display" accessibilityRole="header" style={[HEADLINE, { color: ON_HUE, marginTop: space.sm }]}>
            {headline}
          </T>
        </BandWords>
      )}
      <BandWords delay={340}>
        <View style={{ marginTop: space.sm }}>
          {signedIn === false ? (
            <T role="body" weight={500} style={{ color: ON_HUE }}>
              {CONNECT.signedOut}
            </T>
          ) : form ? (
            <T role="body" weight={500} style={{ color: ON_HUE }}>
              {CONNECT.signedInBefore}
              {/* The command in SF Mono, in the sentence's own ink: machine words, one tone. */}
              <T role="body" weight={600} style={{ color: ON_HUE, fontFamily: MONO_FAMILY }}>
                {CONNECT.command}
              </T>
              {CONNECT.signedInAfter}
            </T>
          ) : null}
        </View>
      </BandWords>
    </StepBand>
  );

  return (
    <StepFrame
      step="connect"
      keyboard
      band={band}
      actions={
        <>
          <ClickSpark hue={accent.name} sparkOnPress={false} playKey={pairedKey} extraScale={PAIRED_SPARK_REACH}>
            {primary}
          </ClickSpark>
          {secondary}
        </>
      }
    >
      {signedIn === false && signInError ? (
        <View style={{ marginTop: space.sm }} accessibilityLiveRegion="polite">
          <Refusal>{signInError}</Refusal>
        </View>
      ) : null}

      {form ? (
        <>
          <View style={{ gap: space.sm, marginTop: space.xs }}>
            <T role="label" tone="dim">
              {CONNECT.codeLabel}
            </T>
            <TextField
              mono
              defaultValue={code.current}
              onChangeText={(t) => {
                code.current = t;
                const ok = parsePairingCode(t) !== null;
                setCodeOk((was) => (was === ok ? was : ok));
                if (pairing.kind === 'error') setPairing({ kind: 'idle' });
              }}
              onSubmitEditing={() => void pair()}
              editable={pairing.kind !== 'busy' && !paired}
              autoCapitalize="characters"
              autoCorrect={false}
              autoComplete="off"
              // The plain return key: "go" is painted system blue.
              returnKeyType="default"
              keyboardAppearance="dark"
              selectionColor={accent.ink}
              cursorColor={accent.ink}
              placeholder={CONNECT.codePlaceholder}
              accessibilityLabel={CONNECT.codeLabel}
              style={{ minHeight: ACTION_HEIGHT, letterSpacing: 2 }}
            />
            {paired ? (
              <T role="headline" weight={700} style={{ color: accent.text }} accessibilityLiveRegion="polite">
                {pairing.text}
              </T>
            ) : pairing.kind === 'error' ? (
              <View accessibilityLiveRegion="polite">
                <Refusal>{pairing.text}</Refusal>
              </View>
            ) : null}
          </View>

          <Hairline style={{ marginVertical: space.md }} />

          <View style={{ gap: space.xs }}>
            <T role="headline">{CONNECT.hookTitle}</T>
            <T role="meta" tone="dim">
              {CONNECT.hookBody}
            </T>
            <SetupButton busy={hook.kind === 'busy'} onPress={() => void copyHook()} />
            {hook.kind === 'copied' ? (
              <T role="meta" weight={600} style={{ color: accent.text }} accessibilityLiveRegion="polite">
                {CONNECT.hookCopied}
              </T>
            ) : hook.kind === 'error' ? (
              <View accessibilityLiveRegion="polite">
                <Refusal>{hook.text}</Refusal>
              </View>
            ) : null}
          </View>
        </>
      ) : null}
    </StepFrame>
  );
}

/**
 * "Copy the setup": a secondary action inside the column, so it is a `raised` capsule with the
 * copy glyph, the one shape here that reads as something to press. A bare line of 17/600 text
 * read as a second heading.
 */
function SetupButton({ busy, onPress }: { busy: boolean; onPress: () => void }) {
  return (
    <PressableScale
      onPress={onPress}
      disabled={busy}
      accessibilityLabel={busy ? CONNECT.hookCopying : CONNECT.hookCopy}
      accessibilityState={{ busy }}
      style={{
        alignSelf: 'flex-start',
        flexDirection: 'row',
        alignItems: 'center',
        gap: space.sm,
        height: SETUP_HEIGHT,
        paddingHorizontal: space.md,
        marginTop: space.sm,
        borderRadius: SHAPE.action,
        borderCurve: 'continuous',
        backgroundColor: c.raised,
      }}
    >
      <SymbolIcon name="doc.on.doc" size={15} weight="semibold" tone="text" />
      <T role="row" style={{ opacity: busy ? 0.6 : 1 }}>
        {busy ? CONNECT.hookCopying : CONNECT.hookCopy}
      </T>
    </PressableScale>
  );
}
