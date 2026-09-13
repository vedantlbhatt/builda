import { useFocusEffect, useNavigation, useRouter, type Href } from 'expo-router';
import React, { useCallback, useEffect, useRef, useState } from 'react';
import { TextInput } from 'react-native';
import { KeyboardController } from 'react-native-keyboard-controller';

import * as cache from '../../src/data/cache';
import { getLocalName, saveLocalName } from '../../src/nav/name';
import { sendPendingName } from '../../src/nav/onboarding';
import { CONTINUE, NAME } from '../../src/onboarding/copy';
import { isCovering, reveal } from '../../src/onboarding/dissolve';
import { currentDraft, setDraftName } from '../../src/onboarding/draft';
import { useFacts } from '../../src/onboarding/facts';
import { KEYBOARD_AFTER_CELLS_MS, pathFor } from '../../src/onboarding/flow';
import { APPLE_NAME_KEY } from '../../src/onboarding/keys';
import { NAME_MAX, nameUsable, prefillName, submitName } from '../../src/onboarding/names';
import { StepFrame } from '../../src/onboarding/StepFrame';
import { HEADLINE, HEADLINE_INPUT, HEADLINE_SCALE } from '../../src/onboarding/type';
import { colors } from '../../src/theme';
import { Button, snap, T, useReduceMotion } from '../../src/ui';

const c = colors('dark');

/** Room past the limit, so a pasted long name is visible as too long rather than cut silently. */
const TYPE_SLACK = 8;
/** Walking back to this step: the keyboard comes up once the pop has landed. */
const REFOCUS_MS = 350;

/**
 * Step 1: your name (DESIGN-DIRECTION 4). The field's text IS the headline: 34/800 on the
 * canvas, no border, no fill, an amber caret, left aligned on the 20pt gutter, under the label
 * "what should we call you". Continue rides the keyboard and is enabled at 1 to 24 characters.
 * Nothing is validated until the person submits; Return commits with a Light haptic.
 *
 * Uncontrolled: typing never re-renders the screen. The only renders while typing are the
 * button flipping between usable and not, and the message clearing after a refused submit.
 *
 * The name is prefilled from what they typed here before, the account's display name, or the
 * name Sign in with Apple handed over, with the caret at its end and the clear button beside
 * it: one tap on Continue keeps it, one tap on the clear button starts over. (Selecting it all
 * painted a brown block under the name and put grab handles over the label.)
 *
 * The step has no entrance of its own. From hello it is uncovered by the pixel cells: the wave
 * clears hello's Continue first, and this step's Continue is standing in exactly its place, so
 * the button holds still while hello breaks up around it; the keyboard starts up as the last
 * cells turn and the button rides it. On Continue, the keyboard goes down and the
 * creature step cross fades in around the name, which stays exactly where it is, while both
 * steps' Continue ride the keyboard down together.
 *
 * Stored on this phone (`profile.name.v1`) and sent as `display_name` in `PATCH /v1/users/me`
 * now if there is an account, or at the first sign in if not (`src/nav/name.ts`).
 */
export default function NameStep() {
  const router = useRouter();
  const navigation = useNavigation();
  const facts = useFacts();
  const reduced = useReduceMotion();
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
    setInitial(late);
    setFieldKey((k) => k + 1);
  }, [facts.serverName, initial]);

  // Arriving from hello: the picture of hello is still over the screen. Now that this step has
  // mounted under it, let the cells turn, and start the keyboard up on the same frame. Then
  // give this route the platform's push back for the pop to hello (it arrived with none).
  const arrivedUnderCover = useRef(isCovering());
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

  const onChangeText = useCallback((t: string) => {
    value.current = t;
    touched.current = true;
    const ok = nameUsable(t);
    setUsable((was) => (was === ok ? was : ok));
    setMessage((m) => (m === null ? m : null));
  }, []);

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
        // fade the two Continues are one shape in one place going down together: nothing
        // amber is ever blended with the canvas.
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

  return (
    <StepFrame
      step="name"
      keyboard
      scroll={false}
      actions={<Button label={CONTINUE} onPress={() => void commit(false)} disabled={!usable} />}
    >
      <T role="label" tone="dim">
        {NAME.label}
      </T>
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
          selectionColor={c.accent}
          cursorColor={c.accent}
          placeholder={NAME.placeholder}
          placeholderTextColor={c.textFaint}
          accessibilityLabel={NAME.label}
          maxFontSizeMultiplier={HEADLINE_SCALE}
          // One line box, the headline's: the name sits on exactly the baseline the next
          // step's caption is drawn on.
          style={[HEADLINE_INPUT, { color: c.text, paddingVertical: 0, paddingHorizontal: 0, minHeight: HEADLINE.lineHeight }]}
        />
      )}
      <T role="meta" tone={message ? 'del' : 'dim'} accessibilityLiveRegion="polite">
        {message ?? NAME.note}
      </T>
    </StepFrame>
  );
}
