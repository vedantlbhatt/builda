/**
 * Web stand-in for `expo-sqlite`, resolved ONLY when Metro bundles for `platform === 'web'`
 * (see `metro.config.js`). Native builds import the real module and never see this file.
 *
 * It is REAL SQLite: the wa-sqlite build expo-sqlite itself ships for web
 * (`expo-sqlite/web/wa-sqlite`, SQLite 3.49), run on the page's own thread over an in-memory
 * database. expo-sqlite's own web module is not used because it needs a Worker plus
 * SharedArrayBuffer, which means cross-origin isolation headers on every server that hosts the
 * bundle and on every image it loads; this needs neither.
 *
 * WHY NOT THE SUBSET INTERPRETER THIS FILE USED TO BE. It parsed a dozen statement shapes and
 * threw on anything else, and `src/data/cache.ts` has since grown `json_extract`, `julianday`,
 * `json_set`, numbered parameters and `NOT IN` lists. MEASURED on the desktop build, 2026-09-19:
 * `PRAGMA table_info(kv)` threw first, `guarded` then returned every fallback, and the Sessions
 * list read `[]` from a cache the sync had just filled. A second SQL dialect is a second
 * definition that drifts; the same engine the phone runs cannot.
 *
 * `sessions` and `profile` are a page-lifetime cache: the app re-syncs from the server on every
 * load. `kv` is different: it holds the device's own choices (the creature, the onboarding flag,
 * the switches), which a desktop window must still have after a relaunch, so its rows are written
 * through to localStorage (`KV_PERSIST_KEY`) after every statement that names it, and read back
 * when the database opens.
 *
 * The wasm is served from the site root (`public/wa-sqlite.wasm`, copied by
 * `scripts/web-assets.mjs`).
 */

type Param = string | number | null;
type Row = Record<string, unknown>;

/** The slice of wa-sqlite's API this file calls (`expo-sqlite/web/wa-sqlite/sqlite-api.js`). */
interface WaSqlite {
  open_v2(name: string, flags?: number, vfs?: string): Promise<number>;
  statements(db: number, sql: string): AsyncIterable<number>;
  bind_collection(stmt: number, params: Param[]): number;
  step(stmt: number): Promise<number>;
  column_names(stmt: number): string[];
  row(stmt: number): unknown[];
  changes(db: number): number;
}

const SQLITE_ROW = 100;

/** Where the `kv` rows live between launches; one JSON object, `{ [k]: v }`. */
const KV_PERSIST_KEY = 'builder.sqlite.kv';

/** The schema `cache.ts` creates for `kv`, created here first so its rows can be restored. */
const KV_TABLE = 'CREATE TABLE IF NOT EXISTS kv (k TEXT PRIMARY KEY, v TEXT)';

function storage(): Storage | null {
  try {
    return typeof localStorage === 'undefined' ? null : localStorage;
  } catch {
    return null;
  }
}

let enginePromise: Promise<WaSqlite> | null = null;

/** Load the wasm once per page. `require` rather than `import`: expo-sqlite does not export these paths. */
function engine(): Promise<WaSqlite> {
  if (!enginePromise) {
    enginePromise = (async () => {
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      const factoryModule = require('../../node_modules/expo-sqlite/web/wa-sqlite/wa-sqlite.js');
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      const api = require('../../node_modules/expo-sqlite/web/wa-sqlite/sqlite-api.js');
      const factory = (factoryModule.default ?? factoryModule) as (o: object) => Promise<unknown>;
      const module = await factory({ locateFile: (file: string) => `/${file}` });
      return api.Factory(module) as WaSqlite;
    })();
  }
  return enginePromise;
}

class WebDatabase {
  private readonly ready: Promise<{ sqlite: WaSqlite; db: number }>;
  /** One statement at a time: a transaction opened by one caller must not swallow another's writes. */
  private queue: Promise<unknown> = Promise.resolve();

  constructor(private readonly persistKv: boolean) {
    this.ready = (async () => {
      const sqlite = await engine();
      const db = await sqlite.open_v2(':memory:');
      if (persistKv) await this.restoreKv(sqlite, db);
      return { sqlite, db };
    })();
  }

  private async restoreKv(sqlite: WaSqlite, db: number): Promise<void> {
    await this.exec(sqlite, db, KV_TABLE, []);
    let saved: Record<string, Param> = {};
    try {
      saved = JSON.parse(storage()?.getItem(KV_PERSIST_KEY) ?? '{}') as Record<string, Param>;
    } catch {
      // A corrupt copy is no copy: the kv starts empty, as on a fresh install.
    }
    for (const [k, v] of Object.entries(saved)) {
      await this.exec(sqlite, db, 'INSERT OR REPLACE INTO kv (k, v) VALUES (?, ?)', [k, v ?? null]);
    }
  }

  /** Every statement in `sql`, the parameters bound to each one that has any; rows of the last. */
  private async exec(sqlite: WaSqlite, db: number, sql: string, params: Param[]): Promise<Row[]> {
    let rows: Row[] = [];
    for await (const stmt of sqlite.statements(db, sql)) {
      if (params.length) sqlite.bind_collection(stmt, params);
      const cols = sqlite.column_names(stmt);
      rows = [];
      while ((await sqlite.step(stmt)) === SQLITE_ROW) {
        const values = sqlite.row(stmt);
        const row: Row = {};
        cols.forEach((c, i) => {
          const v = values[i];
          row[c] = typeof v === 'bigint' ? Number(v) : v;
        });
        rows.push(row);
      }
    }
    return rows;
  }

  private run<T>(sql: string, params: Param[], pick: (rows: Row[], changes: number) => T): Promise<T> {
    const next = this.queue.then(async () => {
      const { sqlite, db } = await this.ready;
      const rows = await this.exec(sqlite, db, sql, params);
      const changes = sqlite.changes(db);
      if (this.persistKv && /\bkv\b/i.test(sql) && !/^\s*SELECT\b/i.test(sql)) await this.saveKv(sqlite, db);
      return pick(rows, changes);
    });
    this.queue = next.catch(() => undefined);
    return next;
  }

  private async saveKv(sqlite: WaSqlite, db: number): Promise<void> {
    const out: Record<string, unknown> = {};
    try {
      for (const r of await this.exec(sqlite, db, 'SELECT k, v FROM kv', [])) out[String(r.k)] = r.v ?? null;
      storage()?.setItem(KV_PERSIST_KEY, JSON.stringify(out));
    } catch {
      // No kv table yet, or full or blocked storage: the page keeps its in-memory copy.
    }
  }

  execAsync(sql: string): Promise<void> {
    return this.run(sql, [], () => undefined);
  }

  runAsync(sql: string, ...params: Param[]): Promise<{ changes: number }> {
    return this.run(sql, params, (_rows, changes) => ({ changes }));
  }

  getAllAsync<T>(sql: string, ...params: Param[]): Promise<T[]> {
    return this.run(sql, params, (rows) => rows as T[]);
  }

  getFirstAsync<T>(sql: string, ...params: Param[]): Promise<T | null> {
    return this.run(sql, params, (rows) => (rows.length ? (rows[0] as T) : null));
  }
}

const open = new Map<string, WebDatabase>();

/** Same signature `cache.ts` calls; one database per name for the page's life. */
export function openDatabaseSync(name: string): WebDatabase {
  let d = open.get(name);
  if (!d) {
    d = new WebDatabase(name === 'builder-cache.db');
    open.set(name, d);
  }
  return d;
}

export async function openDatabaseAsync(name: string): Promise<WebDatabase> {
  return openDatabaseSync(name);
}

export type { WebDatabase as SQLiteDatabase };
