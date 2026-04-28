import type { Client } from "typesense";

export interface FakeTypesenseHandle {
  client: Client;
  state: FakeTypesenseState;
  setHealthy(healthy: boolean): void;
}

export interface FakeTypesenseState {
  healthy: boolean;
  collections: Map<string, FakeTypesenseCollection>;
}

export interface FakeTypesenseCollection {
  schema: { name: string };
  docs: Map<string, Record<string, unknown>>;
}

export function createFakeTypesenseClient(seed?: {
  collections?: Record<string, Array<Record<string, unknown>>>;
}): FakeTypesenseHandle {
  const state: FakeTypesenseState = {
    healthy: true,
    collections: new Map(),
  };

  if (seed?.collections) {
    for (const [name, docs] of Object.entries(seed.collections)) {
      const docMap = new Map<string, Record<string, unknown>>();
      for (const doc of docs) docMap.set(String(doc.id), doc);
      state.collections.set(name, { schema: { name }, docs: docMap });
    }
  }

  const getCollection = (name: string): FakeTypesenseCollection => {
    const collection = state.collections.get(name);
    if (!collection) throw new FakeTypesenseNotFoundError();
    return collection;
  };

  const documentsForId = (name: string, id: string) => ({
    delete: async () => {
      const collection = getCollection(name);
      if (!collection.docs.has(id)) throw new FakeTypesenseNotFoundError();
      collection.docs.delete(id);
      return { id };
    },
  });

  const documentsNoId = (name: string) => ({
    upsert: async (doc: Record<string, unknown>) => {
      const collection = getCollection(name);
      collection.docs.set(String(doc.id), doc);
      return doc;
    },
    import: async (docs: Array<Record<string, unknown>>) => {
      const collection = getCollection(name);
      const results: Array<{ success: boolean }> = [];
      for (const doc of docs) {
        collection.docs.set(String(doc.id), doc);
        results.push({ success: true });
      }
      return results;
    },
    search: async (params: Record<string, unknown>) => {
      const collection = getCollection(name);
      const all = [...collection.docs.values()];
      const q = typeof params.q === "string" ? params.q : "*";
      const perPage = typeof params.per_page === "number" ? params.per_page : 10;
      const page = typeof params.page === "number" ? params.page : 1;
      const queryBy =
        typeof params.query_by === "string" ? params.query_by.split(",").filter(Boolean) : [];

      let hits = all;
      if (q && q !== "*") {
        const needle = q.toLowerCase();
        hits = all.filter((doc) =>
          queryBy.some((field) =>
            String(doc[field] ?? "")
              .toLowerCase()
              .includes(needle),
          ),
        );
      }

      if (typeof params.filter_by === "string") {
        hits = applyFilter(hits, params.filter_by);
      }

      const total = hits.length;
      const paged = hits.slice((page - 1) * perPage, page * perPage);
      return {
        hits: paged.map((doc) => ({ document: doc, highlights: {} })),
        found: total,
        out_of: all.length,
        search_time_ms: 1,
      };
    },
  });

  // The Typesense SDK exposes a large class surface; integration tests only
  // need this subset, while callers keep accepting a normal Client instance.
  const client = {
    health: {
      retrieve: async () => ({ ok: state.healthy }),
    },
    collections(nameOrNothing?: string) {
      if (nameOrNothing === undefined) {
        return {
          create: async (schema: { name: string }) => {
            state.collections.set(schema.name, { schema, docs: new Map() });
            return schema;
          },
        };
      }
      const name = nameOrNothing;
      return {
        retrieve: async () => {
          const collection = getCollection(name);
          return collection.schema;
        },
        documents: (id?: string) => (id ? documentsForId(name, id) : documentsNoId(name)),
      };
    },
  } as unknown as Client;

  return {
    client,
    state,
    setHealthy(healthy: boolean) {
      state.healthy = healthy;
    },
  };
}

class FakeTypesenseNotFoundError extends Error {
  readonly httpStatus = 404;

  constructor() {
    super("Not found");
    this.name = "ObjectNotFound";
  }
}

function applyFilter(
  docs: Array<Record<string, unknown>>,
  filter: string,
): Array<Record<string, unknown>> {
  return docs.filter((doc) => {
    if (!matchesIdList(doc, filter)) return false;
    if (!matchesStringEquality(doc, filter)) return false;
    if (!matchesStringInequality(doc, filter)) return false;
    if (!matchesNumericFilters(doc, filter)) return false;
    return true;
  });
}

function matchesIdList(doc: Record<string, unknown>, filter: string): boolean {
  const match = filter.match(/\bid:=\[([^\]]+)\]/);
  if (!match) return true;

  const allowed = new Set(
    match[1]
      .split(",")
      .map((item) => item.trim().replace(/^`|`$/g, ""))
      .filter(Boolean),
  );
  return allowed.has(String(doc.id));
}

function matchesStringEquality(doc: Record<string, unknown>, filter: string): boolean {
  const matches = filter.matchAll(/\b([a-zA-Z_]\w*):=(`([^`]*)`|[A-Za-z0-9_][\w-]*)/g);
  for (const match of matches) {
    const field = match[1];
    const rawValue = match[3] ?? match[2];
    if (isNumericString(rawValue)) continue;
    if (String(doc[field]) !== rawValue) return false;
  }
  return true;
}

function matchesStringInequality(doc: Record<string, unknown>, filter: string): boolean {
  const matches = filter.matchAll(/\b([a-zA-Z_]\w*):!=(`([^`]*)`|[A-Za-z0-9_][\w-]*)/g);
  for (const match of matches) {
    const field = match[1];
    const rawValue = match[3] ?? match[2];
    if (String(doc[field]) === rawValue) return false;
  }
  return true;
}

function matchesNumericFilters(doc: Record<string, unknown>, filter: string): boolean {
  const matches = filter.matchAll(/\b([a-zA-Z_]\w*):(>=|<=|>|<|=)(-?\d+(?:\.\d+)?)/g);
  for (const match of matches) {
    const field = match[1];
    const op = match[2];
    const wanted = Number(match[3]);
    const actual = Number(doc[field]);
    if (Number.isNaN(actual)) return false;
    if (op === ">" && actual <= wanted) return false;
    if (op === "<" && actual >= wanted) return false;
    if (op === ">=" && actual < wanted) return false;
    if (op === "<=" && actual > wanted) return false;
    if (op === "=" && actual !== wanted) return false;
  }
  return true;
}

function isNumericString(value: string): boolean {
  return /^-?\d+(?:\.\d+)?$/.test(value);
}
