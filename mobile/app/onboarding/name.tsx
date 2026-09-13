import { useFocusEffect, useNavigation, useRouter, type Href } from 'expo-router';
import React, { useCallback, useEffect, useRef, useState } from 'react';
import { TextInput, useWindowDimensions, View } from 'react-native';
import { KeyboardController } from 'react-native-keyboard-controller';

import * as cache from '../../src/data/cache';
import { fitSize } from '../../src/insights/format';
import { Refusal } from '../../src/insights/kit';
import { ON_HUE } from '../../src/insights/palette';
import { getLocalName, saveLocalName } from '../../src/nav/name';
import { sendPendingName } from '../../src/nav/onboarding';
import { CONTINUE, NAME } from '../../src/onboarding/copy';
import { isCovering, reveal } from '../../src/onboarding/dissolve';
import { currentDraft, setDraftName } from '../../src/onboarding/draft';
import { useFacts } from '../../src/onboarding/facts';
import { GUTTER, KEYBOARD_AFTER_CELLS_MS, NAME_SIZES, nameSize, pathFor } from '../../src/onboarding/flow';
import { HueButton } from '../../src/onboarding/HueButton';
import { APPLE_NAME_KEY } from '../../src/onboarding/keys';
import { NAME_MAX, nameUsable, prefillName, submitName } from '../../src/onboarding/names';
import { StepBand } from '../../src/onboarding/StepBand';
import { StepFrame, useBandInset } from '../../src/onboarding/StepFrame';
import { displayInput, HEADLINE_SCALE } from '../../src/onboarding/type';
import { useAccent } from '../../src/theme/accent';
import { BlurText } from '../../src/ui/bits/text/BlurText';
import { snap, T, useReduceMotion } from '../../src/ui';

/** Room past the limit, so a pasted long name is visible as too long rather than cut silently. */
const TYPE_SLACK = 8;
/** Walking back to this step: the keyboard comes up once the pop has landed. */
const REFOCUS_MS = 350;
/** The name's box is the largest step's line, so the band never changes height as it shrinks. */
const NAME_BOX = Math.round(NAME_SIZES[0] * 1.12);
/** The label comes into focus as the cover clears off it. */
const LABEL_AT_MS = 160;

/**
 * Step 1: your name. The band in the builder's colour runs from the top of the screen, the
 * label "what should we call you" comes into focus on it word by word (react-bits BlurText, the
 * kit's port), and the name you type IS the step's headline: set huge in the band's dark ink,
 * left aligned on the 20pt gutter, no border and no fill, a dark caret.
 *
 * Cash App's Pay screen is the pattern (design-md/finance/cash-app: the one value takes the upper
 * 40% of the screen at 96pt and "auto-shrinks down to 72pt then 60pt" to stay on one line): the
 * name opens at 96pt and steps down as it grows (`NAME_SIZES`), in a box the size of the largest
 * step, so nothing under it moves. Continue rides the keyboard, in the builder's colour, and is
 * enabled at 1 to 24 characters. Nothing is validated until the person submits; Return commits
 * with a Light haptic, and a refusal is a sentence on the band.
 *
 * Uncontrolled: typing re-renders the screen only when the name crosses a size step, the button
 * flips between usable and not, or the message clears after a refused submit.
 *
 * The name is prefilled from what they typed here before, the account's display name, or the
 * name Sign in with Apple handed over, with the caret at its end and the clear button beside it.
 *
 * From hello it is uncovered by the pixel cells: the wave clears hello's Continue first, and this
 * step's Continue is standing exactly in its place; the band holds still under the cells (they
 * were the print), and the keyboard starts up as the last cells turn. On Continue, the keyboard
 * goes down and the creature step cross fades in around the name, which stays where it is.
 *
 * Stored on this phone (`profile.name.v1`) and sent as `display_name` in `PATCH /v1/users/me`
 * now if there is an account, or at the first sign in if not (`src/nav/name.ts`).
 */
