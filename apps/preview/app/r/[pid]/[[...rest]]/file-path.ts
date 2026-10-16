import { hasParentSegment } from "@prd-lab/core/repo";

/**
 * `/r/:pid/v/:key/<路径>` 的路径是否不能接受：超长、有 `..` 段、有 `\`、有控制字符。
 * 只认整段 `..`：文件名里的连续点号（`方案...md`）照常可读，与推送时的路径规则一致。
 */
export function badFilePath(relPath: string): boolean {
  return (
    relPath.length > 1024 ||
    hasParentSegment(relPath) ||
    relPath.includes("\\") ||
    // eslint-disable-next-line no-control-regex
    /[\x00-\x1f]/.test(relPath)
  );
}
