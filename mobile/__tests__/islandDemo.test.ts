import { describe, expect, test } from 'bun:test';

import { DEMO_EVERY_MS, DEMO_FOR_MS, demoStepFor } from '../src/island/model';
import { SHIPKIT_ENUMS } from '../src/generated/shipkit';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

describe('a demo you asked for, in the island', () => {
  test('every request status the server can send has a step, and an unknown one says nothing', () => {
    const statuses = (SHIPKIT_ENUMS as Record<string, readonly string[]>).RequestStatus ?? ['queued', 'claimed', 'done', 'failed', 'cancelled'];
    for (const s of statuses) expect(['clear', 'ready', 'failed', 'filming', 'waiting']).toContain(demoStepFor(s));
    expect(demoStepFor('queued')).toBe('waiting');
    expect(demoStepFor('claimed')).toBe('filming');
    expect(demoStepFor('done')).toBe('ready');
    expect(demoStepFor('failed')).toBe('failed');
    // Taken back, no row at all, or a status this build does not know: the island stops talking.
    expect(demoStepFor('cancelled')).toBe('clear');
    expect(demoStepFor(undefined)).toBe('clear');
    expect(demoStepFor('something_new')).toBe('clear');
  });

  test('it reads at the kit screen\'s own cadence and gives up well past a real run', () => {
    // Read as text: the hook's module pulls in the router, which bun cannot load.
    const kit = readFileSync(join(import.meta.dir, '../src/shipkit/useKit.ts'), 'utf8');
    const poll = Number(kit.match(/export const POLL_MS = ([\d_]+);/)![1]!.replace(/_/g, ''));
    expect(DEMO_EVERY_MS).toBe(poll);
    // The one phone request run end to end took about thirteen minutes.
    expect(DEMO_FOR_MS).toBeGreaterThanOrEqual(2 * 13 * 60_000);
  });
});
