import { CameraView, useCameraPermissions, type BarcodeScanningResult } from 'expo-camera';
import { useLocalSearchParams, useRouter } from 'expo-router';
import React, { useCallback, useEffect, useRef, useState, type ReactNode } from 'react';
import { Linking, StyleSheet, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { api } from '../src/data/client';
import { approveFailedLine, parsePairingCode } from '../src/pairing/parse';
import { PixelSprite } from '../src/pixel/PixelSprite';
import type { SpriteState } from '../src/pixel/sprites';
import { colors, layout, space } from '../src/theme';
import { Button, failure, SHAPE, Surface, success, T } from '../src/ui';

/**
 * "Connect your Mac": scan the code `builder pair` shows instead of typing it.
 *
 * The Mac prints a user code and a QR of the same code (or a URL carrying it). Approving it
 * here attaches that Mac to this account — the same call the typed path makes, so a scan
 * that cannot be read falls back to typing with nothing lost.
 */

const c = colors('dark');

type Status =
  | { kind: 'idle'; text: string }
  | { kind: 'busy'; text: string }
  | { kind: 'ok'; text: string }
  | { kind: 'error'; text: string };

const RESCAN_DELAY_MS = 1500;
/** Long enough to see Bit cheer once (three frames at 4 fps is 750 ms) and read the label. */
const LEAVE_DELAY_MS = 2000;

export default function PairScreen() {
  const router = useRouter();
  // `builder://pair?code=XXXX-XXXX` is the QR's payload. Scanned by the iOS Camera app it
  // opens this screen directly, so the code arrives as a param and no preview is needed.
  const { code: paramCode } = useLocalSearchParams<{ code?: string }>();
  const [permission, requestPermission] = useCameraPermissions();
  const [signedIn, setSignedIn] = useState<boolean | null>(null);
  const [status, setStatus] = useState<Status>({
    kind: 'idle',
    text: 'Point the camera at the code on your Mac.',
  });
  // A QR in frame fires the scanner many times a second; one approval per code.
  const lockRef = useRef(false);
  // The code that was just refused. The camera rescans a QR every RESCAN_DELAY_MS, and sending a
  // stale code again and again burned the account's tries (review, 2026-09-19); it is said again,
  // not sent again.
  const refused = useRef<{ code: string; line: string } | null>(null);
  const timers = useRef<ReturnType<typeof setTimeout>[]>([]);

  useEffect(() => {
    void api.isSignedIn().then(setSignedIn);
    return () => {
      for (const t of timers.current) clearTimeout(t);
    };
  }, []);

  const granted = permission?.granted ?? false;
  const canAsk = permission?.canAskAgain ?? true;
  // Only when the camera is the way in: a code that came in a link is shown, not scanned, and the
  // screen asked for the camera over its own Approve button (seen on the simulator).
  const linked = typeof paramCode === 'string' && paramCode.length > 0;
  useEffect(() => {
    if (!linked && permission && !granted && canAsk) void requestPermission();
  }, [linked, permission, granted, canAsk, requestPermission]);

  const later = useCallback((fn: () => void, ms: number) => {
    timers.current.push(setTimeout(fn, ms));
  }, []);

  const approve = useCallback(
    async (text: string) => {
      if (lockRef.current) return;
      lockRef.current = true;

      const code = parsePairingCode(text);
      if (!code) {
        setStatus({ kind: 'error', text: 'That is not a Builda pairing code.' });
        later(() => {
          lockRef.current = false;
        }, RESCAN_DELAY_MS);
        return;
      }

      if (refused.current?.code === code) {
        setStatus({ kind: 'error', text: refused.current.line });
        later(() => {
          lockRef.current = false;
        }, RESCAN_DELAY_MS);
        return;
      }
      setStatus({ kind: 'busy', text: `Pairing ${code}…` });
      try {
        const paired = await api.approvePairing(code);
        success();
        setStatus({ kind: 'ok', text: `Paired with ${paired.label}.` });
        later(() => router.back(), LEAVE_DELAY_MS);
      } catch (e) {
        failure();
        const line = approveFailedLine(e, 'That code was not recognised, or it expired. Try again.');
        refused.current = { code, line };
        setStatus({ kind: 'error', text: line });
        later(() => {
          lockRef.current = false;
        }, RESCAN_DELAY_MS);
      }
    },
    [later, router]
  );
  const onScanned = useCallback(
    (result: BarcodeScanningResult) => void approve(result.data),
    [approve]
  );

  // A link NEVER approves by itself. FOUND IN REVIEW (2026-09-19): this used to approve the moment
  // a signed in app opened `builder://pair?code=`, and anyone can start a device grant and get a
  // code without an account, so a link on a web page or in an email ("Open in Builda?") handed that
  // stranger's device a token pair for this account. The code is shown, and a person approves it
  // only if their own Mac is showing the same code. A scan stays one step: pointing the camera at
  // the Mac on your desk is the deliberate act a link is not.
  const deepLinked = typeof paramCode === 'string' && paramCode.length > 0;

  if (signedIn === false) {
    return (
      <Notice
        title="Sign in first"
        text="Pairing attaches your Mac to your account, so there has to be one."
        actions={<TypeInstead label="Go to Settings" />}
      />
    );
  }

  if (deepLinked) {
    const shown = parsePairingCode(paramCode) ?? paramCode;
    if (status.kind === 'idle') {
      return (
        <Notice
          title="Connect a Mac?"
          text={`Approve only if a Mac of yours is showing ${shown} right now. Approving lets it upload sessions and read your account.`}
          actions={
            <>
              <Button label={`Approve ${shown}`} onPress={() => void approve(paramCode)} />
              <Button kind="secondary" size="compact" label="Not mine" onPress={() => router.back()} />
            </>
          }
        />
      );
    }
    return (
      <Notice
        title="Connecting your Mac"
        sprite={status.kind === 'ok' ? 'celebrating' : undefined}
        text={status.text}
        tone={status.kind === 'error' ? 'del' : 'dim'}
        actions={status.kind === 'error' ? <TypeInstead /> : null}
      />
    );
  }

  if (!permission || signedIn === null) {
    return <View style={{ flex: 1, backgroundColor: c.bg }} />;
  }

  if (!granted) {
    return canAsk ? (
      <Notice
        title="Camera access"
        text="Builda uses the camera only to read the pairing code on your Mac."
        actions={
          <>
            <Button label="Allow camera" onPress={() => void requestPermission()} />
            <TypeInstead />
          </>
        }
      />
    ) : (
      <Notice
        title="Camera access is off"
        sprite="idle"
        text="Allow the camera in iOS Settings to scan, or type the code on the Settings screen."
        actions={
          <>
            <Button label="Open iOS Settings" onPress={() => void Linking.openSettings()} />
            <TypeInstead />
          </>
        }
      />
    );
  }

  const scanning = status.kind === 'idle' || status.kind === 'error';

  return (
    <View style={{ flex: 1, backgroundColor: c.bg }}>
      <CameraView
        style={{ flex: 1 }}
        facing="back"
        barcodeScannerSettings={{ barcodeTypes: ['qr'] }}
        onBarcodeScanned={scanning ? onScanned : undefined}
      />
      {/* Framing guide, over the preview. Pointer events pass through to nothing; the
          camera does not need touches. A container's corner, and amber only once the code
          has been read: the one state change on this screen. */}
      <View pointerEvents="none" style={[StyleSheet.absoluteFill, { alignItems: 'center', justifyContent: 'center' }]}>
        <View
          style={{
            width: 220,
            height: 220,
            borderRadius: SHAPE.container,
            borderCurve: 'continuous',
            borderWidth: 2,
            borderColor: status.kind === 'ok' ? c.accent : c.overlayStroke,
          }}
        />
      </View>
      <View style={{ paddingHorizontal: layout.gutter, paddingTop: space.md, paddingBottom: space.xl, gap: space.sm, backgroundColor: c.bg }}>
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: space.md }}>
          {/* Bit appears only for the cheer; the camera preview is the content until then. */}
          {status.kind === 'ok' ? <PixelSprite state="celebrating" size={48} fps={4} /> : null}
          <T
            role="body"
            weight={status.kind === 'idle' ? 400 : 600}
            tone={status.kind === 'error' ? 'del' : 'text'}
            style={{ flexShrink: 1 }}
            accessibilityLiveRegion="polite"
          >
            {status.text}
          </T>
        </View>
        <TypeInstead />
      </View>
    </View>
  );
}

