/**
 * A tiny synchronous relational table engine  -  the storage layer under {@link ../db/schema}.
 *
 * Deliberately not a database *product*: no async, no SQL, no dependencies. What it keeps from the
 * relational model is exactly what the app needs  -  typed rows, primary keys, foreign keys with
 * cascade/restrict, uniqueness, secondary indexes for hot-path lookups, and per-table change
 * subscription for the React layer. User-mutable tables persist to localStorage; code-sourced
 * tables are re-seeded from typed registrations every boot and never stored.
 *
 * Mutations are synchronous and validate eagerly (throw on violation) so the schema is the last
 * line of defence behind the UI. Rows are treated as immutable  -  `update` replaces the object.
 */

export interface RowBase {
  id: string;
}

/** What a foreign key needs from its referenced table (any Table satisfies this). */
export interface FkTarget {
  readonly name: string;
  has(id: string): boolean;
}

export interface ForeignKey<Row> {
  /** The referenced table (a thunk so tables can reference each other regardless of order). */
  table: () => FkTarget;
  /** Referenced row id(s) in this row; empty = no reference. */
  ids: (row: Row) => string[];
  /** What happens to THIS row when a row it references is deleted. */
  onDelete: "cascade" | "restrict";
}

export interface TableOptions<Row extends RowBase> {
  /** Present only on user-mutable tables: where and how to persist. */
  persist?: {
    key: string;
    /** Shape-check one stored row; return null to drop it (never trust localStorage). */
    sanitize: (raw: unknown) => Row | null;
  };
  fks?: ForeignKey<Row>[];
  /** Semantic constraint beyond FKs  -  return an error message to reject, null to accept. */
  validate?: (row: Row) => string | null;
  /** Secondary lookups for hot paths, e.g. `{ plugin: (r) => r.pluginId }`. */
  indexes?: Record<string, (row: Row) => string>;
  /** Uniqueness beyond the primary key, e.g. one binding per hardware control. */
  uniques?: Record<string, (row: Row) => string>;
}

export class Table<Row extends RowBase> {
  /** Bumps on every mutation  -  consumers cache derived structures against it. */
  version = 0;

  private rows = new Map<string, Row>();
  private subs = new Set<() => void>();
  private indexCache = new Map<string, { at: number; map: Map<string, Row[]> }>();
  private flushQueued = false;

  constructor(
    private db: Db,
    readonly name: string,
    private opts: TableOptions<Row>,
  ) {}

  // ── reads ─────────────────────────────────────────────────────────────────────────────────────

  get(id: string): Row | undefined {
    return this.rows.get(id);
  }

  has(id: string): boolean {
    return this.rows.has(id);
  }

  all(): Row[] {
    return [...this.rows.values()];
  }

  get size(): number {
    return this.rows.size;
  }

  /** Rows whose index key matches  -  O(1) after the first read per version. */
  by(index: string, key: string): Row[] {
    const keyOf = this.opts.indexes?.[index];
    if (!keyOf) throw new Error(`[db.${this.name}] unknown index "${index}"`);
    let cache = this.indexCache.get(index);
    if (!cache || cache.at !== this.version) {
      const map = new Map<string, Row[]>();
      for (const row of this.rows.values()) {
        const k = keyOf(row);
        const list = map.get(k);
        if (list) list.push(row);
        else map.set(k, [row]);
      }
      cache = { at: this.version, map };
      this.indexCache.set(index, cache);
    }
    return cache.map.get(key) ?? [];
  }

  // ── writes ────────────────────────────────────────────────────────────────────────────────────

  insert(row: Row): Row {
    if (this.rows.has(row.id)) throw new Error(`[db.${this.name}] duplicate id "${row.id}"`);
    this.check(row);
    this.rows.set(row.id, row);
    this.touch();
    return row;
  }

  update(id: string, patch: Partial<Row>): Row {
    const old = this.rows.get(id);
    if (!old) throw new Error(`[db.${this.name}] update of missing id "${id}"`);
    const next = { ...old, ...patch, id };
    this.check(next);
    this.rows.set(id, next);
    this.touch();
    return next;
  }

  upsert(row: Row): Row {
    return this.rows.has(row.id) ? this.update(row.id, row) : this.insert(row);
  }

