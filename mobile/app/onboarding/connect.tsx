import * as AppleAuthentication from 'expo-apple-authentication';
import { useLocalSearchParams, useRouter, type Href } from 'expo-router';
import React, { useCallback, useEffect, useRef, useState } from 'react';
import { Keyboard, View } from 'react-native';

import * as cache from '../../src/data/cache';
import { api, API_BASE_URL } from '../../src/data/client';
import { hookInstallSnippet } from '../../src/data/captureKeys';
import { getMachineId } from '../../src/data/machine';
import { sendPendingName } from '../../src/nav/onboarding';
import { parsePairingCode } from '../../src/pairing/parse';
import { copyText } from '../../src/onboarding/clipboard';
import { CONNECT, CONTINUE, NOT_NOW, pairedWith, sessionsArrived } from '../../src/onboarding/copy';
import { setDraftApple } from '../../src/onboarding/draft';
import { loadFacts, useFacts } from '../../src/onboarding/facts';
import { pathFor } from '../../src/onboarding/flow';
import { APPLE_NAME_KEY } from '../../src/onboarding/keys';
import { appleCallName } from '../../src/onboarding/names';
import { Headline } from '../../src/onboarding/Headline';
import { StepFrame } from '../../src/onboarding/StepFrame';
import { colors, MONO_FAMILY, space } from '../../src/theme';
import { Button, failure, Hairline, PressableScale, SHAPE, success, SymbolIcon, T, TextField } from '../../src/ui';

const c = colors('dark');

/** The same 52pt capsule as every primary action (Settings draws Apple's button the same way). */
const SIGN_IN_HEIGHT = 52;
/** The setup button: the tap floor, a capsule like every action. */
const SETUP_HEIGHT = 44;
/** What the key minted for the hook setup is called in Settings, so a person can find and revoke it. */
const HOOK_KEY_NAME = 'Claude Code hooks';

type Pairing =
  | { kind: 'idle' }
  | { kind: 'busy'; code: string }
  | { kind: 'paired'; text: string }
  | { kind: 'error'; text: string };

type Hook = { kind: 'idle' } | { kind: 'busy' } | { kind: 'copied' } | { kind: 'error'; text: string };

