import { createHash } from "node:crypto";
import iconv from "iconv-lite";
import yauzl from "yauzl";

/** Zip 解包硬限（docs/03 §6.1） */
export const ZIP_LIMITS = {
  maxZipBytes: 50 * 1024 * 1024,
  maxUnpackedBytes: 200 * 1024 * 1024,
  maxFileBytes: 20 * 1024 * 1024,
  maxFileCount: 500,
} as const;

export type ZipFile = {
  relPath: string;
  contentType: string;
  sizeBytes: number;
  sha256: string;
  buffer: Buffer;
};

export type ParseZipResult = {
  files: ZipFile[];
  zipSha256: string;
  totalUnpackedBytes: number;
};

export type ParseZipError =
  | { code: "zip_too_large"; size: number }
  | { code: "too_many_files"; count: number }
  | { code: "file_too_large"; relPath: string; size: number }
  | { code: "unpacked_too_large"; totalSize: number }
  | { code: "zip_slip"; relPath: string }
  | { code: "invalid_zip"; message: string };

/**
 * 解包 + 校验 zip。
 * - ZipSlip 拒：rel_path 含 `..`、绝对路径 `/`、Windows 盘符 `C:`、反斜杠 `\\`
 * - 跳过 macOS 噪音：`__MACOSX/`、`.DS_Store`
 */
export async function parseAndValidateZip(
  buffer: Buffer,
): Promise<{ ok: true; result: ParseZipResult } | { ok: false; error: ParseZipError }> {
  if (buffer.byteLength > ZIP_LIMITS.maxZipBytes) {
    return { ok: false, error: { code: "zip_too_large", size: buffer.byteLength } };
  }
  const zipSha256 = createHash("sha256").update(buffer).digest("hex");

  return new Promise((resolve) => {
    yauzl.fromBuffer(buffer, { lazyEntries: true, decodeStrings: false }, (err, zipfile) => {
      if (err || !zipfile) {
        resolve({ ok: false, error: { code: "invalid_zip", message: err?.message ?? "unknown" } });
        return;
      }

      const files: ZipFile[] = [];
      let totalUnpackedBytes = 0;
      let aborted = false;

      const finish = (
        outcome: { ok: true; result: ParseZipResult } | { ok: false; error: ParseZipError },
      ) => {
        if (aborted) return;
        aborted = true;
        zipfile.close();
        resolve(outcome);
      };

      zipfile.on("error", (e) => {
        finish({ ok: false, error: { code: "invalid_zip", message: e.message } });
      });

      zipfile.on("end", () => {
        const normalized = stripSingleTopLevelDir(files);
        finish({ ok: true, result: { files: normalized, zipSha256, totalUnpackedBytes } });
      });

      zipfile.on("entry", (entry: yauzl.Entry) => {
        if (aborted) return;
        // decodeStrings:false → entry.fileName 是 Buffer。按 general purpose bit 11 判断 UTF-8/GBK。
        const relPath = decodeEntryName(
          entry.fileName as unknown as Buffer,
          entry.generalPurposeBitFlag,
        );
        // 目录跳过
        if (/\/$/.test(relPath)) {
          zipfile.readEntry();
          return;
        }

        // ZipSlip：拒 `..` 段 / 绝对路径 / Windows 盘符 / 反斜杠
        if (
          relPath.includes("..") ||
          relPath.startsWith("/") ||
          /^[A-Za-z]:/.test(relPath) ||
          relPath.includes("\\")
        ) {
          finish({ ok: false, error: { code: "zip_slip", relPath } });
          return;
        }

        // macOS 噪音跳过
        if (relPath.startsWith("__MACOSX/") || relPath.endsWith("/.DS_Store") || relPath === ".DS_Store") {
          zipfile.readEntry();
          return;
        }

        if (entry.uncompressedSize > ZIP_LIMITS.maxFileBytes) {
          finish({
            ok: false,
            error: { code: "file_too_large", relPath, size: entry.uncompressedSize },
          });
          return;
        }

        if (files.length + 1 > ZIP_LIMITS.maxFileCount) {
          finish({ ok: false, error: { code: "too_many_files", count: files.length + 1 } });
          return;
        }

        if (totalUnpackedBytes + entry.uncompressedSize > ZIP_LIMITS.maxUnpackedBytes) {
          finish({
            ok: false,
            error: {
              code: "unpacked_too_large",
              totalSize: totalUnpackedBytes + entry.uncompressedSize,
            },
          });
          return;
        }

        zipfile.openReadStream(entry, (streamErr, stream) => {
          if (streamErr || !stream) {
            finish({
              ok: false,
              error: { code: "invalid_zip", message: streamErr?.message ?? "stream error" },
            });
            return;
          }
          const chunks: Buffer[] = [];
          stream.on("data", (c: Buffer) => chunks.push(c));
          stream.on("end", () => {
            const fileBuf = Buffer.concat(chunks);
            const sha256 = createHash("sha256").update(fileBuf).digest("hex");
            files.push({
              relPath,
              contentType: sniffContentType(relPath),
              sizeBytes: fileBuf.byteLength,
              sha256,
              buffer: fileBuf,
            });
            totalUnpackedBytes += fileBuf.byteLength;
            zipfile.readEntry();
          });
          stream.on("error", (e) => {
            finish({ ok: false, error: { code: "invalid_zip", message: e.message } });
          });
        });
      });

      zipfile.readEntry();
    });
  });
}

