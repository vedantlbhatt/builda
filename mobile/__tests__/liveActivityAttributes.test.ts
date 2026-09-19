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
import { lstatSync, readFileSync, realpathSync } from 'node:fs';
import { join } from 'node:path';

import type { CreatureId, Phase as BridgePhase, Trajectory as BridgeTrajectory } from '../modules/builder-live/src/BuilderLive.types';
import { STATUS_LINE } from '../src/drops/copy';
import { LIVE_ENUMS, type Creature, type Phase, type Trajectory } from '../src/generated/live';
import { dropSteps } from '../src/island/model';

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


// ------------------------------------------------------------------ a reel you shared

/**
 * `BuilderDropAttributes` (docs/drop-island.md) is declared in five places nothing else connects:
 * the Swift struct the widget extension compiles, its byte-identical copy in the pod, the pod's
 * Records, the TypeScript the phone builds a card with, and the server's push
 * (`drop_push.CONTENT_STATE_KEYS`). A push-to-start also names the type by string. Same failure
 * as a session's card: a field added in one place is a Lock Screen that quietly shows a default.
 */
const DROP_EXT = 'targets/widget/_shared/BuilderDropAttributes.swift';
const DROP_POD = 'modules/builder-live/ios/BuilderDropAttributes.swift';
const DROP_BRIDGE = 'modules/builder-live/ios/BuilderDropLive.swift';
const DROP_VIEWS = 'targets/widget/_shared/DropActivityViews.swift';
const DROP_PUSH = '../server/builder/drop_push.py';

const dropExt = read(DROP_EXT);
const dropState = swiftVars(dropExt, 'struct ContentState', 'public init(');
const dropAttrs = swiftVars(dropExt.slice(dropExt.indexOf('public var dropId')), 'public var dropId', 'public init(');

/** A Python tuple of strings, `NAME = (...)`, as its members in order. */
function pyTuple(src: string, name: string): string[] {
  const m = new RegExp(`^${name} = \\(([^)]*)\\)`, 'm').exec(src);
  return m ? [...m[1]!.matchAll(/"([^"]+)"/g)].map((x) => x[1]!) : [];
}

