/**
 * The desktop's sign in: the phone approves this computer (`pairing.ts` has the flow).
 *
 * A desktop cannot Sign in with Apple the way the phone does (Apple issues that identity to the
 * phone's own bundle), and a password would be a second account system for one screen. The phone
 * is already signed in, so it vouches: this screen shows a code and a QR of it, the phone's camera
 * opens the pairing screen, one tap, and this window has its own token pair, which rotates and can
 * be revoked on its own like every other device.
 *
 * Shown by the desktop frame when the shell has no tokens. "Not now" leaves it for this launch:
 * everything that needs no account still works, and Settings keeps the way back.
 */
import React, { useCallback, useEffect, useRef, useState } from 'react';
import { Pressable, StyleSheet, View } from 'react-native';
import Svg, { Rect } from 'react-native-svg';

import { CreatureMark } from '../insights/Creature';
import { API_BASE_URL, api } from '../data/client';
import { nav } from '../nav/Skeleton';
import { space } from '../theme';
import { useAccent } from '../theme/accent';
import { SHAPE } from '../ui/shape';
import { T } from '../ui/Text';
import { desktopBridge } from './bridge';
import { deviceLabel, devicePlatform, pairLink, pollGrant, startGrant, type GrantStart } from './pairing';
import { dragRegion } from './Sidebar';

type Phase = { kind: 'starting' } | { kind: 'waiting'; grant: GrantStart; qr: boolean[][] | null } | { kind: 'done' } | { kind: 'error'; message: string };

const QR_SIZE = 184;

export function DesktopSignIn({ onSkip }: { onSkip: () => void }) {
  const accent = useAccent();
  const [phase, setPhase] = useState<Phase>({ kind: 'starting' });
  const [attempt, setAttempt] = useState(0);
  const live = useRef(true);

  useEffect(() => {
    live.current = true;
    let timer: ReturnType<typeof setTimeout> | null = null;
    const bridge = desktopBridge();
    (async () => {
      try {
        const machineId = (await bridge?.machineId()) ?? 'web';
        const os = bridge?.platform ?? 'web';
        const grant = await startGrant(API_BASE_URL, {
          machineId,
          label: deviceLabel(os, bridge?.hostName ?? null),
          platform: devicePlatform(os),
          version: bridge?.appVersion ?? 'web',
        });
        const qr = (await bridge?.qr(pairLink(grant.user_code)).catch(() => null)) ?? null;
        if (!live.current) return;
        setPhase({ kind: 'waiting', grant, qr });
        const every = Math.max(2, grant.interval) * 1000;
        const deadline = Date.now() + grant.expires_in * 1000;
        const poll = async () => {
          if (!live.current) return;
          const answer = await pollGrant(API_BASE_URL, grant.device_code);
          if (!live.current) return;
          if (answer.kind === 'ok') {
            await api.setTokens(answer.access, answer.refresh);
            setPhase({ kind: 'done' });
            // A fresh start reads the new pair everywhere (the gate, the caches, the island).
            setTimeout(() => window.location.reload(), 600);
            return;
          }
          if (answer.kind === 'expired' || Date.now() > deadline) {
            setAttempt((n) => n + 1);
            return;
          }
          if (answer.kind === 'error') {
            setPhase({ kind: 'error', message: answer.message });
            return;
          }
          timer = setTimeout(poll, every);
        };
        timer = setTimeout(poll, every);
      } catch (e) {
        if (live.current) setPhase({ kind: 'error', message: e instanceof Error ? e.message : String(e) });
      }
    })();
    return () => {
      live.current = false;
      if (timer) clearTimeout(timer);
    };
  }, [attempt]);

  const retry = useCallback(() => {
    setPhase({ kind: 'starting' });
    setAttempt((n) => n + 1);
  }, []);

  return (
    <View style={styles.fill}>
      <View style={styles.drag} {...dragRegion()} />
      <View style={styles.card}>
        <CreatureMark animal={accent.animal} size={48} color={accent.ink} />
        <T role="display" style={{ color: nav.text, marginTop: space.md }}>
          Sign in with your phone
        </T>
        {/* One title, the code, one line. The paragraph of steps and the label over the code were
            the big, small, grey pattern (2026-09-19, the owner); typing the code is in the phone's
            Settings for whoever needs it. */}

        <View style={styles.pair}>
          <View style={styles.qrBox}>
            {phase.kind === 'waiting' && phase.qr ? <Qr modules={phase.qr} size={QR_SIZE} /> : <View style={{ width: QR_SIZE, height: QR_SIZE }} />}
          </View>
          <View style={styles.codeCol}>
            <T role="hero" style={{ color: phase.kind === 'done' ? accent.text : nav.text }} selectable>
              {phase.kind === 'waiting' ? phase.grant.user_code : phase.kind === 'done' ? 'Signed in' : '····-····'}
            </T>
            <T role="meta" style={{ color: nav.textFaint }}>
              {phase.kind === 'starting'
                ? 'Asking for a code…'
                : phase.kind === 'waiting'
                  ? 'Scan it with your phone.'
                  : phase.kind === 'done'
                    ? 'Opening your sessions.'
                    : `That did not work: ${phase.message}.`}
            </T>
            {phase.kind === 'error' ? (
              <Pressable onPress={retry} accessibilityRole="button" style={styles.link}>
                <T role="headline" style={{ color: accent.text }}>
                  Try again
                </T>
              </Pressable>
            ) : null}
          </View>
        </View>

        <Pressable onPress={onSkip} accessibilityRole="button" style={styles.link}>
          <T role="row" style={{ color: nav.textDim }}>
            Not now
          </T>
        </Pressable>
      </View>
    </View>
  );
}

function Qr({ modules, size }: { modules: boolean[][]; size: number }) {
  const n = modules.length;
  const quiet = 2;
  const cells = n + quiet * 2;
  return (
    <Svg width={size} height={size} viewBox={`0 0 ${cells} ${cells}`} accessibilityLabel="Pairing code as a QR code">
      <Rect x={0} y={0} width={cells} height={cells} fill={nav.text} />
      {modules.flatMap((row, y) =>
        row.map((dark, x) => (dark ? <Rect key={`${x}.${y}`} x={x + quiet} y={y + quiet} width={1.02} height={1.02} fill={nav.bg} /> : null)),
      )}
    </Svg>
  );
}

const styles = StyleSheet.create({
  fill: { flex: 1, backgroundColor: nav.bg, alignItems: 'center', justifyContent: 'center', padding: space.xl },
  drag: { position: 'absolute', top: 0, left: 0, right: 0, height: 40 },
  card: { width: 640, maxWidth: '100%' },
  pair: { flexDirection: 'row', alignItems: 'center', gap: space.xl, marginTop: space.xl, marginBottom: space.lg },
  qrBox: { borderRadius: SHAPE.inner, borderCurve: 'continuous', overflow: 'hidden' },
  codeCol: { flex: 1, gap: space.sm },
  link: { alignSelf: 'flex-start', paddingVertical: space.sm },
});
