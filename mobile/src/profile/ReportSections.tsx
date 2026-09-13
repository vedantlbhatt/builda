import React from 'react';
import { View } from 'react-native';

import type { BuilderReport } from '../generated/report';
import { layout, space } from '../theme';
import { Row, Section, StatGrid, Surface, T } from '../ui';
import { ShareBars } from './ShareBars';
import {
  assistedShare,
  coverageHint,
  coverageLine,
  fanoutLine,
  fanoutWaste,
  greenLine,
  shortDuration,
  streakLine,
  trendValues,
  trendVerdict,
  trendWords,
} from './report';

/**
 * The measured half of the profile: six blocks, each of which is silent when the
 * machine refused it.
 *
 * WHY THESE AND NOT A DASHBOARD. Every existing tool that reads these logs is an ops
 * dashboard (tokens, cost, calls per hour) and none of them tell a person anything they
 * can act on. Each section here answers a question somebody would actually ask about
 * themselves: am I getting better, what did fanning out buy me, how much of this did I
 * write, and how long do I stay broken.
 *
 * SILENCE IS A FEATURE. Nothing here renders a zero for a refusal. A block that is null
 * does not appear, and a rate that is null shows the reason the module gave: "5 test
 * runs, 5 needed" tells a person what would make the number appear, and an empty chart
 * tells them the product is broken.
 *
 * Each block is a kit `Section`: the label above, one surface under it, the footnote under
 * that. The screen's container sets the 32pt between blocks.
 */
export function ReportSections({ report }: { report: BuilderReport }) {
  return (
    <>
      <Coverage report={report} />
      <Trends report={report} />
      <Languages report={report} />
      <Agents report={report} />
      <Commits report={report} />
      <Habits report={report} />
    </>
  );
}

/**
 * What everything below rests on. FIRST, not in a footnote: a caveat under the numbers is
 * a caveat nobody reads, and the whole point is that it changes how the numbers are read.
 */
function Coverage({ report }: { report: BuilderReport }) {
  const c0 = report.coverage;
  if (!c0) return null;
  const line = coverageLine(c0);
  if (!line) return null;
  const hint = coverageHint(c0);
  return (
    <Surface style={{ gap: space.xs }}>
      <T role="row">{line}</T>
      {hint && (
        <T role="meta" tone="dim">
          {hint}
        </T>
      )}
      <T role="meta" tone="dim" style={{ marginTop: space.xs }}>
        {c0.sessions} {c0.sessions === 1 ? 'sitting' : 'sittings'} across {c0.active_days}{' '}
        {c0.active_days === 1 ? 'day' : 'days'} you built.
      </T>
    </Surface>
  );
}

function Trends({ report }: { report: BuilderReport }) {
  if (!report.trends.length) return null;
  return (
    <Section label={`You against you, ${windowWords(report.window_days)}`}>
      {/* The headline first: one sentence is what a person takes away, and the rows under
          it are the receipts. */}
      {report.trend_headline && <T role="body">{report.trend_headline}</T>}
      <Surface padding={0}>
        {report.trends.map((t, i) => {
          const verdict = trendVerdict(t);
          return (
            <Row
              key={t.metric}
              title={t.label}
              titleLines={2}
              meta={trendValues(t)}
              hairline={i < report.trends.length - 1}
              trailing={
                // Dim when the metric has no direction. Painting every move green or red
                // would attach a verdict the measurement does not carry: more hours is not
                // better and a night owl is not broken.
                //
                // AND NOTHING IS RED. `danger` is for destructive actions. A person who
                // tested less this month has not broken anything, and a red row for it
                // reads as a scold from an app that measured them without being asked to
                // judge them. A move the wrong way is full-strength text; a move the right
                // way is the accent, at 13pt semibold, the smallest amber text may be.
                // That is the same line `trends.headline` draws, where "which is the way
                // you want it" is appended and nothing is appended for the other direction.
                <T role="meta" weight={600} tone={verdict === 'good' ? 'accent' : verdict === 'bad' ? 'text' : 'dim'}>
                  {trendWords(t)}
                </T>
              }
            />
          );
        })}
      </Surface>
      <Footnote>
        Two windows of the same length, back to back. A move under 15% is called steady,
        because everything here wobbles by a tenth without anything changing about you.
      </Footnote>
    </Section>
  );
}

function Languages({ report }: { report: BuilderReport }) {
  const l = report.languages;
  if (!l) return null;
  return (
    <Section label="What you build in">
      <Surface>
        {l.languages ? (
          <ShareBars
            items={l.languages.map((x) => ({
              label: x.name,
              share: x.share,
              detail: `${x.lines.toLocaleString()} lines`,
            }))}
          />
        ) : (
          <Reason text={l.reason ?? 'Not enough written yet to split.'} />
        )}
      </Surface>
      {l.languages ? (
        <Footnote>
          Lines the agent added, not files and not time: a file count would weigh a
          one-line config change against a 400-line module.
          {l.generated_lines_excluded > 0
            ? ` ${l.generated_lines_excluded.toLocaleString()} lines nobody wrote, lockfiles and generated code, are left out.`
            : ''}
        </Footnote>
      ) : null}
    </Section>
  );
}

