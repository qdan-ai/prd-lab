import type { ApiError } from "@/lib/api-client";

export function accountErrorMessage(error: unknown): string {
  const e = error as Partial<ApiError> | null;
  const labels: Record<string, string> = {
    name_taken: "该姓名已被使用，请换一个姓名", email_taken: "该邮箱已被使用，请换一个邮箱",
    invalid_name: "姓名需为 1–64 个字符，且不能包含 @", invalid_email: "请输入有效的邮箱地址",
    invalid_password: "密码至少 6 个字符，且 UTF-8 长度不超过 72 字节",
    password_mismatch: "两次输入的密码不一致", current_password_invalid: "当前密码不正确",
    current_password_required: "请输入当前密码", unauthorized: "登录已失效，请重新登录",
    not_admin: "当前账号没有用户管理权限", not_found: "该账号已不存在，请刷新列表",
    cannot_reset_self: "请在个人资料中修改自己的密码",
    authentication_unavailable: "账户服务暂时不可用（503），请稍后重试",
  };
  return labels[e?.message ?? ""] ?? labels[e?.error_code ?? ""] ?? "操作未完成，请检查网络后重试；如已提交，请先刷新确认结果";
}

export function personalPasswordError(password: string, confirmation: string): string | null {
  if ([...password].length < 6 || new TextEncoder().encode(password).length > 72) return accountErrorMessage({ message: "invalid_password" });
  if (password !== confirmation) return accountErrorMessage({ message: "password_mismatch" });
  return null;
}
