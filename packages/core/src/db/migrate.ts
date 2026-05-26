import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { drizzle } from "drizzle-orm/mysql2";
import { migrate } from "drizzle-orm/mysql2/migrator";
import mysql from "mysql2/promise";

// 从仓库根 .env 自动加载（最小解析器，避免引入 dotenv 依赖）
function loadEnvFile(): void {
  const candidates = [resolve(process.cwd(), "../../.env"), resolve(process.cwd(), ".env")];
  for (const path of candidates) {
    if (!existsSync(path)) continue;
    const txt = readFileSync(path, "utf8");
    for (const raw of txt.split("\n")) {
      const line = raw.trim();
      if (!line || line.startsWith("#")) continue;
      const eq = line.indexOf("=");
      if (eq < 0) continue;
      const k = line.slice(0, eq).trim();
      const v = line.slice(eq + 1).trim();
      if (!(k in process.env)) process.env[k] = v;
    }
    break;
  }
}

async function main() {
  loadEnvFile();
  const url = process.env.DATABASE_URL;
  if (!url) throw new Error("DATABASE_URL is required");
  const connection = await mysql.createConnection({
    uri: url,
    multipleStatements: true,
    timezone: "Z",
  });
  try {
    await migrate(drizzle(connection), { migrationsFolder: "./drizzle" });
    console.log("✓ migrations applied");
  } finally {
    await connection.end();
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