describe('BuilderDropAttributes', () => {
  test('the pod and the extension declare the same ActivityAttributes, byte for byte', () => {
    expect(read(DROP_POD)).toBe(dropExt);
  });

  test('ContentState is the card the task names, nothing else, and the attributes are fixed', () => {
    expect([...dropState.keys()]).toEqual(['phase', 'title', 'moves', 'firstMoveTitle', 'firstMoveId', 'kind', 'updatedEpoch']);
    expect([...dropAttrs.keys()]).toEqual(['dropId', 'host', 'platform']);
    for (const name of ['title', 'firstMoveTitle', 'firstMoveId', 'kind']) expect(dropState.get(name)).toBe('String?');
    expect(dropState.get('moves')).toBe('Int');
    expect(dropState.get('updatedEpoch')).toBe('Double');
  });

  test('the JS DropState and DropAttrs keys are exactly the Swift fields, optionals nullable', () => {
    const state = tsFields(read(TS), 'DropState');
    expect([...state.keys()].sort()).toEqual([...dropState.keys()].sort());
    for (const [name, swiftType] of dropState) {
      const t = state.get(name)!;
      if (swiftType.endsWith('?')) expect(t).toContain('| null');
      else expect(t).not.toContain('null');
      if (/^(Int|Double)\??$/.test(swiftType)) expect(t.replace(' | null', '')).toBe('number');
    }
    expect([...tsFields(read(TS), 'DropAttrs').keys()].sort()).toEqual([...dropAttrs.keys()].sort());
  });

  test('the server pushes exactly these keys, under this type name', () => {
    const py = read(DROP_PUSH);
    expect(pyTuple(py, 'CONTENT_STATE_KEYS')).toEqual([...dropState.keys()]);
    expect(pyTuple(py, 'ATTRIBUTE_KEYS')).toEqual([...dropAttrs.keys()]);
    expect(py).toContain('ATTRIBUTES_TYPE = "BuilderDropAttributes"');
    expect(dropExt).toContain('public struct BuilderDropAttributes: ActivityAttributes');
  });

  test('the phases are one list: the TypeScript union, the Swift views, the server', () => {
    const union = tsUnion(read(TS), 'DropPhase');
    expect(union).toEqual(['sent', 'reading', 'planned', 'refused', 'started']);
    const views = /enum Phase: String \{\s*case ([^\n]+)/.exec(read(DROP_VIEWS))![1]!.split(',').map((x) => x.trim());
    expect(views).toEqual(union);
    expect(pyTuple(read(DROP_PUSH), 'PHASES')).toEqual(union);
  });

  test('DropStateRecord and DropAttrsRecord carry every field with the same type, and content() hands them all over', () => {
    const bridge = read(DROP_BRIDGE);
    const rec = recordFields(bridge, 'DropStateRecord');
    expect([...rec.keys()].sort()).toEqual([...dropState.keys()].sort());
    for (const [name, swiftType] of dropState) expect(rec.get(name)).toBe(swiftType);
    const attrs = recordFields(bridge, 'DropAttrsRecord');
    expect([...attrs.keys()].sort()).toEqual([...dropAttrs.keys()].sort());
    const body = bridge.slice(bridge.indexOf('static func content('));
    for (const name of dropState.keys()) expect(body).toContain(`${name}: s.${name}`);
  });

  test('one card per drop: a start adopts a live card, and a pushed twin comes down', () => {
    const mod = read(MODULE);
    expect(mod).toContain('if let existing = DropLive.live(attrs.dropId)');
    expect(mod).toContain('$0.id != activity.id && $0.attributes.dropId == activity.attributes.dropId');
    // endAll takes the drop cards down with the session cards (Settings > Live Activities off).
    const endAll = mod.slice(mod.indexOf('AsyncFunction("endAll")'), mod.indexOf('AsyncFunction("startDrop")'));
    expect(endAll).toContain('Activity<BuilderDropAttributes>.activities');
  });

  test('the island registers the drop card, and Start is an intent the app can run', () => {
    expect(read('targets/widget/index.swift')).toContain('BuilderDropActivity()');
    expect(read('targets/widget/BuilderDropActivity.swift')).toContain('ActivityConfiguration(for: BuilderDropAttributes.self)');
    // In _shared, so it compiles into the APP as well: a LiveActivityIntent runs in the app.
    const intent = read('targets/widget/_shared/DropStartIntent.swift');
    expect(intent).toContain('struct StartDropMoveIntent: LiveActivityIntent');
    expect(intent).toContain('.requiresAuthentication');
    expect(intent).toContain(':start"');
    expect(read(DROP_VIEWS)).toContain('Button(intent: StartDropMoveIntent(');
  });
});

describe('the island says what the in-app island says', () => {
  const views = read(DROP_VIEWS);
  const swiftWord = (name: string) => new RegExp(`static let ${name} = "([^"]+)"`).exec(views)?.[1];

  test('the four step sentences are dropSteps, word for word', () => {
    const base = { kind: 'drop' as const, id: 'd', dropId: 'd', host: 'instagram.com', title: null, thumbnail: null, firstMove: null, hue: null };
    const rows = (phase: 'sent' | 'reading' | 'planned' | 'refused', moves = 0) => dropSteps({ ...base, phase, moves }).rows.map((r) => r.text);
    expect(rows('sent')[0]).toBe(swiftWord('sent')!);
    // "Reading \(host)" in Swift: the in-app row for the same host.
    expect(views).toContain('static func reading(_ host: String) -> String { "Reading \\(host)" }');
    expect(rows('reading')[1]).toBe('Reading instagram.com');
    expect(views).toContain('static func movesReady(_ n: Int) -> String { n == 1 ? "1 move ready" : "\\(n) moves ready" }');
    expect(rows('planned', 1)[2]).toBe('1 move ready');
    expect(rows('planned', 3)[2]).toBe('3 moves ready');
    expect(rows('refused')[2]).toBe(swiftWord('nothingToDo')!);
  });

  test('"waiting for your Mac" is the board\'s own phrase', () => {
    const w = swiftWord('waitingForMac')!;
    expect(w[0]!.toLowerCase() + w.slice(1)).toBe(STATUS_LINE.waiting!);
  });
});

describe('the credential the extension and the island share', () => {
  test('one file, symlinked into every binary that reads it', () => {
    const canonical = realpathSync(join(ROOT, 'modules/builder-drops/ios/BuilderDropsCredential.swift'));
    for (const link of ['targets/share/BuilderDropsCredential.swift', 'targets/widget/_shared/BuilderDropsCredential.swift', 'modules/builder-live/ios/BuilderDropsCredential.swift']) {
      expect(lstatSync(join(ROOT, link)).isSymbolicLink()).toBe(true);
      expect(realpathSync(join(ROOT, link))).toBe(canonical);
    }
    for (const link of ['targets/share/BuilderDropsURL.swift', 'targets/share/BuilderDropsShare.swift']) {
      expect(lstatSync(join(ROOT, link)).isSymbolicLink()).toBe(true);
    }
  });

  test('its keychain group is the App Group every target is entitled to, and it holds no refresh token', () => {
    const cred = read('modules/builder-drops/ios/BuilderDropsCredential.swift');
    const group = /accessGroup = "([^"]+)"/.exec(cred)![1]!;
    expect(read('app.config.ts')).toContain(`'com.apple.security.application-groups': ['${group}']`);
    expect(read('modules/builder-drops/ios/BuilderDropsInbox.swift')).toContain(`suiteName = "${group}"`);
    expect(cred).toContain('kSecAttrAccessibleWhenUnlockedThisDeviceOnly');
    // Code, not the comments that explain why: nothing here stores or reads a refresh token.
    const code = cred.split('\n').filter((l) => !/^\s*\/\//.test(l)).join('\n');
    expect(code.toLowerCase()).not.toContain('refresh');
  });

  test('the share extension calls one route, and falls back to the queue on anything else', () => {
    const share = read('modules/builder-drops/ios/BuilderDropsShare.swift');
    const routes = [...share.matchAll(/request\("(\w+)", "([^"]+)"/g)].map((m) => `${m[1]} ${m[2]}`);
    expect(routes).toEqual(['POST /v1/drops']);
    expect(share).toContain('public static let timeout: TimeInterval = 4');
    const controller = read('targets/share/ShareViewController.swift');
    expect(controller.match(/BuilderDropsInbox\.add\(/g)?.length).toBe(2);
    expect(read('targets/share/ShareSheetView.swift')).toContain('"Sent to your Mac"');
    expect(read('targets/share/ShareSheetView.swift')).toContain('"Kept for when Builda opens"');
  });
});

// ------------------------------------------------------------------ a demo you asked for

/**
 * `BuilderDemoAttributes` (docs/demo-island.md), the same five places as the drop card's: the
 * Swift struct the widget extension compiles, its byte-identical copy in the pod, the pod's
 * Records, the TypeScript the phone builds a card with, and the server's push
 * (`demo_push.CONTENT_STATE_KEYS`). And the words: the Swift card says what the in-app island and
 * the kit screen say, so the two islands cannot disagree about a request.
 */
const DEMO_EXT = 'targets/widget/_shared/BuilderDemoAttributes.swift';
const DEMO_POD = 'modules/builder-live/ios/BuilderDemoAttributes.swift';
const DEMO_BRIDGE = 'modules/builder-live/ios/BuilderDemoLive.swift';
const DEMO_VIEWS = 'targets/widget/_shared/DemoActivityViews.swift';
const DEMO_PUSH = '../server/builder/demo_push.py';

const demoExt = read(DEMO_EXT);
const demoCard = swiftVars(demoExt, 'struct ContentState', 'public init(');
const demoAttrs = swiftVars(demoExt.slice(demoExt.indexOf('public var requestId')), 'public var requestId', 'public init(');

describe('BuilderDemoAttributes', () => {
  test('the pod and the extension declare the same ActivityAttributes, byte for byte', () => {
    expect(read(DEMO_POD)).toBe(demoExt);
  });

  test('ContentState is the card the task names (phase, since, failure words) and when it moved, and the attributes are fixed', () => {
    expect([...demoCard.keys()]).toEqual(['phase', 'sinceEpoch', 'failure', 'updatedEpoch']);
    expect([...demoAttrs.keys()]).toEqual(['requestId', 'projectKey', 'title', 'hue']);
    expect(demoCard.get('failure')).toBe('String?');
    expect(demoCard.get('sinceEpoch')).toBe('Double');
    expect(demoAttrs.get('hue')).toBe('String?');
  });

  test('the JS DemoState and DemoAttrs keys are exactly the Swift fields, optionals nullable', () => {
    const state = tsFields(read(TS), 'DemoState');
    expect([...state.keys()].sort()).toEqual([...demoCard.keys()].sort());
    for (const [name, swiftType] of demoCard) {
      const t = state.get(name)!;
      if (swiftType.endsWith('?')) expect(t).toContain('| null');
      else expect(t).not.toContain('null');
      if (/^(Int|Double)\??$/.test(swiftType)) expect(t.replace(' | null', '')).toBe('number');
    }
    const attrs = tsFields(read(TS), 'DemoAttrs');
    expect([...attrs.keys()].sort()).toEqual([...demoAttrs.keys()].sort());
    expect(attrs.get('hue')).toContain('| null');
  });

  test('the server pushes exactly these keys', () => {
    const py = read(DEMO_PUSH);
    expect(pyTuple(py, 'CONTENT_STATE_KEYS')).toEqual([...demoCard.keys()]);
    expect(pyTuple(py, 'ATTRIBUTE_KEYS')).toEqual([...demoAttrs.keys()]);
    expect(demoExt).toContain('public struct BuilderDemoAttributes: ActivityAttributes');
  });

  test('the phases are one list: the TypeScript union, the Swift views, the palette, the server', () => {
    const union = tsUnion(read(TS), 'DemoPhase');
    expect(union).toEqual(['asked', 'filming', 'made', 'ready', 'failed']);
    const views = /enum Phase: String \{\s*case ([^\n]+)/.exec(read(DEMO_VIEWS))![1]!.split(',').map((x) => x.trim());
    expect(views).toEqual(union);
    const palette = /enum DemoState: String, CaseIterable \{\s*case ([^\n]+)/.exec(read('targets/widget/_shared/Palette.swift'))![1]!.split(',').map((x) => x.trim());
    expect(palette).toEqual(union);
    expect(pyTuple(read(DEMO_PUSH), 'PHASES')).toEqual(union);
  });

  test('DemoStateRecord and DemoAttrsRecord carry every field with the same type, and content() hands them all over', () => {
    const bridge = read(DEMO_BRIDGE);
    const rec = recordFields(bridge, 'DemoStateRecord');
    expect([...rec.keys()].sort()).toEqual([...demoCard.keys()].sort());
    for (const [name, swiftType] of demoCard) expect(rec.get(name)).toBe(swiftType);
    const attrs = recordFields(bridge, 'DemoAttrsRecord');
    expect([...attrs.keys()].sort()).toEqual([...demoAttrs.keys()].sort());
    for (const [name, swiftType] of demoAttrs) expect(attrs.get(name)).toBe(swiftType);
    const body = bridge.slice(bridge.indexOf('static func content('));
    for (const name of demoCard.keys()) expect(body).toContain(`${name}: s.${name}`);
    // Tokens go to the demo route, through the one POST the drop cards use.
    expect(bridge).toContain('"/v1/push/demo-activity"');
    expect(bridge).toContain('IslandTokenPost.send(');
  });

  test('one card per request and per project, and every card comes down with the rest', () => {
    const mod = read(MODULE);
    expect(mod).toContain('if let existing = DemoLive.live(attrs.requestId)');
    expect(mod).toContain('older.attributes.projectKey == attrs.projectKey');
    const endAll = mod.slice(mod.indexOf('AsyncFunction("endAll")'), mod.indexOf('AsyncFunction("startDrop")'));
    expect(endAll).toContain('Activity<BuilderDemoAttributes>.activities');
  });

  test('the island registers the demo card, and Share is a link into the kit', () => {
    expect(read('targets/widget/index.swift')).toContain('BuilderDemoActivity()');
    expect(read('targets/widget/BuilderDemoActivity.swift')).toContain('ActivityConfiguration(for: BuilderDemoAttributes.self)');
    const views = read(DEMO_VIEWS);
    expect(views).toContain('URL(string: "builder://ship/\\(projectKey)")');
    expect(views).toContain('Link(destination: url)');
  });

  test('the record light is the generated palette, never a literal colour', () => {
    const views = read(DEMO_VIEWS);
    expect(views).toContain('BuilderPalette.demoInk(');
    expect(views).not.toMatch(/Color\(\s*(red|\.sRGB|hue|white)/);
    expect(views).not.toMatch(/#[0-9A-Fa-f]{6}/);
  });
});

// The in-app island these words were held to was deleted on 2026-09-19 (the owner: the island is not
// for status). The card itself is switched off (`live/activity.ts`) and still held to the kit screen.
describe('the demo card says what the kit screen says', () => {
  const views = read(DEMO_VIEWS);
  const swiftWord = (name: string) => new RegExp(`static let ${name} = "([^"]+)"`).exec(views)?.[1];

  test('made is the in-app notice\'s own sentence, and its card has no Share', () => {
    const made = swiftWord('made')!;
    expect(made).toBe('Made on your Mac. Publish it there to share it.');
    // feeds.ts trackDemo's notice ends with the same sentence ("The demo of X is made on your Mac. ...").
    const feeds = read('src/island/feeds.ts');
    expect(feeds).toContain('is made on your Mac. Publish it there to share it.`');
    // The Share link is drawn only for ready.
    const row = views.slice(views.indexOf('struct DemoAnswerRow'), views.indexOf('// MARK: - Lock Screen'));
    expect(row).toContain('if d.phase == .ready, let url = d.url');
    expect(row.split('Link(destination:').length).toBe(2);
  });

  test('made wears the dim grey token, from the generator', () => {
    const palette = read('targets/widget/_shared/Palette.swift');
    expect(palette).toMatch(/case \.made: return srgb\([^)]+\)  \/\/ surface\.textDim /);
  });

  test('a failure is requestView\'s line, word for word, with and without a reason', async () => {
    const { requestView } = await import('../src/shipkit/model');
    const failed = (refusal: string | null) =>
      requestView([{ id: 'r', project_key: 'k', status: 'failed', refusal: refusal as never, hue: null, created_at: '', claimed_at: null, finished_at: '' }], null).line;
    expect(views).toContain('return "It did not work: \\(why)."');
    expect(failed('capture_failed')).toBe('It did not work: the Mac could not film it.');
    expect(views).toContain('return "It did not work on your Mac."');
    expect(failed(null)).toBe('It did not work on your Mac.');
  });
});
