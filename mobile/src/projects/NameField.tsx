/**
 * Naming a project, inline, under its hero band. A private repository arrives as "Private project"
 * and the number this phone gave it, because its name never leaves the Mac; here the builder can call
 * it what they call it. The name is kept on this phone only (`nicknames.ts`), and the field says so
 * in the one line under it. A public repository has its real name and no field.
 *
 * The field is a line of the page's own type with a hairline under it, the caret in the builder's
 * hue (the Settings fields' rule), Save as the accent's capsule, and taking the name away as a word.
 */
import React, { useEffect, useRef, useState } from 'react';
import { Pressable, StyleSheet, Text, TextInput, View } from 'react-native';
import Animated, { FadeIn } from 'react-native-reanimated';

import { type, Words } from '../insights/kit';
import { GROUND } from '../insights/palette';
import { AccentButton } from '../nav/chrome';
import { useAccent } from '../theme/accent';
import { success } from '../ui';
import { NICKNAME_MAX, normalizeNickname } from './model';
import { saveNickname } from './nicknames';
import { HERE } from '../copy/device';

export function NameField({ projectKey, current, onDone }: { projectKey: string; current: string | null; onDone: () => void }) {
  const accent = useAccent();
  const [text, setText] = useState(current ?? '');
  const input = useRef<TextInput>(null);
  useEffect(() => {
    const t = setTimeout(() => input.current?.focus(), 250);
    return () => clearTimeout(t);
  }, []);
  const name = normalizeNickname(text);
  const save = async () => {
    await saveNickname(projectKey, name || null);
    success();
    onDone();
  };
  return (
    <Animated.View entering={FadeIn.duration(180)} style={styles.wrap}>
      <TextInput
        ref={input}
        value={text}
        onChangeText={setText}
        placeholder="What you call it"
        placeholderTextColor={GROUND.faint}
        maxLength={NICKNAME_MAX + 8}
        autoCapitalize="none"
        autoCorrect={false}
        returnKeyType="done"
        onSubmitEditing={() => void save()}
        selectionColor={accent.ink}
        cursorColor={accent.ink}
        accessibilityLabel={`The name for this project, kept on ${HERE}`}
        maxFontSizeMultiplier={1.4}
        style={[type.heading, styles.input]}
      />
      <Words style={type.meta}>{`Only ${HERE} knows it. Your Mac and the server keep the key, never a name.`}</Words>
      <View style={styles.actions}>
        <AccentButton label={name ? 'Save the name' : current ? 'Take the name away' : 'Save'} onPress={() => void save()} disabled={!name && !current} />
        {/* Leaving is not a way somewhere, so it is a word with no arrow. */}
        <Pressable onPress={onDone} accessibilityRole="button" hitSlop={10} style={({ pressed }) => ({ opacity: pressed ? 0.55 : 1 })}>
          <Text maxFontSizeMultiplier={1.4} style={[type.lead, { color: GROUND.dim }]}>
            Cancel
          </Text>
        </Pressable>
      </View>
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  wrap: { gap: 10 },
  input: { paddingVertical: 8, borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: GROUND.border },
  actions: { flexDirection: 'row', alignItems: 'center', gap: 20, marginTop: 4 },
});
