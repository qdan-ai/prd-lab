import { readFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
// archiver v8 类型滞后，运行时是 ZipArchive class（与 apps/main exports route 同 idiom）
// eslint-disable-next-line @typescript-eslint/no-explicit-any
import * as archiverMod from "archiver";
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const ZipArchive = (archiverMod as any).ZipArchive as new (opts?: {
  zlib?: { level?: number };
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
}) => any;
import { getSession } from "@/lib/api/auth-guard";
import { errorResponse } from "@/lib/api/errors";

export const runtime = "nodejs";

/**
 * GET /api/v1/skill
 *
 * 下发 PRD-Lab Publish Skill 的 zip 包（含 SKILL.md / README.md / examples.md / version.txt）。
 * SKILL.md / examples.md 内的 {{ENDPOINT}} 占位符替换为请求时的主站 origin，让用户下载的
 * Skill 默认就指向他刚才访问的主站（无需手改）。
 *
 * 鉴权：需登入（防爬虫；普通 PM 也只需点一下设置页按钮就能下载）。
 */
export async function GET(request: Request) {
  const session = await getSession();
  if (!session) return errorResponse("unauthorized");

  const url = new URL(request.url);
  const endpoint = url.origin;

  // route.ts 位置 apps/main/app/api/v1/skill/route.ts；模板位置 apps/main/lib/skill-template/
  // 用 import.meta.url 反算 __dirname，避免 process.cwd() 在测试 / Next standalone build 下不一致
  const here = dirname(fileURLToPath(import.meta.url));
  const templateDir = join(here, "..", "..", "..", "..", "lib", "skill-template");
  const [skillRaw, readmeRaw, examplesRaw, versionRaw] = await Promise.all([
    readFile(join(templateDir, "SKILL.md"), "utf8"),
    readFile(join(templateDir, "README.md"), "utf8"),
    readFile(join(templateDir, "examples.md"), "utf8"),
    readFile(join(templateDir, "version.txt"), "utf8"),
  ]);

  const skillMd = skillRaw.replaceAll("{{ENDPOINT}}", endpoint);
  const examplesMd = examplesRaw.replaceAll("{{ENDPOINT}}", endpoint);

  const archive = new ZipArchive({ zlib: { level: 9 } });
  const chunks: Buffer[] = [];

  const zipBuffer = await new Promise<Buffer>((resolveP, rejectP) => {
    archive.on("data", (c: Buffer) => chunks.push(c));
    archive.on("end", () => resolveP(Buffer.concat(chunks)));
    archive.on("error", (e: Error) => rejectP(e));

    archive.append(Buffer.from(skillMd, "utf8"), { name: "prd-publish/SKILL.md" });
    archive.append(Buffer.from(readmeRaw, "utf8"), { name: "prd-publish/README.md" });
    archive.append(Buffer.from(examplesMd, "utf8"), { name: "prd-publish/examples.md" });
    archive.append(Buffer.from(versionRaw, "utf8"), { name: "prd-publish/version.txt" });

    archive.finalize().catch(rejectP);
  });

  return new Response(new Uint8Array(zipBuffer), {
    status: 200,
    headers: {
      "Content-Type": "application/zip",
      "Content-Disposition": `attachment; filename="prd-publish-skill.zip"`,
      "Content-Length": String(zipBuffer.length),
    },
  });
}
