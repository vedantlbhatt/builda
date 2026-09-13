import * as AppleAuthentication from 'expo-apple-authentication';
import Constants from 'expo-constants';
import { useRouter } from 'expo-router';
import React, { useCallback, useEffect, useState } from 'react';
import * as ReactNative from 'react-native';
import { Alert, Pressable, ScrollView, Switch, View } from 'react-native';

import { isGoogleConfigured, onGoogleSignIn, startGoogleSignIn } from '../src/auth/googleFlow';
import { ApiError, type CaptureKey, type CaptureKeyCreated, type Me } from '../src/data/api';
import * as cache from '../src/data/cache';
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
import { PixelSprite } from '../src/pixel/PixelSprite';
import { spriteLeftInset } from '../src/pixel/optical';
import { sendPendingName } from '../src/nav/onboarding';
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
import { colors, layout, space, TAP_TARGET } from '../src/theme';
import { Button, Hairline, Row, SHAPE, Section, Surface, T, TextField } from '../src/ui';

const c = colors('dark');

/** The sign-in buttons: the same 52pt capsule as every primary action. */
const SIGN_IN_HEIGHT = 52;

/** "Builder · v0.1.0" — the version is read from the config, never typed here twice. */
function appLine(): string {
  const v = Constants.expoConfig?.version;
  return v ? `Builder · v${v}` : 'Builder';
}

