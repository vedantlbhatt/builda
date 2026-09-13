/**
 * The last chapter: the card, and what can be done with it. The card is rendered at the width it
 * will be captured at, because what you see is literally the view that gets exported (share
 * cards take the 28 pt corner, `radius.lg`). Under it the acts are words with an arrow in the
 * builder's accent, the way Strava ends an activity on its share row (design-md/fitness/strava)
 * and the house style says every act and doorway is: never a capsule of chrome.
 *
 * Posting is an act, never automatic, and only for a finished session: a live card's numbers
 * keep moving, and a recap that moves is not a recap. Exporting the image and posting it are
 * different acts, and the export names the file it produces.
 */
import React, { type RefObject } from 'react';
import { StyleSheet, View } from 'react-native';

import { RecapCard, type CardModel } from '../card/RecapCard';
import { DATA, GROUND } from '../insights/palette';
import { GUTTER, Hairline, Kicker, type, Words } from '../insights/kit';
import { Block, Section } from '../insights/reveal';
import { radius } from '../theme';
import { Door } from './parts';

export type PostState =
  /** Not a session that can be posted (the sample, a running one). */
  | { kind: 'none' }
  | { kind: 'unposted' }
  /** The post exists and this mount holds it: its visibility, Edit and Delete. */
  | { kind: 'posted'; visibility: string }
  /** The post exists and this mount does not hold it (an older server, a failed lookup). */
  | { kind: 'shared'; looking: boolean };

export function ShareChapter({
  model,
  width,
  cardRef,
  accent,
  post,
  saving,
  onPost,
  onEdit,
  onDelete,
  onOpenFeed,
  onSave,
}: {
  model: CardModel;
  width: number;
  cardRef: RefObject<View | null>;
  accent: string;
  post: PostState;
  saving: boolean;
  onPost: () => void;
  onEdit: () => void;
  onDelete: () => void;
  onOpenFeed: () => void;
  onSave: () => void;
}) {
  const inner = width - GUTTER * 2;
  return (
    <Section style={styles.section}>
      <Block style={styles.block}>
        <Hairline style={styles.rule} />
        <Kicker>the card</Kicker>
        <View ref={cardRef} collapsable={false} style={styles.card}>
          <RecapCard model={model} width={inner} />
        </View>
        <View style={styles.acts}>
          {post.kind === 'unposted' ? (
            <Door title="Post to the feed" line="Photos, a caption, and who sees it." color={accent} onPress={onPost} hairline={false} accessibilityHint="Photos, a caption, and who sees it" />
          ) : null}
          {post.kind === 'posted' ? (
            <>
              <Words style={type.lead}>{`Posted, ${post.visibility}.`}</Words>
              <Door title="Edit the post" color={accent} onPress={onEdit} small />
              <Door title="Delete the post" color={DATA.del} onPress={onDelete} small />
            </>
          ) : null}
          {post.kind === 'shared' ? (
            <>
              <Words style={type.lead}>Posted to the feed.</Words>
              <Door title="Open the feed" color={accent} onPress={onOpenFeed} small busy={post.looking} />
            </>
          ) : null}
          <Door
            title={saving ? 'Preparing the image' : 'Save this card as an image'}
            color={GROUND.text}
            onPress={onSave}
            small
            busy={saving}
            hairline={post.kind !== 'none'}
          />
        </View>
      </Block>
    </Section>
  );
}

const styles = StyleSheet.create({
  section: { marginTop: 56 },
  block: { paddingHorizontal: GUTTER },
  rule: { marginBottom: 24 },
  card: { borderRadius: radius.lg, borderCurve: 'continuous', overflow: 'hidden', marginTop: 4 },
  acts: { marginTop: 16 },
});