/**
 * A one-card screen: the title, a sentence, and the way forward. Bit beside the title
 * only for the two moments that have one (the cheer, and the camera being off).
 */
function Notice({
  title,
  sprite,
  text,
  tone = 'dim',
  actions,
}: {
  title: string;
  /** 48pt Bit beside the title: `idle` when the camera is off, `celebrating` on success. */
  sprite?: SpriteState;
  text: string;
  tone?: 'dim' | 'del';
  actions?: ReactNode;
}) {
  const insets = useSafeAreaInsets();
  return (
    <View style={{ flex: 1, backgroundColor: c.bg, paddingHorizontal: layout.gutter, paddingTop: space.md, paddingBottom: insets.bottom }}>
      <Surface style={{ gap: space.md }}>
        <View style={{ gap: space.sm }}>
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: space.md }}>
            {sprite ? <PixelSprite state={sprite} size={48} fps={4} /> : null}
            <T role="headline" style={{ flex: 1 }} accessibilityRole="header">
              {title}
            </T>
          </View>
          <T role="meta" tone={tone}>
            {text}
          </T>
        </View>
        {actions ? <View style={{ gap: space.xs }}>{actions}</View> : null}
      </Surface>
    </View>
  );
}

/** The typed path, which the scan falls back to with nothing lost: Settings has the field. */
function TypeInstead({ label = 'Type it instead' }: { label?: string }) {
  const router = useRouter();
  return <Button kind="secondary" size="compact" label={label} onPress={() => router.navigate('/settings')} />;
}
