import React from 'react';

import type { SessionDetail } from '../data/api';
import { PixelSprite } from '../pixel/PixelSprite';
import { Row, Section, Surface, T } from '../ui';
import { livePresenceLine, liveStatusLine, spriteForLive, tempoForLive } from './format';

/**
 * The block at the top of Now, Sessions and You while the Mac is still working.
 *
 * A live row is a snapshot, not a session: it may carry a checkpoint analysis and its
 * numbers move every minute. It gets its own block rather than a place in the list so the
 * list stays a record of things that finished.
 *
 * One surface of rows, not a card per session: the rows highlight when pressed and push
 * the session. The status line is text, not amber: amber is for actions, progress and
 * "needs you", and a line that is always there would spend it on every row.
 */
export function LiveSessions({
  sessions,
  onPress,
}: {
  sessions: SessionDetail[];
  onPress: (id: string) => void;
}) {
  if (sessions.length === 0) return null;
  return (
    <Section label="Live now">
      <Surface padding={0}>
        {sessions.map((s, i) => (
          <Row
            key={s.id}
            title={s.repo_name ?? 'private repo'}
            monoTitle
            meta={s.title ?? undefined}
            // Bit hammers while someone is at the keyboard and sleeps once the agent has
            // been alone past tauAutonomousSec (the same rule as the presence line), and
            // works quicker the fresher the row's last record is.
            leading={<PixelSprite state={spriteForLive(s)} size={32} tempo={tempoForLive(s)} />}
            below={
              <>
                <T role="meta" weight={600}>
                  {liveStatusLine(s)}
                </T>
                <T role="meta" tone="dim">
                  {livePresenceLine(s)}
                </T>
              </>
            }
            chevron
            onPress={() => onPress(s.id)}
            hairline={i < sessions.length - 1}
          />
        ))}
      </Surface>
    </Section>
  );
}