  /**
   * Delete a row, honouring referential integrity across the whole db: referencing rows with
   * `onDelete: "cascade"` are deleted too, `"restrict"` referents make the delete throw.
   */
  delete(id: string): void {
    const row = this.rows.get(id);
    if (!row) return;

    const cascades: { table: Table<RowBase>; id: string }[] = [];
    for (const other of this.db.tables) {
      for (const fk of other.opts.fks ?? []) {
        if (fk.table() !== (this as FkTarget)) continue;
        for (const ref of other.rows.values()) {
          if (!fk.ids(ref).includes(id)) continue;
          if (fk.onDelete === "restrict")
            throw new Error(`[db.${this.name}] "${id}" is referenced by ${other.name}/"${ref.id}"`);
          cascades.push({ table: other as Table<RowBase>, id: ref.id });
        }
      }
    }

    this.rows.delete(id);
    this.touch();
    for (const c of cascades) c.table.delete(c.id);
  }

  /**
   * Seeding primitive: swap the entire contents. Rows are checked (FKs must already be seeded  - 
   * declare/seed referenced tables first) but nothing cascades into other tables.
   */
  replaceAll(rows: Row[]): void {
    this.rows.clear();
    for (const row of rows) {
      if (this.rows.has(row.id)) throw new Error(`[db.${this.name}] duplicate id "${row.id}" in seed`);
      this.check(row);
      this.rows.set(row.id, row);
    }
    this.touch();
  }

  subscribe(fn: () => void): () => void {
    this.subs.add(fn);
    return () => this.subs.delete(fn);
  }

  // ── persistence (user-mutable tables only) ────────────────────────────────────────────────────

  /** Load stored rows unchecked  -  {@link Db.load} FK-prunes afterwards, once every table is in. */
  loadPersisted(): void {
    const p = this.opts.persist;
    if (!p || typeof localStorage === "undefined") return;
    let raw: unknown;
    try {
      const text = localStorage.getItem(p.key);
      if (!text) return;
      raw = JSON.parse(text);
    } catch {
      return;
    }
    if (!Array.isArray(raw)) return;
    for (const entry of raw) {
      const row = p.sanitize(entry);
      if (row && !this.rows.has(row.id)) this.rows.set(row.id, row);
    }
    this.version++;
  }

  /** Drop persisted rows that no longer satisfy FKs/constraints (e.g. a plugin was renamed). */
  pruneInvalid(): boolean {
    if (!this.opts.persist) return false;
    let removed = false;
    for (const row of [...this.rows.values()]) {
      const reason = this.invalidReason(row);
      if (!reason) continue;
      console.warn(`[db.${this.name}] pruning stored row "${row.id}": ${reason}`);
      this.rows.delete(row.id);
      removed = true;
    }
    if (removed) this.touch();
    return removed;
  }

  private invalidReason(row: Row): string | null {
    for (const fk of this.opts.fks ?? []) {
      for (const id of fk.ids(row)) {
        if (!fk.table().has(id)) return `missing ${fk.table().name}/"${id}"`;
      }
    }
    const v = this.opts.validate?.(row);
    if (v) return v;
    for (const [name, keyOf] of Object.entries(this.opts.uniques ?? {})) {
      const key = keyOf(row);
      for (const other of this.rows.values()) {
        if (other.id !== row.id && keyOf(other) === key) return `duplicate ${name} "${key}"`;
      }
    }
    return null;
  }

  private check(row: Row): void {
    const reason = this.invalidReason(row);
    if (reason) throw new Error(`[db.${this.name}] invalid row "${row.id}": ${reason}`);
  }

  private touch(): void {
    this.version++;
    if (this.opts.persist && typeof localStorage !== "undefined" && !this.flushQueued) {
      this.flushQueued = true;
      queueMicrotask(() => {
        this.flushQueued = false;
        try {
          localStorage.setItem(this.opts.persist!.key, JSON.stringify(this.all()));
        } catch {
          /* ignore (private mode / quota) */
        }
      });
    }
    for (const fn of this.subs) fn();
  }
}

export class Db {
  readonly tables: Table<RowBase>[] = [];

  table<Row extends RowBase>(name: string, opts: TableOptions<Row> = {}): Table<Row> {
    const t = new Table<Row>(this, name, opts);
    this.tables.push(t as unknown as Table<RowBase>);
    return t;
  }

  /** Load every persisted table, then prune rows across tables until referentially stable. */
  load(): void {
    for (const t of this.tables) t.loadPersisted();
    let changed = true;
    while (changed) {
      changed = false;
      for (const t of this.tables) changed = t.pruneInvalid() || changed;
    }
  }
}
