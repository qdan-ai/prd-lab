import { createHash } from "node:crypto";
import { createWriteStream, mkdtempSync, rmSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
// archiver v8 类型滞后，运行时是 ZipArchive class（与 apps/main exports route 同 idiom）
// eslint-disable-next-line @typescript-eslint/no-explicit-any
import * as archiverMod from "archiver";
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const ZipArchive = (archiverMod as any).ZipArchive as new (
  format: string,
  opts?: { zlib?: { level?: number } },
) => {
  pipe: (s: NodeJS.WritableStream) => void;
  glob: (pattern: string, opts: Record<string, unknown>) => void;
  finalize: () => Promise<void>;
  on: (ev: "error", cb: (e: unknown) => void) => void;
};

/**
 * archiver zip 打包 + 流式 sha256。
 * 排除 node_modules / .git / .DS_Store / .tmp / dist；不跟随 symlink。
 */

const DEFAULT_IGNORE = [
  "**/node_modules/**",
  "**/.git/**",
  "**/.DS_Store",
  "**/.tmp",
  "**/.tmp/**",
  "**/dist/**",
  ".prdrc.json",
];

export interface PackResult {
  zipPath: string;
  sha256: string;
  size: number;
  /** 调用方应用完毕后调用此函数清理 tmp zip */
  cleanup: () => void;
}

export async function packDirectoryToZip(
  sourceDir: string,
  extraIgnore: string[] = [],
): Promise<PackResult> {
  const absSource = resolve(sourceDir);
  const tmpDir = mkdtempSync(join(tmpdir(), "prd-cli-pack-"));
  const zipPath = join(tmpDir, "snapshot.zip");

  await new Promise<void>((resolveFn, rejectFn) => {
    const output = createWriteStream(zipPath);
    const archive = new ZipArchive("zip", { zlib: { level: 9 } });
    output.on("close", () => resolveFn());
    output.on("error", rejectFn);
    archive.on("error", rejectFn);
    archive.pipe(output);
    archive.glob("**/*", {
      cwd: absSource,
      ignore: [...DEFAULT_IGNORE, ...extraIgnore],
      dot: false,
      follow: false,
      nodir: false,
    });
    void archive.finalize();
  });

  const buf = await readFile(zipPath);
  const sha256 = createHash("sha256").update(buf).digest("hex");

  return {
    zipPath,
    sha256,
    size: buf.length,
    cleanup: () => {
      try {
        rmSync(tmpDir, { recursive: true, force: true });
      } catch {
        // ignore
      }
    },
  };
}

/** 对内容稳定的目录，两次打包 sha256 一致（archiver 默认按文件名排序）。 */
