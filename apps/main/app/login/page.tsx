import { redirect } from "next/navigation";
import { AuthError } from "next-auth";
import { Lock, ShieldCheck, Sparkles } from "lucide-react";
import { auth, signIn } from "@/auth";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

type SearchParams = Promise<{ callbackUrl?: string; error?: string }>;

function formatLoginError(code: string): string {
  switch (code) {
    case "credentials":
      return "登入失败：姓名或团队密码错误，请重试";
    default:
      return `登入失败：${code}`;
  }
}

export default async function LoginPage({
  searchParams,
}: {
  searchParams: SearchParams;
}) {
  const session = await auth();
  const params = await searchParams;
  const callbackUrl = params.callbackUrl ?? "/projects";
  const requirePassword = !!process.env.AUTH_SHARED_PASSWORD;

  if (session?.user?.id) redirect(callbackUrl);

  async function login(formData: FormData) {
    "use server";
    const name = String(formData.get("name") ?? "");
    const password = String(formData.get("password") ?? "");
    try {
      await signIn("credentials", { name, password, redirectTo: callbackUrl });
    } catch (e) {
      // signIn 成功后会抛 NEXT_REDIRECT control flow，必须 rethrow 才能完成跳转
      // 凭据错 / server action ID 失效 → AuthError 子类（CredentialsSignin 等），兜底回登录页带 error
      if (e instanceof AuthError) {
        redirect(`/login?error=credentials&callbackUrl=${encodeURIComponent(callbackUrl)}`);
      }
      throw e;
    }
  }

  return (
    <main className="min-h-screen flex items-center justify-center bg-ink-50 px-4">
      <div className="w-full max-w-[380px]">
        {/* Brand 区 */}
        <div className="text-center mb-6">
          <div className="inline-flex items-center justify-center w-11 h-11 rounded-[var(--radius-md)] bg-ink-900 text-ink-50 font-semibold text-[17px] mb-3 shadow-[var(--shadow-sm)]">
            P
          </div>
          <h1 className="text-[22px] font-semibold tracking-tight text-ink-900">
            PRD-Lab
          </h1>
          <p className="text-[13px] text-ink-500 mt-1">
            AI PM 方案 · 版本 · 协同评审
          </p>
        </div>

        {/* Card */}
        <div className="bg-white border border-ink-200 rounded-[var(--radius-lg)] shadow-[var(--shadow-sm)] p-5">
          <form action={login} className="flex flex-col gap-4">
            <div>
              <label
                htmlFor="login-name"
                className="block text-[12px] font-medium text-ink-700 mb-1.5"
              >
                你的姓名
              </label>
              <Input
                id="login-name"
                type="text"
                name="name"
                required
                minLength={1}
                maxLength={64}
                placeholder="张三 / 李四-业务线"
                autoFocus
              />
              <p className="text-[11px] text-ink-500 mt-1.5 leading-relaxed">
                内网小团队信任模型 · 重名请加部门后缀
              </p>
            </div>

            {requirePassword ? (
              <div>
                <label
                  htmlFor="login-password"
                  className="block text-[12px] font-medium text-ink-700 mb-1.5"
                >
                  团队密码
                </label>
                <Input
                  id="login-password"
                  type="password"
                  name="password"
                  required
                  placeholder="请向团队负责人索取"
                  autoComplete="current-password"
                />
                <p className="text-[11px] text-ink-500 mt-1.5 leading-relaxed">
                  团队统一登入密码 · 不同于个人密码
                </p>
              </div>
            ) : null}

            <Button type="submit" size="lg" className="w-full">
              进入工作台
            </Button>

            {params.error ? (
              <p
                role="alert"
                className="text-[12px] text-[color:var(--color-danger)] bg-[color:var(--color-danger-bg)] rounded-[var(--radius-sm)] px-3 py-2"
              >
                {formatLoginError(params.error)}
              </p>
            ) : null}
          </form>

          {/* Trust bar */}
          <div className="flex items-center gap-3 text-[11px] text-ink-500 mt-4 pt-4 border-t border-ink-150">
            <span className="inline-flex items-center gap-1">
              <ShieldCheck size={11} strokeWidth={2.25} className="text-ink-400" />
              内网部署
            </span>
            <span className="text-ink-300">·</span>
            <span className="inline-flex items-center gap-1">
              <Lock size={11} strokeWidth={2.25} className="text-ink-400" />
              数据不出墙
            </span>
            <span className="text-ink-300">·</span>
            <span className="inline-flex items-center gap-1">
              <Sparkles size={11} strokeWidth={2.25} className="text-ink-400" />
              AI 友好
            </span>
          </div>
        </div>

        <p className="text-center text-[11px] text-ink-400 mt-5 leading-relaxed">
          自动 upsert 用户 · {requirePassword ? "团队共享密码" : "无密码"} · session 7 天
        </p>
      </div>
    </main>
  );
}
