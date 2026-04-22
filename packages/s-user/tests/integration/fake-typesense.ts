import type { Client } from "typesense";

/**
 * Minimal in-memory fake Typesense client.
 *
 * Implements just enough of the surface we call (`health.retrieve`,
 * `collections()`, `collections(name).retrieve/create`,
 * `documents().{upsert,import,search}`, `documents(id).delete`) for the
 * integration tests to exercise the full Hono → service → client path
 * without a live cluster. Cast with `as unknown as Client` at the
 * injection site.
 */
export interface FakeTypesenseHandle {
  client: Client;
  state: FakeState;
  setHealthy(healthy: boolean): void;
}

interface FakeState {
  healthy: boolean;
  collections: Map<string, FakeCollection>;
}

interface FakeCollection {
  schema: { name: string };
  docs: Map<string, Record<string, unknown>>;
}

export function createFakeTypesenseClient(seed?: {
  collections?: Record<string, Array<Record<string, unknown>>>;
}): FakeTypesenseHandle {
  const state: FakeState = {
    healthy: true,
    collections: new Map(),
  };

  if (seed?.collections) {
    for (const [name, docs] of Object.entries(seed.collections)) {
      const docMap = new Map<string, Record<string, unknown>>();
      for (const d of docs) docMap.set(String(d.id), d);
      state.collections.set(name, { schema: { name }, docs: docMap });
    }
  }

  const notFound = () => {
    const err = new Error("Not found") as Error & {
      httpStatus: number;
      name: string;
    };
    err.httpStatus = 404;
    err.name = "ObjectNotFound";
    return err;
  };

  const getCol = (name: string): FakeCollection => {
    const c = state.collections.get(name);
    if (!c) throw notFound();
    return c;
  };

  const documentsForId = (name: string, id: string) => ({
    delete: async () => {
      const col = getCol(name);
      if (!col.docs.has(id)) throw notFound();
      col.docs.delete(id);
      return { id };
    },
  });

  const documentsNoId = (name: string) => ({
    upsert: async (doc: Record<string, unknown>) => {
      const col = getCol(name);
      col.docs.set(String(doc.id), doc);
      return doc;
    },
    import: async (docs: Array<Record<string, unknown>>) => {
      const col = getCol(name);
      const results: Array<{ success: boolean }> = [];
      for (const d of docs) {
        col.docs.set(String(d.id), d);
        results.push({ success: true });
      }
      return results;
    },
    search: async (params: Record<string, unknown>) => {
      const col = getCol(name);
      const all = [...col.docs.values()];
      const q = (params.q as string) ?? "*";
      const perPage = (params.per_page as number) ?? 10;
      const page = (params.page as number) ?? 1;
      const queryBy = ((params.query_by as string) ?? "").split(",").filter(Boolean);

      let hits = all;
      if (q && q !== "*") {
        const needle = q.toLowerCase();
        hits = all.filter((d) =>
          queryBy.some((f) =>
            String(d[f] ?? "")
              .toLowerCase()
              .includes(needle),
          ),
        );
      }

      // filter_by: support `fieldName:>N` and `fieldName:<N` for numeric
      // fields so our date-range integration coverage has something.
      const filter = params.filter_by as string | undefined;
      if (filter) {
        const match = filter.match(/(\w+):([<>=]+)(-?\d+)/);
        if (match) {
          const [, field, op, valueStr] = match;
          const value = Number(valueStr);
          hits = hits.filter((d) => {
            const dv = Number(d[field]);
            if (op === ">") return dv > value;
            if (op === "<") return dv < value;
            if (op === ">=") return dv >= value;
            if (op === "<=") return dv <= value;
            if (op === ":=" || op === "=") return dv === value;
            return true;
          });
        }
      }

      const total = hits.length;
      const paged = hits.slice((page - 1) * perPage, page * perPage);
      return {
        hits: paged.map((d) => ({ document: d, highlights: {} })),
        found: total,
        out_of: all.length,
        search_time_ms: 1,
      };
    },
  });

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
          const col = getCol(name);
          return col.schema;
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