export default function SettingsScreen() {
  const router = useRouter();
  const [signedIn, setSignedIn] = useState(false);
  const [pairCode, setPairCode] = useState('');
  const [status, setStatus] = useState<string | null>(null);
  const [me, setMe] = useState<Me | null>(null);
  const [meError, setMeError] = useState<string | null>(null);
  const googleReady = isGoogleConfigured();

  useEffect(() => {
    void api.isSignedIn().then(setSignedIn);
    // The Google redirect is finished by the root layout; this screen only learns the
    // outcome, so it updates in place when the browser hands control back.
    return onGoogleSignIn((r) => {
      if (r.ok) {
        setSignedIn(true);
        setStatus('Signed in with Google. Pull to refresh on Sessions.');
      } else {
        setStatus(r.message);
      }
    });
  }, []);

  // The viewer's own row, once there is a viewer. Re-read whenever sign-in flips on, so a
  // fresh sign-in shows the handle it already has rather than "not set".
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
      setStatus('Signed in. Pull to refresh on Sessions.');
      void registerForPush(api);
      // The name picked in onboarding while signed out, if it has not reached the account yet.
      void sendPendingName();
    } catch (e) {
      if ((e as { code?: string }).code === 'ERR_REQUEST_CANCELED') return;
      setStatus(e instanceof Error ? e.message : 'sign in failed');
    }
  }, []);

  const signInGoogle = useCallback(async () => {
    try {
      setStatus('Continue in the browser…');
      await startGoogleSignIn();
    } catch (e) {
      setStatus(e instanceof Error ? e.message : 'could not open Google sign-in');
    }
  }, []);

  const pair = useCallback(async () => {
    try {
      const result = await api.approvePairing(pairCode.trim().toUpperCase());
      setStatus(`Paired with ${result.label}.`);
      setPairCode('');
    } catch {
      setStatus('That code was not recognised, or it expired.');
    }
  }, [pairCode]);

  const signOut = useCallback(async () => {
    await api.clearTokens();
    // Cached sessions are the user's data, not ours to keep once they leave.
    await cache.clear();
    setSignedIn(false);
    setStatus('Signed out. Local copies deleted.');
  }, []);

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
              setStatus(`Deleted. Receipt ${result.receipt.slice(0, 12)}…`);
            } catch {
              setStatus('Could not reach the server. Nothing was deleted.');
            }
          },
        },
      ]
    );
  }, []);

  return (
    <ScrollView
      style={{ flex: 1, backgroundColor: c.bg }}
      contentInsetAdjustmentBehavior="automatic"
      keyboardShouldPersistTaps="handled"
      contentContainerStyle={{
        paddingHorizontal: layout.gutter,
        paddingTop: space.md,
        paddingBottom: space.xxl,
        gap: layout.sectionGap,
      }}
    >
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: space.sm }}>
        {/* Pulled onto the gutter by its empty columns, like every Bit beside text. */}
        <PixelSprite state="idle" size={32} fps={2} style={{ marginLeft: -spriteLeftInset('idle', 32) }} />
        <T role="meta" tone="dim">
          {appLine()}
        </T>
      </View>

      {!signedIn ? (
        <Section label="Account">
          <Surface style={{ gap: space.sm }}>
            <T role="meta" tone="dim" style={{ marginBottom: space.xs }}>
              Builder works without an account. You are seeing a sample session. Sign in to
              sync your own from the Mac agent.
            </T>
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
                style={({ pressed }) => ({
                  height: SIGN_IN_HEIGHT,
                  borderRadius: SHAPE.action,
                  borderCurve: 'continuous',
                  backgroundColor: c.googleButton,
                  alignItems: 'center',
                  justifyContent: 'center',
                  opacity: pressed ? 0.7 : 1,
                })}
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
          </Surface>
        </Section>
      ) : (
        <>
          <Section label="pair your Mac" preserveCase>
            <Surface style={{ gap: space.tile }}>
              <T role="meta" tone="dim">
                Run{' '}
                <T role="mono" tone="text">
                  builder pair
                </T>{' '}
                on your Mac, then scan the code it shows or type it.
              </T>
              <View style={{ flexDirection: 'row', alignItems: 'center', gap: space.tile }}>
                <TextField
                  value={pairCode}
                  onChangeText={setPairCode}
                  autoCapitalize="characters"
                  autoCorrect={false}
                  placeholder="XXXX-XXXX"
                  accessibilityLabel="Pairing code"
                  // SEEN ON WEB: a text input's intrinsic width (its `size`) is a flex
                  // minimum there, so `flex: 1` alone let it push the Scan button off the
                  // card. minWidth 0 lets it shrink; a no-op on iOS.
                  style={{ flex: 1, minWidth: 0, letterSpacing: 2 }}
                />
                <Button kind="secondary" size="compact" block={false} label="Scan code" onPress={() => router.push('/pair')} />
              </View>
              <Button label="Pair" size="compact" onPress={pair} disabled={pairCode.trim().length < 8} />
            </Surface>
          </Section>

          <Section label="Cloud capture" gap={space.tile}>
            <CaptureKeysPanel />
          </Section>

          <Section label="Profile">
            <Surface padding={0}>
              {me ? (
                <ProfileFields me={me} onChange={setMe} />
              ) : (
                <T role="meta" tone="dim" style={{ padding: layout.gutter }}>
                  {meError ?? 'Loading your profile\u2026'}
                </T>
              )}
            </Surface>
          </Section>

          <Section label="Account">
            <Surface padding={0}>
              <Button kind="secondary" size="compact" label="Sign out" onPress={signOut} />
              <Hairline />
              <Button kind="secondary" size="compact" destructive label="Delete account and all data" onPress={deleteAccount} />
            </Surface>
          </Section>
        </>
      )}

      <Section label="Privacy">
        <Surface style={{ gap: space.tile }}>
          <T role="meta" tone="dim">
            Your prompts, your code, your diffs and your file names never leave your machine.
            What syncs is timings, counts, the shape of the session, and, only for
            repositories you mark public, the repository name and the title your editor
            already wrote to your own disk.
          </T>
          {/* The command on a line of its own: run inline, the line breaker split it after
              "--" and set "dry-run" on the next line, which no one can paste. */}
          <T role="meta" tone="dim">
            The Mac agent is open source. This prints every byte it would send, without
            sending it:
          </T>
          <T role="mono" tone="text" selectable>
            builder sync --dry-run --print-payload
          </T>
        </Surface>
      </Section>

      {/* The outcome of the last thing done here, where the eye lands after the tap. A
          sentence in text, not amber: amber is for actions and state, not for news. */}
      {status && (
        <T role="meta" weight={600} accessibilityLiveRegion="polite">
          {status}
        </T>
      )}
    </ScrollView>
  );
}

/**
 * Capture keys: the credential a Claude Code cloud container uploads with, because the
 * pairing flow's rotating refresh token cannot be shared between containers
 * (docs/cloud-capture.md). The list shows name, prefix and last use; "New key" shows the
 * plaintext ONCE, with a copy button, and forgets it when dismissed — the server keeps a
 * hash, so there is no second look. Revoke asks first: the container holding that key
 * gets a 401 from its next upload on.
 */
