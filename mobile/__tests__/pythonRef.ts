/**
 * Run a snippet against the engine itself, for the tests that pin a phone port to Python.
 *
 * The `dither.test.ts` rule, made stricter: a machine with no python3 (or one older than the
 * 3.11 the analysis package needs) SKIPS, because the port is also pinned by hand checked
 * values and by `make gen`. A machine that HAS a new enough python3 must run the snippet
 * cleanly: a reference that fails to import is a failure, not a quiet pass, or a pin nobody
 * ever executed would read as green.
 */
import { spawnSync } from 'node:child_process';
import { join } from 'node:path';

/** The repository root, so a snippet can `sys.path.insert(0, REPO)`. */
export const REPO = join(import.meta.dir, '..', '..');

let usable: boolean | null = null;

/** Is there a python3 here that can import `analysis`? */
export function havePython(): boolean {
  if (usable === null) {
    const probe = spawnSync('python3', ['-c', 'import sys; print(sys.version_info >= (3, 11))'], { encoding: 'utf8' });
    usable = !probe.error && probe.status === 0 && probe.stdout.trim() === 'True';
  }
  return usable;
}

/**
 * The snippet's stdout parsed as JSON, or null when there is no usable python3 here. The
 * snippet runs from the repository root with it on `sys.path`; `args` arrive as `sys.argv[1:]`.
 */
export function python<T = unknown>(script: string, ...args: string[]): T | null {
  if (!havePython()) return null;
  const prelude = `import sys\nsys.path.insert(0, ${JSON.stringify(REPO)})\n`;
  const run = spawnSync('python3', ['-c', prelude + script, ...args], { encoding: 'utf8', cwd: REPO, maxBuffer: 64 * 1024 * 1024 });
  if (run.error || run.status !== 0) {
    throw new Error(`the Python reference failed (status ${run.status}):\n${run.stderr || String(run.error)}`);
  }
  return JSON.parse(run.stdout) as T;
}
