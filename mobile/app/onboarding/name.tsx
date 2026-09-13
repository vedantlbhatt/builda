import { useRouter } from 'expo-router';
import React, { useCallback, useEffect, useRef, useState } from 'react';
import { Text, TextInput, View } from 'react-native';

import * as cache from '../../src/data/cache';
import { getLocalName, saveLocalName } from '../../src/nav/name';
import { OnboardingStepSkeleton } from '../../src/nav/OnboardingStep';
import { NAME_MAX, nameProblem } from '../../src/nav/rules';
import { nav, PrimaryButton } from '../../src/nav/Skeleton';

/**
 * Step 1: your name. Skeleton layout, real storage: the name is saved locally (signed out is
 * fine) and sent as `display_name` the first time there is an account (`src/nav/name.ts`).
 *
 * The field is uncontrolled: typing never re-renders the screen, and the button re-renders
 * only when the name crosses between usable and not. The design (DESIGN-DIRECTION 4, "Your
 * name") replaces this layout.
 */
export default function NameStep() {
  const router = useRouter();
  const value = useRef('');
  const [initial, setInitial] = useState<string | null | undefined>(undefined);
  const [usable, setUsable] = useState(false);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    void getLocalName(cache).then((n) => {
      value.current = n ?? '';
      setUsable(nameProblem(value.current) === null);
      setInitial(n);
    });
  }, []);

  const onChange = useCallback((t: string) => {
    value.current = t;
    const ok = nameProblem(t) === null;
    setUsable((was) => (was === ok ? was : ok));
  }, []);

  const commit = useCallback(async () => {
    if (saving || nameProblem(value.current) !== null) return;
    setSaving(true);
    try {
      await saveLocalName(value.current, cache);
      router.push('/onboarding/creature');
    } finally {
      setSaving(false);
    }
  }, [router, saving]);

  return (
    <OnboardingStepSkeleton
      step="name"
      title="Your name"
      note="Stored on this phone first. It reaches your account the first time you sign in."
      action={<PrimaryButton onPress={() => void commit()} disabled={!usable || saving} />}
    >
      <View style={{ gap: 8 }}>
        <Text style={{ color: nav.textDim, fontSize: 12, fontWeight: '600', letterSpacing: 0.2 }}>
          what should we call you
        </Text>
        {initial !== undefined && (
          <TextInput
            defaultValue={initial ?? ''}
            onChangeText={onChange}
            onSubmitEditing={() => void commit()}
            autoFocus
            autoCorrect={false}
            autoComplete="name"
            textContentType="nickname"
            returnKeyType="next"
            maxLength={NAME_MAX + 8}
            selectionColor={nav.accent}
            cursorColor={nav.accent}
            placeholder="Your name"
            placeholderTextColor={nav.textFaint}
            accessibilityLabel="Your name"
            style={{ color: nav.text, fontSize: 34, fontWeight: '800', paddingVertical: 8 }}
          />
        )}
      </View>
    </OnboardingStepSkeleton>
  );
}
