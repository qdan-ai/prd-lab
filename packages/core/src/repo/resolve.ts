/**
 * 访客打开仓库时落到哪一版：默认规则与 `?v=` 解析。纯函数，主站分享跳转、预览站外壳、
 * repo.json 共用。
 *
 * 默认：上线版本（未撤回）→ 主线最新封版 → 草稿 → null（空仓库）。
 * `?v=<版本号>`：在未撤回的版本 / 基线里按版本号匹配（忽略大小写与开头的 v），同号取封版最新；
 * `?v=draft` 指草稿。找不到落到默认版本，并给出 notice 供查看器提示。
 */

export const MAIN_LINE = "main";

export type ResolvableVersion = {
  key: string;
  kind: "version" | "baseline";
  number: string | null;
  line: string | null;
  sealedAt: Date | null;
  createdAt: Date;
  withdrawn: boolean;
};

export type ResolveInput = {
  /** 版本与基线，含已撤回的（用来区分「已撤回」与「没有这个号」） */
  versions: ReadonlyArray<ResolvableVersion>;
  draft: { key: string } | null;
  onlineKey: string | null;
};

export type ResolveNotice = {
  reason: "not_found" | "withdrawn";
  requested: string;
  /** 实际打开的版本 key 与版本号（落到草稿时号为 null） */
  openedKey: string | null;
  openedNumber: string | null;
};

export type ResolveResult = { key: string | null; notice: ResolveNotice | null };

function normalizeNumber(s: string): string {
  return s.trim().toLowerCase().replace(/^v/, "");
}

/** 封版时间新的排前；并列时后推上来的排前。 */
function newestFirst(a: ResolvableVersion, b: ResolvableVersion): number {
  const sa = a.sealedAt?.getTime() ?? -Infinity;
  const sb = b.sealedAt?.getTime() ?? -Infinity;
  if (sa !== sb) return sb - sa;
  return b.createdAt.getTime() - a.createdAt.getTime();
}

export function defaultVersionKey(input: ResolveInput): string | null {
  const visible = input.versions.filter((v) => !v.withdrawn);
  if (input.onlineKey && visible.some((v) => v.key === input.onlineKey)) return input.onlineKey;
  const main = visible.filter((v) => v.line === MAIN_LINE).sort(newestFirst);
  if (main[0]) return main[0].key;
  return input.draft?.key ?? null;
}

export function resolveRepoVersion(input: ResolveInput, requested: string | null | undefined): ResolveResult {
  const fallback = defaultVersionKey(input);
  if (requested === undefined || requested === null || requested.trim() === "") {
    return { key: fallback, notice: null };
  }
  const want = normalizeNumber(requested);

  if (want === "draft" && input.draft) return { key: input.draft.key, notice: null };

  const matches = input.versions.filter((v) => v.number !== null && normalizeNumber(v.number) === want);
  const hit = matches.filter((v) => !v.withdrawn).sort(newestFirst)[0];
  if (hit) return { key: hit.key, notice: null };

  const opened = input.versions.find((v) => v.key === fallback) ?? null;
  return {
    key: fallback,
    notice: {
      reason: matches.length > 0 ? "withdrawn" : "not_found",
      requested,
      openedKey: fallback,
      openedNumber: opened?.number ?? null,
    },
  };
}
