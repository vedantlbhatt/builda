/**
 * The Live Activity's shape is declared in four places that nothing but these tests connects:
 * the Swift struct the widget extension compiles, its byte-identical copy in the Expo module's
 * pod, the module's `Record`s that carry JS objects across the bridge, and the TypeScript types
 * the app builds states with. ActivityKit pairs the app's and the extension's copies by NAME and
 * Codable SHAPE only, and an Expo Record silently drops a key it does not declare, so a field
 * added in one place and not the others is not an error anywhere. It is a Lock Screen that
 * quietly shows a default. (Kit: research/live-activities-assets, "2 pass"; grown here.)
 */

import { describe, expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import type { CreatureId, Phase as BridgePhase, Trajectory as BridgeTrajectory } from '../modules/builder-live/src/BuilderLive.types';
import { LIVE_ENUMS, type Creature, type Phase, type Trajectory } from '../src/generated/live';

const ROOT = join(import.meta.dir, '..');
const read = (p: string) => readFileSync(join(ROOT, p), 'utf8');

const EXT = 'targets/widget/_shared/BuilderSessionAttributes.swift';
const POD = 'modules/builder-live/ios/BuilderSessionAttributes.swift';
const MODULE = 'modules/builder-live/ios/BuilderLiveModule.swift';
const TS = 'modules/builder-live/src/BuilderLive.types.ts';

/** `name -> swift type` for the `public var` lines between two markers. */
function swiftVars(src: string, from: string, to: string): Map<string, string> {
  const start = src.indexOf(from);
  const block = src.slice(start, src.indexOf(to, start + from.length));
  return new Map([...block.matchAll(/public var (\w+): ([\w?]+)/g)].map((m) => [m[1]!, m[2]!]));
}

/** `name -> swift type` for a Record's `@Field var` lines. */
function recordFields(src: string, record: string): Map<string, string> {
  const start = src.indexOf(`struct ${record}: Record`);
  const block = src.slice(start, src.indexOf('\n}', start));
  return new Map([...block.matchAll(/@Field var (\w+): ([\w?]+)/g)].map((m) => [m[1]!, m[2]!]));
}

/** `name -> ts type` for one `export type X = { ... };` block. */
function tsFields(src: string, type: string): Map<string, string> {
  const start = src.indexOf(`export type ${type} = {`);
  const block = src.slice(start, src.indexOf('};', start));
  return new Map([...block.matchAll(/^\s+(\w+)(\??): ([^;]+);/gm)].map((m) => [m[1]!, `${m[3]!.trim()}${m[2] ? ' | undefined' : ''}`]));
}

const ext = read(EXT);
const contentState = swiftVars(ext, 'struct ContentState', 'public init(');
const attributes = swiftVars(ext.slice(ext.indexOf('public var sessionId')), 'public var sessionId', 'public init(');

describe('BuilderSessionAttributes', () => {
  test('the pod and the extension declare the same ActivityAttributes, byte for byte', () => {
    expect(read(POD)).toBe(ext);
  });

  test('ContentState has the kit fields and the layout fields, nothing else', () => {
    expect([...contentState.keys()].sort()).toEqual(
      [
        'phase', 'sentence', 'progress', 'filesChanged', 'etaEpoch', 'sinceEpoch', 'endedEpoch', 'trajectory',
        'creature', 'linesAdded', 'linesRemoved', 'commits', 'runningCount', 'updatedEpoch',
      ].sort()
    );
  });

  test('no duration is baked into the state: the moments are dates, so a surface can draw clocks and timers', () => {
    for (const name of ['sinceEpoch', 'endedEpoch', 'etaEpoch']) expect(contentState.get(name)).toBe('Double?');
    expect(attributes.get('startedEpoch')).toBe('Double');
  });

  test('the JS SessionState keys are exactly the Swift ContentState fields', () => {
    const ts = tsFields(read(TS), 'SessionState');
    expect([...ts.keys()].sort()).toEqual([...contentState.keys()].sort());
  });

  test('the JS SessionAttrs keys are exactly the Swift attributes', () => {
    const ts = tsFields(read(TS), 'SessionAttrs');
    expect([...ts.keys()].sort()).toEqual([...attributes.keys()].sort());
  });

  test('an optional in Swift is nullable in TypeScript, and a number is a number', () => {
    const ts = tsFields(read(TS), 'SessionState');
    for (const [name, swift] of contentState) {
      const t = ts.get(name)!;
      if (swift.endsWith('?')) expect(t).toContain('| null');
      else expect(t).not.toContain('null');
      if (/^(Int|Double)\??$/.test(swift)) expect(t.replace(' | null', '')).toBe('number');
      if (swift === 'String') expect(t).not.toBe('number');
    }
  });
});

describe('the Expo module bridge', () => {
  const mod = read(MODULE);

  test('SessionStateRecord carries every ContentState field with the same type', () => {
    const rec = recordFields(mod, 'SessionStateRecord');
    expect([...rec.keys()].sort()).toEqual([...contentState.keys()].sort());
    for (const [name, swift] of contentState) expect(rec.get(name)).toBe(swift);
  });

  test('SessionAttrsRecord carries every attribute with the same type', () => {
    const rec = recordFields(mod, 'SessionAttrsRecord');
    expect([...rec.keys()].sort()).toEqual([...attributes.keys()].sort());
    for (const [name, swift] of attributes) expect(rec.get(name)).toBe(swift);
  });

  test('content() hands every field from the record to the state', () => {
    const body = mod.slice(mod.indexOf('private static func content('));
    for (const name of contentState.keys()) expect(body).toContain(`${name}: s.${name}`);
  });

  test('start does not reuse an activity that has already ended', () => {
    expect(mod).toContain('Self.isLive($0.activityState)');
  });

  test('the debug renderer is found by the Objective-C name the app side declares', () => {
    const renderer = read('targets/widget/_shared/LivePreviewRenderer.swift');
    expect(renderer).toContain('@objc(BuilderPreviewRenderer)');
    expect(renderer).toContain('func renderAll(into dir: String)');
    expect(mod).toContain('NSClassFromString("BuilderPreviewRenderer")');
    expect(mod).toContain('NSSelectorFromString("renderAllInto:")');
  });
});

/** `export type X = 'a' | 'b';` as its members, in order. */
function tsUnion(src: string, type: string): string[] {
  const m = new RegExp(`export type ${type} = ([^;]+);`).exec(src);
  return m ? [...m[1]!.matchAll(/'([^']+)'/g)].map((x) => x[1]!) : [];
}

/**
 * Compile time, both ways: the spec's enums (spec/live.v1.json, which the server's pushes are
 * validated against) and the bridge's types the app builds a card from are one set each. A
 * value on one side only stops `bunx tsc --noEmit`.
 */
const phaseBoth = (p: Phase): BridgePhase => p;
const phaseBack = (p: BridgePhase): Phase => p;
const trajectoryBoth = (t: Trajectory): BridgeTrajectory => t;
const trajectoryBack = (t: BridgeTrajectory): Trajectory => t;
const creatureBoth = (c: Creature): CreatureId => c;
const creatureBack = (c: CreatureId): Creature => c;

describe('the live spec and the bridge (docs/overnight-integration.md section 7)', () => {
  const bridge = read(TS);

  test('the generated Phase, Trajectory and Creature are the bridge types, value for value and in order', () => {
    expect(tsUnion(bridge, 'Phase')).toEqual([...LIVE_ENUMS.phase]);
    expect(tsUnion(bridge, 'Trajectory')).toEqual([...LIVE_ENUMS.trajectory]);
    expect(tsUnion(bridge, 'CreatureId')).toEqual([...LIVE_ENUMS.creature]);
    for (const f of [phaseBoth, phaseBack, trajectoryBoth, trajectoryBack, creatureBoth, creatureBack]) expect(typeof f).toBe('function');
  });

  test('the Swift ContentState phase and trajectory strings are the same values', () => {
    const display = read('targets/widget/_shared/LiveDisplay.swift');
    const phases = /enum Phase: String \{\s*case ([^\n]+)/.exec(display)![1]!.split(',').map((x) => x.trim());
    expect(phases).toEqual([...LIVE_ENUMS.phase]);
  });
});

