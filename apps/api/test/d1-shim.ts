import { DatabaseSync, type StatementSync } from 'node:sqlite';
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

type Param = string | number | null;

/** Implementa o subconjunto de D1Database que o drizzle-orm/d1 usa, sobre node:sqlite. */
class Stmt {
  private params: Param[] = [];
  constructor(
    private db: DatabaseSync,
    readonly sql: string,
  ) {}
  bind(...p: Param[]) {
    this.params = p;
    return this;
  }
  private stmt(arrays = false): StatementSync {
    const s = this.db.prepare(this.sql);
    s.setReturnArrays(arrays);
    return s;
  }
  async all() {
    return { results: this.stmt().all(...this.params), success: true, meta: {} };
  }
  async raw() {
    return this.stmt(true).all(...this.params);
  }
  async first(col?: string) {
    const row = this.stmt().get(...this.params) as Record<string, unknown> | undefined;
    return row ? (col ? row[col] : row) : null;
  }
  async run() {
    const info = this.stmt().run(...this.params);
    return { success: true, results: [], meta: { changes: Number(info.changes) } };
  }
  runSync() {
    return this.stmt().run(...this.params);
  }
}

export function createTestD1(migrationsDir = join(__dirname, '..', 'migrations')) {
  const db = new DatabaseSync(':memory:');
  db.exec('PRAGMA foreign_keys = ON');
  for (const f of readdirSync(migrationsDir)
    .filter((f) => f.endsWith('.sql'))
    .sort()) {
    for (const part of readFileSync(join(migrationsDir, f), 'utf8').split(
      '--> statement-breakpoint',
    )) {
      if (part.trim()) db.exec(part);
    }
  }
  const d1 = {
    prepare: (sql: string) => new Stmt(db, sql),
    async batch(stmts: Stmt[]) {
      db.exec('BEGIN');
      try {
        const out = [];
        for (const s of stmts) out.push(await s.run());
        db.exec('COMMIT');
        return out;
      } catch (e) {
        db.exec('ROLLBACK');
        throw e;
      }
    },
    async exec(sql: string) {
      db.exec(sql);
      return { count: 1, duration: 0 };
    },
  };
  return { d1: d1 as unknown as D1Database, raw: db };
}