function CaptureKeysPanel() {
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
    <>
      <T role="meta" tone="dim">
        Sessions from claude.ai/code run in a cloud container the Mac agent never sees. A
        capture key lets that container upload them, and do nothing else.
      </T>

      {/* The one showing of a fresh key. A plain card, the key in mono on the level above
          it, and one amber action: copying it. Nothing here is outlined in amber. */}
      {created && (
        <Surface style={{ gap: space.tile }}>
          <View style={{ gap: space.xs }}>
            <T role="row">{created.name}: copy it now</T>
            <T role="meta" tone="dim">
              This is the only time the key is shown. {CAPTURE_KEY_PASTE_HINT}
            </T>
          </View>
          <Surface level="raised" shape="inner" hairline={false} padding={space.tile}>
            <T role="mono" selectable accessibilityLabel="Capture key">
              {created.key}
            </T>
          </Surface>
          <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'flex-end', gap: space.lg }}>
            <Button kind="secondary" size="compact" block={false} label="Done" onPress={() => setCreated(null)} />
            <Button
              size="compact"
              block={false}
              label={copied ? 'Copied' : 'Copy'}
              accessibilityHint="Copies the capture key"
              onPress={copy}
            />
          </View>
          <Hairline />
          <T role="row">Set up the hook (paste once in a terminal)</T>
          <Surface level="raised" shape="inner" hairline={false} padding={0}>
            {/* Code keeps its lines: it scrolls sideways rather than wrapping mid-command. */}
            <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ padding: space.tile }}>
              <T role="mono" tone="dim" selectable>
                {hookInstallSnippet(API_BASE_URL, created.key)}
              </T>
            </ScrollView>
          </Surface>
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
        </Surface>
      )}

      {keys === null ? (
        <T role="meta" tone="dim">
          {loadError ?? 'Loading your keys\u2026'}
        </T>
      ) : keys.length === 0 ? (
        <T role="meta" tone="dim">
          No keys yet.
        </T>
      ) : (
        <Surface padding={0}>
          {keys.map((k, i) => (
            <Row
              key={k.id}
              title={k.name}
              meta={`${keyLabel(k.key_prefix)} · ${lastUsedLabel(k.last_used_at)}`}
              hairline={i < keys.length - 1}
              trailing={
                <Button
                  kind="secondary"
                  destructive
                  size="compact"
                  block={false}
                  label={revoking === k.id ? 'Revoking\u2026' : 'Revoke'}
                  busy={revoking === k.id}
                  accessibilityHint={`Revokes ${k.name}`}
                  onPress={() => revoke(k)}
                />
              }
            />
          ))}
        </Surface>
      )}

      <View style={{ gap: space.sm }}>
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: space.tile }}>
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
            style={{ flex: 1, minWidth: 0 }}
          />
          <Button
            size="compact"
            block={false}
            label="New key"
            busy={minting}
            busyLabel={'Minting\u2026'}
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
    </>
  );
}

/**
 * Handle, display name, and whether the profile is public. Each field saves on its own:
 * the handle is the one with a 30-day rule and a uniqueness race, and a person fixing a
 * typo in their display name should not be told their handle is locked.
 */
function ProfileFields({ me, onChange }: { me: Me; onChange: (next: Me) => void }) {
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
    <>
      <InlineField
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
      />
      <Hairline inset={layout.gutter} />
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
      />
      <Hairline inset={layout.gutter} />
      <Row
        title="Public profile"
        meta={me.profile_public ? 'Anyone can follow you at once.' : 'Follows need your approval.'}
        trailing={
          <Switch
            value={me.profile_public}
            disabled={publicBusy}
            onValueChange={(v) => void setPublic(v)}
            trackColor={{ true: c.accent }}
            accessibilityLabel="Public profile"
          />
        }
      />
    </>
  );
}

/**
 * A labelled value with an Edit affordance that turns into a text field, a live rule
 * under it, and Save/Cancel. The rule (`problem`) is the phone's copy of the server's;
 * the server's own refusal (`describeError`) replaces it when the save comes back.
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
      <View style={fieldRow}>
        <View style={{ flex: 1, gap: space.xs }}>
          <T role="label" tone="dim">
            {label.toLocaleLowerCase()}
          </T>
          <T role="row" tone={value ? 'text' : 'dim'} numberOfLines={1}>
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
    <View style={[fieldRow, { flexDirection: 'column', alignItems: 'stretch', gap: space.sm, paddingVertical: space.tile }]}>
      <T role="label" tone="dim">
        {label.toLocaleLowerCase()}
      </T>
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: space.sm }}>
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
          style={{ flex: 1 }}
        />
      </View>
      <T role="meta" tone={rule ? 'del' : 'dim'}>
        {rule ?? hint}
      </T>
      <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'flex-end', gap: space.lg }}>
        <Button kind="secondary" size="compact" block={false} label="Cancel" disabled={saving} onPress={() => setEditing(false)} />
        <Button
          size="compact"
          block={false}
          label="Save"
          busy={saving}
          busyLabel={'Saving\u2026'}
          disabled={!ok && !saving}
          onPress={() => void save()}
        />
      </View>
    </View>
  );
}

/** A field's line in the Profile surface: the gutter the rows use, the 44pt floor. */
const fieldRow = {
  flexDirection: 'row',
  alignItems: 'center',
  minHeight: TAP_TARGET,
  paddingHorizontal: layout.gutter,
  paddingVertical: space.sm,
  gap: space.tile,
} as const;