function Agents({ report }: { report: BuilderReport }) {
  const a = report.agents;
  if (!a) return null;
  const waste = fanoutWaste(a);
  return (
    <Section label="Agents you ran">
      <Surface style={{ gap: space.md }}>
        <T role="body">{fanoutLine(a)}</T>
        <StatGrid
          items={[
            { value: `${a.parallelism.toFixed(1)}x`, label: 'on average' },
            { value: String(a.max_concurrent), label: 'peak' },
            { value: shortDuration(a.agent_seconds), label: 'agent time' },
          ]}
        />
        {a.by_type.length > 1 && (
          <ShareBars
            items={a.by_type.map((t) => ({
              label: t.name,
              share: t.agents / a.agents,
              detail: `${t.agents}`,
            }))}
          />
        )}
        {waste && (
          <T role="meta" tone="dim">
            {waste}
          </T>
        )}
      </Surface>
      <Footnote>
        Read from the subagent transcripts, which no other tool on your machine looks at.
        Their tokens, lines and commits are already inside the totals above and are never
        counted twice here.
      </Footnote>
    </Section>
  );
}

function Commits({ report }: { report: BuilderReport }) {
  const co = report.contributions;
  if (!co) return null;
  const share = assistedShare(co);
  const streak = streakLine(co);
  return (
    <Section label="What you shipped">
      <Surface style={{ gap: space.md }}>
        {/* Three equal columns, not a wrapping row: a third stat wrapped onto its own line
            under a full row of space reads as a bug rather than as a wrap. */}
        <StatGrid
          items={[
            { value: co.assisted.toLocaleString(), label: 'with an agent' },
            { value: co.alone.toLocaleString(), label: 'on your own' },
            { value: String(co.active_days), label: 'shipping days' },
          ]}
        />
        {share !== null && (
          <ShareBars
            items={[
              { label: 'agent assisted', share },
              { label: 'you alone', share: 1 - share },
            ]}
          />
        )}
        {streak && <T role="row">{streak}</T>}
      </Surface>
      <Footnote>
        A commit counts as assisted only while a session was actually running. Anything
        outside every session is yours, including work this machine never saw, so the
        split leans toward you rather than toward the agent.
      </Footnote>
    </Section>
  );
}

function Habits({ report }: { report: BuilderReport }) {
  const q = report.quality;
  const p = report.prompting;
  if (!q && !p) return null;
  const green = q ? greenLine(q) : null;
  const firstTry = q && q.first_try_rate !== null && q.first_try_rate !== undefined ? q : null;
  const clean = p && p.clean_share !== null && p.clean_share !== undefined ? p : null;
  // The value leads each row and the question sits under it, so a long question wraps
  // under the number instead of truncating beside it.
  const rows: { key: string; value: string; label: string }[] = [];
  if (firstTry) {
    rows.push({
      key: 'first',
      value: `${Math.round((firstTry.first_try_rate ?? 0) * 100)}% of ${firstTry.runs}`,
      label: 'test runs that were already green',
    });
  }
  if (green) rows.push({ key: 'green', value: green, label: 'back to green' });
  if (clean) {
    rows.push({
      key: 'clean',
      value: `${Math.round((clean.clean_share ?? 0) * 100)}% of ${clean.attempts}`,
      label: 'prompts that landed clean',
    });
  }
  const reasons = [
    q && q.reason ? `Time to green: ${q.reason}.` : null,
    p && p.reason ? `Clean prompts: ${p.reason}.` : null,
  ].filter((r): r is string => r !== null);

  return (
    <Section label="How you work">
      {(rows.length > 0 || reasons.length > 0) && (
      <Surface padding={0}>
        {rows.map((r, i) => (
          <Row key={r.key} title={r.value} meta={r.label} hairline={i < rows.length - 1 || reasons.length > 0} />
        ))}
        {/* The refusals, verbatim. "5 test runs, 5 needed" tells somebody what would make
            the number appear; a blank row tells them the app is broken. */}
        {reasons.length > 0 && (
          <View style={{ paddingHorizontal: layout.gutter, paddingVertical: space.tile, gap: space.xs }}>
            {reasons.map((r) => (
              <Reason key={r} text={r} />
            ))}
          </View>
        )}
      </Surface>
      )}
      <Footnote>
        A prompt landed clean if it produced something and you did not have to take the
        wheel back. Not one word of any prompt leaves your machine.
      </Footnote>
    </Section>
  );
}

/** "this month", "this week", or the number of days. The trend rows are always two equal
    windows, so the header has to follow the window it was actually given. */
function windowWords(days: number): string {
  if (days === 7) return 'week on week';
  if (days >= 28 && days <= 31) return 'month on month';
  return `${days} days on ${days}`;
}

/** The sentence under a block that says how its numbers were made. */
function Footnote({ children }: { children: React.ReactNode }) {
  return (
    <T role="meta" tone="dim">
      {children}
    </T>
  );
}

function Reason({ text }: { text: string }) {
  return (
    <T role="meta" tone="dim">
      {text}
    </T>
  );
}
