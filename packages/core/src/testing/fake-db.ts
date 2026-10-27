/**
 * Test double for drizzle's chainable query builder, for unit tests that must not touch MySQL.
 *
 * Every awaited chain (`db.select(...).from(...).where(...).limit(1)`, `tx.update(...).set(...).where(...)`)
 * resolves to the next entry of `results`, in call order; an `Error` entry rejects instead.
 * `transaction(work)` runs `work` with the same double. `calls` records every builder method and its arguments.
 */
export type FakeDb = {
  db: any;
  calls: Array<{ method: string; args: unknown[] }>;
  /** Arguments of every `.set(...)` call (UPDATE values), in order. */
  sets: () => Array<Record<string, unknown>>;
  /** Arguments of every `.values(...)` call (INSERT values), in order. */
  inserts: () => Array<Record<string, unknown>>;
  /** Results not consumed yet. */
  pending: () => number;
};

export function fakeDb(results: unknown[] = []): FakeDb {
  const queue = [...results];
  const calls: FakeDb["calls"] = [];
  const next = () => {
    if (queue.length === 0) return Promise.reject(new Error("fakeDb: no queued result for this query"));
    const value = queue.shift();
    return value instanceof Error ? Promise.reject(value) : Promise.resolve(value);
  };
  const chain = (): any =>
    new Proxy(() => {}, {
      get(_target, prop) {
        if (prop === "then") {
          const result = next();
          return (resolve: (v: unknown) => unknown, reject: (e: unknown) => unknown) => result.then(resolve, reject);
        }
        return (...args: unknown[]) => {
          calls.push({ method: String(prop), args });
          return chain();
        };
      },
    });
  const db: any = new Proxy(
    {},
    {
      get(_target, prop) {
        if (prop === "transaction") return (work: (tx: unknown) => unknown) => work(db);
        if (prop === "then") return undefined;
        return (...args: unknown[]) => {
          calls.push({ method: String(prop), args });
          return chain();
        };
      },
    },
  );
  const argsOf = (method: string) =>
    calls.filter((c) => c.method === method).map((c) => c.args[0] as Record<string, unknown>);
  return { db, calls, sets: () => argsOf("set"), inserts: () => argsOf("values"), pending: () => queue.length };
}