/**
 * Step 4: your sessions (DESIGN-DIRECTION 4). How sessions reach this phone, said as what the
 * step can actually do in the state the person is in:
 *
 *   - Signed out, the only thing to do is sign in, so that is the headline and the action:
 *     "Sign in to connect.", Sign in with Apple, and Not now of equal weight. Apple sends the
 *     name only on the first authorisation; it is kept for the name step of a later run.
 *   - Signed in with sessions already on the account, there is nothing to connect: "Sessions
 *     are arriving.", the count, Continue, and "Pair another Mac" for the one who has two.
 *   - Signed in with none: pair the Mac with the code `builder pair` shows (the approval
 *     `app/pair.tsx` and Settings make; the Mac's QR opens this step with the code in it), or
 *     copy the Claude Code hook setup (docs/hooks-capture.md) for a machine with nothing
 *     installed.
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
  const signedIn = facts.signedIn;

  const code = useRef(typeof paramCode === 'string' ? paramCode : '');
  const [codeOk, setCodeOk] = useState(parsePairingCode(code.current) !== null);
  const [pairing, setPairing] = useState<Pairing>({ kind: 'idle' });
  const [hook, setHook] = useState<Hook>({ kind: 'idle' });
  const [signInError, setSignInError] = useState<string | null>(null);
  const [pairAnother, setPairAnother] = useState(false);
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
    } catch {
      failure();
      setPairing({ kind: 'error', text: CONNECT.rejected });
    }
  }, []);

  // The Mac's QR, scanned with the Camera app mid onboarding, lands here with the code in it
  // (`pathWhileOnboarding`). Pair at once when there is an account to pair it to.
  const autoPaired = useRef(false);
  useEffect(() => {
    if (autoPaired.current || signedIn !== true || !parsePairingCode(code.current)) return;
    autoPaired.current = true;
    void pair();
  }, [signedIn, pair]);

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
  const arriving = signedIn === true && (facts.total ?? 0) > 0 && !pairAnother && !paired && !hasCode && pairing.kind === 'idle';
  const form = signedIn === true && !arriving;

  // ─── the two slots ───
  let primary: React.ReactNode = null;
  let secondary: React.ReactNode = <Button kind="secondary" label={NOT_NOW} onPress={next} />;
  if (signedIn === false) {
    primary = (
      <AppleAuthentication.AppleAuthenticationButton
        buttonType={AppleAuthentication.AppleAuthenticationButtonType.SIGN_IN}
        buttonStyle={AppleAuthentication.AppleAuthenticationButtonStyle.WHITE}
        cornerRadius={SIGN_IN_HEIGHT / 2}
        style={{ height: SIGN_IN_HEIGHT }}
        onPress={() => void signIn()}
      />
    );
  } else if (arriving) {
    primary = <Button label={CONTINUE} onPress={next} />;
    secondary = <Button kind="secondary" label={CONNECT.pairAnother} onPress={() => setPairAnother(true)} />;
  } else if (paired) {
    primary = <Button label={CONTINUE} onPress={next} />;
    // The slot keeps its height, so Continue does not drop when there is nothing beside it.
    secondary = <View style={{ height: SIGN_IN_HEIGHT }} />;
  } else if (signedIn === true) {
    primary = (
      <Button
        label={CONNECT.pair}
        onPress={() => void pair()}
        disabled={!codeOk}
        busy={pairing.kind === 'busy'}
        busyLabel={pairing.kind === 'busy' ? `${CONNECT.pairing} ${pairing.code}` : undefined}
      />
    );
    if (hook.kind === 'copied') secondary = <Button kind="secondary" label={CONTINUE} onPress={next} />;
  } else {
    // The keychain has not answered yet: the slot holds its place.
    primary = <View style={{ height: SIGN_IN_HEIGHT }} />;
  }

  const headline =
    signedIn === false ? CONNECT.signedOutHeadline : arriving ? CONNECT.arrivingHeadline : signedIn === true ? CONNECT.headline : ' ';

  return (
    <StepFrame
      step="connect"
      keyboard
      actions={
        <>
          {primary}
          {secondary}
        </>
      }
    >
      <T role="label" tone="dim">
        {CONNECT.label}
      </T>
      <Headline>{headline}</Headline>

      {signedIn === false ? (
        <>
          <T role="body" tone="dim">
            {CONNECT.signedOut}
          </T>
          {signInError ? (
            <T role="meta" tone="del" accessibilityLiveRegion="polite">
              {signInError}
            </T>
          ) : null}
        </>
      ) : null}

      {arriving ? (
        <T role="body" tone="dim">
          {sessionsArrived(facts.total ?? 0, facts.partial)}
        </T>
      ) : null}

      {form ? (
        <>
          <T role="body" tone="dim">
            {CONNECT.signedInBefore}
            {/* The command in SF Mono, in the sentence's own ink: machine words, one tone. */}
            <T role="body" tone="dim" style={{ fontFamily: MONO_FAMILY }}>
              {CONNECT.command}
            </T>
            {CONNECT.signedInAfter}
          </T>

          <View style={{ gap: space.sm, marginTop: space.md }}>
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
              placeholder={CONNECT.codePlaceholder}
              accessibilityLabel={CONNECT.codeLabel}
              style={{ minHeight: SIGN_IN_HEIGHT, letterSpacing: 2 }}
            />
            {paired || pairing.kind === 'error' ? (
              <T role="meta" tone={pairing.kind === 'error' ? 'del' : 'text'} accessibilityLiveRegion="polite">
                {pairing.text}
              </T>
            ) : null}
          </View>

          <Hairline style={{ marginVertical: space.md }} />

          <View style={{ gap: space.xs }}>
            <T role="headline">{CONNECT.hookTitle}</T>
            <T role="meta" tone="dim">
              {CONNECT.hookBody}
            </T>
            <SetupButton busy={hook.kind === 'busy'} onPress={() => void copyHook()} />
            {hook.kind === 'copied' || hook.kind === 'error' ? (
              <T role="meta" tone={hook.kind === 'error' ? 'del' : 'text'} accessibilityLiveRegion="polite">
                {hook.kind === 'error' ? hook.text : CONNECT.hookCopied}
              </T>
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
