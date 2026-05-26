import os from "node:os";
import { redirect } from "next/navigation";
import { Cpu, Lock, ShieldCheck } from "lucide-react";
import { generateApiToken } from "@prd-lab/core";
import { apiTokens, db } from "@prd-lab/core";
import { auth } from "@/auth";
import { Button } from "@/components/ui/button";

/**
 * /cli/auth —— CLI OAuth 授权页
 *
 * 流程：
 * 1. CLI 启本地 :8765±10 + 浏览器打开 /cli/auth?cb=http://127.0.0.1:<port>/callback&state=<nonce>
 * 2. SSR 校 cb（host whitelist 127.0.0.1 / localhost）+ state 必填
 * 3. 未登入 redirect /login?callbackUrl=/cli/auth?...
 * 4. 已登入 渲染卡片 + 授权按钮（server action）
 * 5. server action：建 api_token + 302 to <cb>?token=<plain>&state=<state>
 */

type SearchParams = Promise<{ cb?: string; state?: string; client?: string }>;

function validateCallback(cbRaw: string | undefined): URL | null {
  if (!cbRaw) return null;
  let url: URL;
  try {
    url = new URL(cbRaw);
  } catch {
    return null;
  }
  if (url.protocol !== "http:" && url.protocol !== "https:") return null;
  if (url.hostname !== "127.0.0.1" && url.hostname !== "localhost") return null;
  return url;
}

export default async function CliAuthPage({ searchParams }: { searchParams: SearchParams }) {
  const params = await searchParams;
  const cb = validateCallback(params.cb);
  const state = params.state?.trim();

  if (!cb || !state) {
    return (
      <main className="min-h-screen flex items-center justify-center bg-ink-50 px-4">
        <div className="w-full max-w-[420px] bg-white border border-ink-200 rounded-[var(--radius-lg)] p-6 shadow-[var(--shadow-sm)]">
          <h1 className="text-[16px] font-semibold text-ink-900 mb-2">参数无效</h1>
          <p className="text-[13px] text-ink-600">
            CLI 授权链接必须含合法的 <code className="font-mono text-[12px]">cb</code>{" "}
            (127.0.0.1 / localhost) 与 <code className="font-mono text-[12px]">state</code> 参数。
          </p>
          <p className="text-[12px] text-ink-500 mt-3">
            请回终端重新跑 <code className="font-mono">prd login</code>。
          </p>
        </div>
      </main>
    );
  }

  const session = await auth();
  if (!session?.user?.id || !session.user.name) {
    const back = `/cli/auth?cb=${encodeURIComponent(cb.toString())}&state=${encodeURIComponent(state)}`;
    redirect(`/login?callbackUrl=${encodeURIComponent(back)}`);
  }

  // CLI 端传 ?client=<os.hostname()>；缺省回退到 server hostname（旧 CLI 兼容）
  const clientHostname = (params.client ?? "").trim() || os.hostname() || "unknown-host";
  const tokenName = `CLI on ${clientHostname}`;
  const userId = session.user.id;
  const userName = session.user.name;

  async function approve() {
    "use server";
    if (!cb || !state) return;
    const generated = generateApiToken();
    await db.insert(apiTokens).values({
      userId,
      name: tokenName,
      tokenHash: generated.hash,
      tokenPrefix: generated.prefix,
    });
    const target = new URL(cb.toString());
    target.searchParams.set("token", generated.plain);
    target.searchParams.set("state", state);
    redirect(target.toString());
  }

  return (
    <main className="min-h-screen flex items-center justify-center bg-ink-50 px-4">
      <div className="w-full max-w-[440px]">
        <div className="text-center mb-6">
          <div className="inline-flex items-center justify-center w-11 h-11 rounded-[var(--radius-md)] bg-ink-900 text-ink-50 mb-3 shadow-[var(--shadow-sm)]">
            <Cpu size={20} strokeWidth={2.25} />
          </div>
          <h1 className="text-[20px] font-semibold tracking-tight text-ink-900">授权 CLI 访问</h1>
          <p className="text-[13px] text-ink-500 mt-1">
            登入身份：<span className="font-medium text-ink-700">{userName}</span>
          </p>
        </div>

        <div className="bg-white border border-ink-200 rounded-[var(--radius-lg)] shadow-[var(--shadow-sm)] p-5">
          <div className="text-[13px] text-ink-700 leading-relaxed mb-4">
            <p className="mb-2">
              即将创建 API token：<span className="font-medium">{tokenName}</span>
            </p>
            <p className="text-ink-500 text-[12px]">
              回调地址：
              <code className="font-mono text-[11px] bg-ink-100 px-1.5 py-0.5 rounded ml-1">
                {cb.toString()}
              </code>
            </p>
          </div>

          <div className="text-[12px] text-[color:var(--color-warning)] bg-[color:var(--color-warning-bg)] rounded-[var(--radius-sm)] px-3 py-2 mb-4 leading-relaxed">
            授予 token 等同于您的账户权限。仅在受信终端运行 <code className="font-mono">prd login</code>
            时点击授权。
          </div>

          <form action={approve}>
            <Button type="submit" size="lg" className="w-full">
              授权并返回 CLI
            </Button>
          </form>

          <div className="flex items-center gap-3 text-[11px] text-ink-500 mt-4 pt-4 border-t border-ink-150">
            <span className="inline-flex items-center gap-1">
              <ShieldCheck size={11} strokeWidth={2.25} className="text-ink-400" />
              token 落盘 ~/.prdrc (0600)
            </span>
            <span className="text-ink-300">·</span>
            <span className="inline-flex items-center gap-1">
              <Lock size={11} strokeWidth={2.25} className="text-ink-400" />
              可在 prd auth list/revoke 管理
            </span>
          </div>
        </div>
      </div>
    </main>
  );
}
