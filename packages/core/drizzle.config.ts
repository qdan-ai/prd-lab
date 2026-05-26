import type { Config } from "drizzle-kit";

export default {
  schema: "./src/db/schema.ts",
  out: "./drizzle",
  dialect: "mysql",
  dbCredentials: {
    url: process.env.DATABASE_URL ?? "mysql://prdlab:prdlab@localhost:5433/prdlab",
  },
  strict: true,
  verbose: true,
} satisfies Config;
