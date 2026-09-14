/**
 * The share card's headline: the most remarkable TRUE fact (`src/card/model.ts`).
 */
import { describe, expect, test } from 'bun:test';

import { headline, type CardModel } from '../src/card/model';

function card(over: Partial<CardModel> = {}): CardModel {
  return {
    repoName: null, repoLabel: 'Private project 1', startedAt: 1_757_750_400, activeSeconds: 1800, wallSeconds: 2400,
    title: null, choreTitle: false, prompts: 6, filesTouched: 9, agentLines: 507, commits: 2,
    tokensReported: true, totalTokens: 1_000_000, modelName: 'Opus 5', agentLineBucket: 'nine_in_ten',
    attribConfidence: 'high', isPersonalRecord: false, strip: '', marks: [], harness: 'claude_code', ...over,
  };
}

describe('the card headline', () => {
  test('an agent share is a lower bound, named with the model', () => {
    expect(headline(card())).toBe('9 of every 10 lines came from Opus 5, at least');
  });

  test('"mostly you" is never the headline: under half of git says nothing about who wrote the rest', () => {
    // FOUND IN THE now3 PASS (2026-09-14): "Most of these lines are yours" beside +507 lines the
    // page counted as the agent's, with the person's edits at 0%.
    const h = headline(card({ agentLineBucket: 'mostly_you' }));
    expect(h).not.toContain('yours');
    expect(h).toBe(headline(card({ agentLineBucket: 'unknown' })));
  });
});
