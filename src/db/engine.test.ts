import { beforeEach, describe, expect, it, vi } from "vitest";
import { Db, type Table } from "./engine";

// The test jsdom exposes a stub localStorage without methods — install a working in-memory one.
function memoryStorage(): Storage {
  const map = new Map<string, string>();
  return {
    get length() { return map.size; },
    key: (i: number) => [...map.keys()][i] ?? null,
    getItem: (k: string) => map.get(k) ?? null,
    setItem: (k: string, v: string) => void map.set(k, String(v)),
    removeItem: (k: string) => void map.delete(k),
    clear: () => map.clear(),
  };
}
vi.stubGlobal("localStorage", memoryStorage());

interface Author {
  id: string;
  name: string;
}
interface Book {
  id: string;
  authorId: string;
  title: string;
}

function makeDb(opts: { onDelete?: "cascade" | "restrict" } = {}) {
  const db = new Db();
  const authors = db.table<Author>("authors");
  const books = db.table<Book>("books", {
    fks: [{ table: () => authors, ids: (r) => [r.authorId], onDelete: opts.onDelete ?? "cascade" }],
    indexes: { author: (r) => r.authorId },
    uniques: { title: (r) => r.title },
  });
  return { db, authors, books };
}

describe("Table CRUD + constraints", () => {
  it("inserts, gets, updates and rejects duplicate ids", () => {
    const { authors } = makeDb();
    authors.insert({ id: "a", name: "Ada" });
    expect(authors.get("a")?.name).toBe("Ada");
    authors.update("a", { name: "Ada L." });
    expect(authors.get("a")?.name).toBe("Ada L.");
    expect(() => authors.insert({ id: "a", name: "again" })).toThrow(/duplicate/);
    expect(() => authors.update("nope", { name: "x" })).toThrow(/missing/);
  });

  it("rejects rows whose foreign key does not resolve", () => {
    const { authors, books } = makeDb();
    authors.insert({ id: "a", name: "Ada" });
    expect(() => books.insert({ id: "b", authorId: "ghost", title: "T" })).toThrow(/missing authors/);
    books.insert({ id: "b", authorId: "a", title: "T" });
  });

  it("enforces uniqueness beyond the primary key", () => {
    const { authors, books } = makeDb();
    authors.insert({ id: "a", name: "Ada" });
    books.insert({ id: "b1", authorId: "a", title: "Same" });
    expect(() => books.insert({ id: "b2", authorId: "a", title: "Same" })).toThrow(/duplicate title/);
    // updating a row onto its own key is fine
    books.update("b1", { title: "Same" });
  });

  it("runs the validate hook on writes", () => {
    const db = new Db();
    const t = db.table<Author>("strict", { validate: (r) => (r.name ? null : "name required") });
    expect(() => t.insert({ id: "x", name: "" })).toThrow(/name required/);
    t.insert({ id: "x", name: "ok" });
  });
});

describe("deletes across tables", () => {
  it("cascades referencing rows", () => {
    const { authors, books } = makeDb({ onDelete: "cascade" });
    authors.insert({ id: "a", name: "Ada" });
    books.insert({ id: "b", authorId: "a", title: "T" });
    authors.delete("a");
    expect(books.size).toBe(0);
  });

  it("restricts when referents exist", () => {
    const { authors, books } = makeDb({ onDelete: "restrict" });
    authors.insert({ id: "a", name: "Ada" });
    books.insert({ id: "b", authorId: "a", title: "T" });
    expect(() => authors.delete("a")).toThrow(/referenced by books/);
    books.delete("b");
    authors.delete("a");
    expect(authors.size).toBe(0);
  });
});

describe("indexes and reactivity", () => {
  it("looks rows up by secondary index and tracks mutations", () => {
    const { authors, books } = makeDb();
    authors.insert({ id: "a", name: "Ada" });
    authors.insert({ id: "b", name: "Bob" });
    books.insert({ id: "b1", authorId: "a", title: "One" });
    books.insert({ id: "b2", authorId: "a", title: "Two" });
    books.insert({ id: "b3", authorId: "b", title: "Three" });
    expect(books.by("author", "a").map((r) => r.id)).toEqual(["b1", "b2"]);
    books.delete("b1");
    expect(books.by("author", "a").map((r) => r.id)).toEqual(["b2"]);
    expect(() => books.by("nope", "a")).toThrow(/unknown index/);
  });

  it("bumps version and notifies subscribers once per mutation", () => {
    const { authors } = makeDb();
    let calls = 0;
    authors.subscribe(() => calls++);
    const v0 = authors.version;
    authors.insert({ id: "a", name: "Ada" });
    authors.update("a", { name: "A" });
    authors.delete("a");
    expect(calls).toBe(3);
    expect(authors.version).toBe(v0 + 3);
  });
});

describe("persistence", () => {
  const KEY = "test.engine.books.v1";

  function makePersisted() {
    const db = new Db();
    const authors = db.table<Author>("authors");
    const books = db.table<Book>("books", {
      persist: {
        key: KEY,
        sanitize: (raw) => {
          const r = raw as Record<string, unknown>;
          return typeof r?.id === "string" && typeof r?.authorId === "string" && typeof r?.title === "string"
            ? { id: r.id, authorId: r.authorId, title: r.title }
            : null;
        },
      },
      fks: [{ table: () => authors, ids: (r) => [r.authorId], onDelete: "cascade" }],
    });
    return { db, authors, books };
  }

  beforeEach(() => localStorage.removeItem(KEY));

  it("round-trips rows through localStorage", async () => {
    const first = makePersisted();
    first.authors.insert({ id: "a", name: "Ada" });
    first.books.insert({ id: "b", authorId: "a", title: "T" });
    await Promise.resolve(); // flush is microtask-batched

    const second = makePersisted();
    second.authors.insert({ id: "a", name: "Ada" });
    second.db.load();
    expect(second.books.get("b")?.title).toBe("T");
  });

  it("drops malformed rows via sanitize and dangling rows via FK pruning", () => {
    localStorage.setItem(
      KEY,
      JSON.stringify([
        { id: "ok", authorId: "a", title: "Keep" },
        { id: "dangling", authorId: "ghost", title: "Prune" },
        { nope: true },
        "garbage",
      ]),
    );
    const { db, authors, books } = makePersisted();
    authors.insert({ id: "a", name: "Ada" });
    db.load();
    expect(books.all().map((r) => r.id)).toEqual(["ok"]);
  });
});

describe("replaceAll (seeding)", () => {
  it("swaps contents and still checks the new rows", () => {
    const { authors, books } = makeDb();
    authors.insert({ id: "a", name: "Ada" });
    books.insert({ id: "b", authorId: "a", title: "T" });
    books.replaceAll([{ id: "b2", authorId: "a", title: "U" }]);
    expect(books.all().map((r) => r.id)).toEqual(["b2"]);
    expect(() => (books as Table<Book>).replaceAll([{ id: "x", authorId: "ghost", title: "V" }])).toThrow(/missing/);
  });
});
