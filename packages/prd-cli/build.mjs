// esbuild 打包 → dist/cli.js (prd)
// S12 起仅产 cli.js；prd-mcp 在 S12 废弃，由 Claude Code Skill + bash → prd CLI 取代
import { build } from "esbuild";
import { chmodSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));

const COMMON = {
  bundle: true,
  format: "esm",
  platform: "node",
  target: "node20",
  external: ["node:*", "archiver", "cac", "open"],
  banner: { js: "#!/usr/bin/env node" },
  legalComments: "none",
  minify: false,
  sourcemap: false,
};

const targets = [{ entry: "src/cli.ts", out: "dist/cli.js" }];

for (const t of targets) {
  await build({
    ...COMMON,
    entryPoints: [resolve(__dirname, t.entry)],
    outfile: resolve(__dirname, t.out),
  });
  chmodSync(resolve(__dirname, t.out), 0o755);
  console.log(`[prd-cli] built ${t.out}`);
}