export default function NameStep() {
  const router = useRouter();
  const navigation = useNavigation();
  const facts = useFacts();
  const reduced = useReduceMotion();
  const accent = useAccent();
  const inset = useBandInset();
  const { width } = useWindowDimensions();
  const inner = width - 2 * GUTTER;
  const input = useRef<TextInput>(null);
  const touched = useRef(false);
  const leaving = useRef(false);

  // What to open with. The draft was read while Bit said hello, so it is usually here on the
  // first frame (the field must exist for the keyboard to rise with the cells); a deep link
  // straight here reads the kv.
  const draft = currentDraft();
  const firstValue = draft.primed ? prefillName({ local: draft.name, server: facts.serverName, apple: draft.apple }) : null;
  const value = useRef(firstValue ?? '');
  const sources = useRef<{ local: string | null; apple: string | null } | null>(draft.primed ? { local: draft.name, apple: draft.apple } : null);
  const [initial, setInitial] = useState<string | null>(firstValue);
  const [fieldKey, setFieldKey] = useState(0);
  const [usable, setUsable] = useState(nameUsable(firstValue ?? ''));
  const [message, setMessage] = useState<string | null>(null);
  const [size, setSize] = useState(() => nameSize(firstValue ?? '', inner, fitSize));

  useEffect(() => {
    if (initial !== null) return;
    let live = true;
    void (async () => {
      const [l, apple] = await Promise.all([getLocalName(cache), cache.getKv(APPLE_NAME_KEY).catch(() => null)]);
      if (!live) return;
      sources.current = { local: l, apple };
      const first = prefillName({ local: l, server: facts.serverName, apple });
      value.current = first;
      setUsable(nameUsable(first));
      setSize(nameSize(first, inner, fitSize));
      setInitial(first);
    })();
    return () => {
      live = false;
    };
    // Read once; a late account name is handled below.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // The account's display name arrived after the field opened empty and untouched: offer it.
  useEffect(() => {
    if (initial === null || touched.current || value.current !== '' || !sources.current) return;
    const late = prefillName({ ...sources.current, server: facts.serverName });
    if (!late) return;
    value.current = late;
    setUsable(nameUsable(late));
    setSize(nameSize(late, inner, fitSize));
    setInitial(late);
    setFieldKey((k) => k + 1);
  }, [facts.serverName, initial, inner]);

  // Arriving from hello: the colour is still over the screen. Now that this step has mounted
  // under it, let the cells clear, and start the keyboard up with them. Then give this route the
  // platform's push back for the pop to hello (it arrived with none).
  const arrivedUnderCover = useRef(isCovering());
  // Decided once, at mount: the band holds still under the cells (they were its print). Read
  // from the ref at render it would flip mid print, when the keyboard's focus clears the ref.
  const [printBand] = useState(() => !isCovering());
  useEffect(() => {
    const frame = requestAnimationFrame(() => reveal());
    const t = setTimeout(() => navigation.setOptions({ animation: 'default' }), 700);
    return () => {
      cancelAnimationFrame(frame);
      clearTimeout(t);
    };
  }, [navigation]);

  // The keyboard: as the last cells turn when arriving under them, after the pop has landed
  // whenever the person walks back to this step.
  useFocusEffect(
    useCallback(() => {
      if (initial === null) return;
      const wait = arrivedUnderCover.current ? (reduced ? 0 : KEYBOARD_AFTER_CELLS_MS) : REFOCUS_MS;
      arrivedUnderCover.current = false;
      const t = setTimeout(() => input.current?.focus(), wait);
      return () => clearTimeout(t);
    }, [initial, fieldKey, reduced]),
  );

  const onChangeText = useCallback(
    (t: string) => {
      value.current = t;
      touched.current = true;
      const ok = nameUsable(t);
      setUsable((was) => (was === ok ? was : ok));
      const s = nameSize(t, inner, fitSize);
      setSize((was) => (was === s ? was : s));
      setMessage((m) => (m === null ? m : null));
    },
    [inner],
  );

  const commit = useCallback(
    async (fromReturn: boolean) => {
      if (leaving.current) return;
      const verdict = submitName(value.current);
      if (!verdict.ok) {
        setMessage(verdict.message);
        return;
      }
      // Return snaps the name home: Light, on the same frame as the keypress.
      if (fromReturn) snap();
      leaving.current = true;
      setDraftName(verdict.name);
      try {
        // The keyboard starts down and the push starts at once. The creature step's Continue
        // rides the same keyboard (its frame is a keyboard frame too), so for the whole cross
        // fade the two Continues are one shape in one place going down together.
        void KeyboardController.dismiss();
        await saveLocalName(verdict.name, cache);
        void sendPendingName();
        router.push({ pathname: pathFor('creature'), params: { via: 'name' } } as Href);
      } finally {
        setTimeout(() => {
          leaving.current = false;
        }, 500);
      }
    },
    [router],
  );

  const band = (
    <StepBand hue={accent} inset={inset} print={printBand}>
      <BlurText text={NAME.label} role="headline" weight={700} color={ON_HUE} delay={LABEL_AT_MS} />
      <View style={{ height: NAME_BOX, justifyContent: 'center' }}>
        {initial !== null && (
          <TextInput
            key={fieldKey}
            ref={input}
            defaultValue={initial}
            onChangeText={onChangeText}
            onSubmitEditing={() => void commit(true)}
            submitBehavior="submit"
            clearButtonMode="while-editing"
            autoCorrect={false}
            autoCapitalize="words"
            autoComplete="name"
            textContentType="nickname"
            returnKeyType="next"
            enablesReturnKeyAutomatically
            keyboardAppearance="dark"
            maxLength={NAME_MAX + TYPE_SLACK}
            selectionColor={ON_HUE}
            cursorColor={ON_HUE}
            placeholder={NAME.placeholder}
            placeholderTextColor={accent.partner}
            accessibilityLabel={NAME.label}
            maxFontSizeMultiplier={HEADLINE_SCALE}
            style={[displayInput(size), { color: ON_HUE, paddingVertical: 0, paddingHorizontal: 0, height: NAME_BOX }]}
          />
        )}
      </View>
      <View style={{ minHeight: 36 }} accessibilityLiveRegion="polite">
        {message ? (
          <Refusal onHue>{message}</Refusal>
        ) : (
          <T role="meta" weight={500} style={{ color: ON_HUE }}>
            {NAME.note}
          </T>
        )}
      </View>
    </StepBand>
  );

  return (
    <StepFrame
      step="name"
      keyboard
      scroll={false}
      band={band}
      actions={<HueButton label={CONTINUE} hue={accent} onPress={() => void commit(false)} disabled={!usable} />}
    />
  );
}
