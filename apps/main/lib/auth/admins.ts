/**
 * 管理员名单（env 提权，仿 S15 共享密码）。
 *
 * env `AUTH_ADMIN_NAMES`：逗号分隔的登入姓名，如 `张三,李四`。
 * 登入姓名命中名单即为管理员，可管理所有 team 项目（增删改查）。
 *
 * 注意语义与 verifySharedPassword 相反：
 * 共享密码「空 = 豁免」，管理员名单「空 = 无人是管理员」（安全默认）。
 */

/**
 * 解析逗号名单：trim 去空，保留原大小写。
 * 注意：分隔符是**半角逗号 `,`**（全角 `，` 不识别）；姓名本身含逗号者无法作为管理员
 * （会被拆段，匹配不上完整名）——这是 fail-closed（匹配不上 = 不提权），安全但需运维知晓。
 */
export function parseAdminNames(raw: string | undefined): string[] {
  if (!raw) return [];
  return raw
    .split(",")
    .map((s) => s.trim())
    .filter((s) => s.length > 0);
}

/**
 * name 是否命中管理员名单。
 * - 空名单恒 false（无人是管理员）
 * - 两侧 trim + 大小写不敏感（兼容英文名）
 * - 第二参可显式注入，便于单测脱离 process.env
 */
export function isAdminName(
  name: string | null | undefined,
  raw = process.env.AUTH_ADMIN_NAMES,
): boolean {
  if (!name) return false;
  const list = parseAdminNames(raw);
  if (list.length === 0) return false;
  const target = name.trim().toLowerCase();
  return list.some((n) => n.toLowerCase() === target);
}
