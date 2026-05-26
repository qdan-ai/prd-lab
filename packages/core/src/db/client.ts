import { drizzle, type MySql2Database } from "drizzle-orm/mysql2";
import mysql from "mysql2/promise";
import * as schema from "./schema";

type Db = MySql2Database<typeof schema>;

let _db: Db | null = null;
let _pool: mysql.Pool | null = null;

function getDatabaseUrl(): string {
  const url = process.env.DATABASE_URL;
  if (!url) {
    throw new Error(
      "DATABASE_URL is not set. Check .env or docker-compose environment.",
    );
  }
  return url;
}

export function getDb(): Db {
  if (_db) return _db;
  _pool = mysql.createPool({
    uri: getDatabaseUrl(),
    connectionLimit: 10,
    timezone: "Z",
    dateStrings: false,
  });
  _db = drizzle(_pool, { schema, mode: "default" }) as unknown as Db;
  return _db;
}

export const db = new Proxy({} as Db, {
  get(_target, prop, receiver) {
    return Reflect.get(getDb(), prop, receiver);
  },
});

export async function closeDb(): Promise<void> {
  if (_pool) {
    await _pool.end();
    _pool = null;
    _db = null;
  }
}