/**
 * 解码 zip 文件名 Buffer。
 *
 * ZIP 规范的 general purpose bit 11 = 1 表示文件名是 UTF-8；否则历史上为 CP437，
 * 实际上中国大陆 Windows 压缩工具（WinRAR / 资源管理器 / 部分 7-Zip）行为不统一：
 * - 多数 Windows 自带压缩：GBK/CP936 且 bit 11=0
 * - 部分 7-Zip 中文版 / 跨平台工具：UTF-8 但仍 bit 11=0
 * - 极端情况：同 zip 内不同 entry 编码不一致（多工具合成）
 *
 * 策略（per-entry 智能识别）：
 * 1. bit 11=1 → 直接 UTF-8（zip spec 强制）
 * 2. bit 11=0 → 先 fatal UTF-8 探测：合法 UTF-8 字节流必然通过；GBK 字节流几乎必然失败
 *    （GBK lead byte 0x81-0xC1 / 0xF0-0xFE 不是 UTF-8 合法 lead）
 * 3. fatal UTF-8 失败 → 按 GBK 解码（中文 Windows 最常见编码）
 *
 * 纯 ASCII 文件名两种解码都得相同结果，无副作用。
 */
function decodeEntryName(raw: Buffer, generalPurposeBitFlag: number): string {
  if ((generalPurposeBitFlag & 0x0800) !== 0) {
    return raw.toString("utf8");
  }
  try {
    return new TextDecoder("utf-8", { fatal: true }).decode(raw);
  } catch {
    return iconv.decode(raw, "gbk");
  }
}

/**
 * 若所有文件共用同一顶层目录前缀（macOS Finder "压缩"、`zip -r foo foo/`、git zipball 等），
 * 剥掉这层，让下游 detectEntryMode 看到规范化的根布局。
 * 单文件、已扁平、多顶层目录 zip 均原样返回。
 */
function stripSingleTopLevelDir(files: ZipFile[]): ZipFile[] {
  if (files.length === 0) return files;
  const firstSlash = files[0]!.relPath.indexOf("/");
  if (firstSlash < 0) return files; // 第一个文件已在根
  const prefix = files[0]!.relPath.slice(0, firstSlash + 1); // 含末尾 "/"
  for (const f of files) {
    if (!f.relPath.startsWith(prefix)) return files; // 任一不匹配 → 放弃 strip
  }
  const stripped = files.map((f) => ({ ...f, relPath: f.relPath.slice(prefix.length) }));
  if (stripped.some((f) => f.relPath === "")) return files; // 兜底：理论不触发（目录条目已 skip）
  return stripped;
}

/** 从 rel_path 后缀推断 content-type（最佳实践：白名单 + 默认 octet-stream） */
function sniffContentType(relPath: string): string {
  const ext = relPath.split(".").pop()?.toLowerCase() ?? "";
  const map: Record<string, string> = {
    html: "text/html; charset=utf-8",
    htm: "text/html; charset=utf-8",
    js: "application/javascript; charset=utf-8",
    mjs: "application/javascript; charset=utf-8",
    css: "text/css; charset=utf-8",
    json: "application/json; charset=utf-8",
    svg: "image/svg+xml",
    png: "image/png",
    jpg: "image/jpeg",
    jpeg: "image/jpeg",
    gif: "image/gif",
    webp: "image/webp",
    ico: "image/x-icon",
    woff: "font/woff",
    woff2: "font/woff2",
    ttf: "font/ttf",
    txt: "text/plain; charset=utf-8",
    md: "text/markdown; charset=utf-8",
  };
  return map[ext] ?? "application/octet-stream";
}

// ---- 入口探测 ----

export type EntryMode =
  | { mode: "bare-html"; entryHtml: string }
  | { mode: "multi-html-candidates"; candidates: string[] }
  | { mode: "no-html-entry" };

export function detectEntryMode(files: ZipFile[]): EntryMode {
  const rootHtmls = files.filter((f) => !f.relPath.includes("/") && f.relPath.endsWith(".html"));
  const hasIndex = rootHtmls.some((f) => f.relPath === "index.html");

  if (rootHtmls.length === 1) {
    return { mode: "bare-html", entryHtml: rootHtmls[0]!.relPath };
  }
  if (hasIndex) {
    return { mode: "bare-html", entryHtml: "index.html" };
  }
  if (rootHtmls.length === 0) {
    return { mode: "no-html-entry" };
  }
  return { mode: "multi-html-candidates", candidates: rootHtmls.map((f) => f.relPath) };
}
