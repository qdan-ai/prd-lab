"use client";

import { useState } from "react";
import { toast } from "sonner";
import { Check, ChevronDown, ChevronRight, Copy, Sparkles, Terminal } from "lucide-react";
import { cn } from "@/lib/utils";

/**
 * 给小白看的"AI 调用上手指南"。
 * 5 步故事化引导：装 → 登入 → 自检 → 上传 → AI 实战。
 * 每步含解释 + 命令复制 + 常见报错排查。
 */
export function QuickstartGuide() {
  return (
    <section className="mt-6 bg-white border border-ink-200 rounded-[var(--radius-lg)] p-5">
      <header className="mb-4">
        <h2 className="text-[15px] font-medium text-ink-900 flex items-center gap-1.5">
          <Sparkles size={14} strokeWidth={2.25} className="text-ink-700" />
          4 步把 AI 接上来
        </h2>
        <p className="text-[12px] text-ink-500 mt-1 leading-relaxed">
          第一次跟着做约 5 分钟。开始前先核对下面三项前置：
        </p>
      </header>

      <ul className="mb-4 bg-ink-50 border border-ink-200 rounded-[var(--radius-md)] p-3 space-y-1.5">
        <Prereq label="装了 Node 20+">
          终端跑 <Code>node -v</Code> 验证。没装的话从{" "}
          <a
            href="https://nodejs.org/"
            target="_blank"
            rel="noreferrer"
            className="text-ink-900 underline underline-offset-2 hover:text-ink-700"
          >
            nodejs.org
          </a>{" "}
          下"LTS"版本一路下一步。
        </Prereq>
        <Prereq label="装了 pnpm 10">
          终端跑 <Code>pnpm -v</Code> 验证。没装的话跑{" "}
          <Code>npm install -g pnpm@10</Code>（用上面装的 Node 自带的 npm）。
        </Prereq>
        <Prereq label="本地已 git clone PRD-Lab 仓库">
          不确定就跑 <Code>cd ~/path/to/PRD-Lab && ls</Code> 看到{" "}
          <Code>apps/</Code>、<Code>packages/</Code> 就对了。
        </Prereq>
      </ul>

      <ol className="space-y-3">
        <Step
          n={1}
          title="装 prd 命令行工具"
          summary="一次性，3 行命令"
          body={
            <>
              <p className="text-[12px] text-ink-600 leading-relaxed mb-2">
                把 <Code>prd</Code> 装到全局，任意终端都能跑。
              </p>
              <Cmd>{`# 在 PRD-Lab 项目根目录下执行
pnpm install                                  # 首次需要
pnpm --filter @prd-lab/prd-cli build

# 软链到全局 PATH（二选一）：
# ① 免 sudo（推荐，若 ~/.local/bin 已在 PATH）
ln -sf "$(pwd)/packages/prd-cli/dist/cli.js" ~/.local/bin/prd
# ② 或装到 /usr/local/bin（需 sudo 密码）
sudo ln -sf "$(pwd)/packages/prd-cli/dist/cli.js" /usr/local/bin/prd

# 验证
prd --help`}</Cmd>
              <Tip>
                看到 <Code>prd/0.0.0</Code> 开头的帮助信息就是装好了。
              </Tip>
              <Tip>
                <strong>Windows 用户</strong>：用管理员 PowerShell 跑 <Code>New-Item</Code>{" "}
                软链 <Code>prd.cmd</Code> 到 System32；或者跳过软链，以后每次都用绝对路径调{" "}
                <Code>dist\cli.js</Code>。
              </Tip>
            </>
          }
        />

        <Step
          n={2}
          title="终端登入：prd login"
          summary={`浏览器点一下"授权"就完了`}
          body={
            <>
              <p className="text-[12px] text-ink-600 leading-relaxed mb-2">
                跑下面这行命令，会自动打开浏览器跳到本站的授权页：
              </p>
              <Cmd>{`prd login`}</Cmd>
              <ul className="text-[12px] text-ink-600 space-y-1 mt-2 list-disc pl-5">
                <li>
                  浏览器里点 <strong className="text-ink-900">"授权并返回 CLI"</strong> 按钮 → token 自动写入本机。
                </li>
                <li>
                  终端显示 <Code>[prd] 授权成功</Code> 就 OK 了。
                </li>
                <li className="text-ink-500">
                  没自动开浏览器？复制终端打印的那行授权链接，手动粘贴到浏览器打开即可。
                </li>
              </ul>
              <Tip>
                如果你是开发者在本机跑 <Code>pnpm dev:main</Code>（:3000）而非 nginx app.local：用{" "}
                <Code>prd login --endpoint http://localhost:3000</Code> 指向 dev 端口。
              </Tip>
            </>
          }
        />

        <Step
          n={3}
          title="自检：prd doctor"
          summary="三项 ✓ 就万事俱备"
          body={
            <>
              <p className="text-[12px] text-ink-600 leading-relaxed mb-2">
                跑自检命令，确认登入态、服务器连接、token 都正常：
              </p>
              <Cmd>{`prd doctor`}</Cmd>
              <p className="text-[12px] text-ink-600 leading-relaxed mt-2 mb-1">期望输出：</p>
              <pre className="px-3 py-2 bg-ink-100 rounded text-[11px] font-mono leading-relaxed text-ink-700">
                {`  ✓ ~/.prdrc 存在
  ✓ endpoint 可达 + token 有效
  ✓ 一切正常`}
              </pre>
              <Tip>
                自检挂在 <Code>endpoint 不可达</Code>？看 Step 2 的开发者提示——大概率是 dev 模式 endpoint 不对。
              </Tip>
            </>
          }
        />

        <Step
          n={4}
          title="装 Skill，跟 AI 说一句话就发版"
          summary="下载 Skill zip → 解压 → Claude Code 自动接管"
          body={
            <>
              <p className="text-[12px] text-ink-600 leading-relaxed mb-2">
                点{" "}
                <a
                  href="#skill-download"
                  className="text-ink-900 underline underline-offset-2 hover:text-ink-700"
                >
                  下方"Claude Code 接入"卡片
                </a>{" "}
                的<strong className="text-ink-900">"下载 Skill"</strong>按钮，按提示命令解压到{" "}
                <Code>~/.claude/skills/</Code>。然后
                <strong className="text-ink-900">完全退出并重启 Claude Code</strong>
                （首次新建 skills 目录必须重启 app 才会被扫描；之后改 skill 文件无需重启）。
                重启后开一条新对话，cd 到任意 demo 目录
                （例如 v0 / Lovable / Cursor 生成的项目根目录），跟 Claude 说：
              </p>
              <div className="bg-[color:var(--color-accent-bg)] border border-[color:var(--color-accent)]/30 rounded-[var(--radius-sm)] px-3 py-2 text-[12px] text-ink-800 leading-relaxed">
                "把这个 demo 推到 PRD-Lab，老板要看"
              </div>
              <p className="text-[12px] text-ink-600 leading-relaxed mt-2 mb-1.5">AI 会自动跑完这套流程并回你类似这样：</p>
              <div className="relative pl-7 px-3 py-2 bg-[color:var(--color-success-bg)] border border-[color:var(--color-success)]/30 rounded text-[11px] font-mono leading-relaxed text-ink-800 whitespace-pre-wrap">
                <Check
                  size={13}
                  strokeWidth={2.75}
                  className="absolute left-2.5 top-2.5 text-[color:var(--color-success)]"
                />
                {`已推送到 PRD-Lab！

  链接：http://101.96.194.178/share/abc123
  密码：458912

（密码仅显示这一次，建议私聊发老板不要群发）`}
              </div>
              <p className="text-[12px] text-ink-600 leading-relaxed mt-2">
                把链接和密码私信发给老板即可。回工作台按{" "}
                <kbd className="px-1 border border-ink-200 rounded text-[10px]">⌘K</kbd>{" "}
                搜项目名也能看到你刚发的版本。
              </p>
              <Tip>
                首次发版会让你选项目和方案，选完会自动记到当前目录的 <Code>.prdrc.json</Code>，下次同目录推送就跳过选择直接发。
              </Tip>
              <Tip>
                <strong>装好了 Skill 但 Claude 没反应？</strong> 检查三项：(1) 确认完全
                <strong>退出并重启</strong>了 Claude Code（不是新开对话，是杀进程重启）；
                (2) 解压后实际路径是 <Code>~/.claude/skills/prd-publish/SKILL.md</Code>，不是少一层；
                (3) 在 Claude Code 里直接打 <Code>/prd-publish</Code> 看 skill 是否能被手动调起——
                能就说明装上了，问题在触发文案；不能就是没装好。
              </Tip>
            </>
          }
        />
      </ol>

    </section>
  );
}

// ---------------- 子组件 ----------------

function Step({
  n,
  title,
  summary,
  body,
}: {
  n: number;
  title: string;
  summary: string;
  body: React.ReactNode;
}) {
  const [open, setOpen] = useState(n === 1);
  return (
    <li className="border border-ink-200 rounded-[var(--radius-md)] overflow-hidden">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="w-full flex items-center gap-2 px-3 py-2.5 text-left bg-white hover:bg-ink-50 transition-colors"
        aria-expanded={open}
      >
        <span
          className={cn(
            "w-5 h-5 rounded-full text-[11px] font-semibold flex items-center justify-center flex-shrink-0",
            open ? "bg-ink-900 text-ink-50" : "bg-ink-100 text-ink-700",
          )}
        >
          {n}
        </span>
        <div className="flex-1 min-w-0">
          <div className="text-[13px] font-medium text-ink-900">{title}</div>
          <div className="text-[11px] text-ink-500 mt-0.5">{summary}</div>
        </div>
        {open ? (
          <ChevronDown size={14} strokeWidth={2.25} className="text-ink-400" />
        ) : (
          <ChevronRight size={14} strokeWidth={2.25} className="text-ink-400" />
        )}
      </button>
      {open ? <div className="px-3 pb-3 pt-1 bg-ink-50/40">{body}</div> : null}
    </li>
  );
}

function Code({ children }: { children: React.ReactNode }) {
  return (
    <code className="font-mono text-[11px] bg-ink-100 px-1 py-px rounded text-ink-800">
      {children}
    </code>
  );
}

function Cmd({ children, lang }: { children: string; lang?: string }) {
  const [copied, setCopied] = useState(false);

  function copy() {
    void navigator.clipboard.writeText(children);
    setCopied(true);
    toast.success("已复制");
    setTimeout(() => setCopied(false), 1500);
  }

  return (
    <div className="relative group">
      <pre className="px-3 py-2 pr-9 bg-ink-100 rounded text-[11px] font-mono leading-relaxed text-ink-800 overflow-x-auto whitespace-pre">
        {children}
      </pre>
      <button
        type="button"
        onClick={copy}
        className="absolute top-1.5 right-1.5 inline-flex items-center justify-center w-6 h-6 rounded-[var(--radius-sm)] text-ink-500 hover:text-ink-900 hover:bg-white opacity-60 hover:opacity-100 transition-all"
        aria-label="复制"
        title={lang ? `复制 ${lang}` : "复制"}
      >
        {copied ? (
          <Check size={12} strokeWidth={2.5} className="text-[color:var(--color-success,#16a34a)]" />
        ) : (
          <Copy size={12} strokeWidth={2.25} />
        )}
      </button>
    </div>
  );
}

function Tip({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex items-start gap-1.5 mt-2 text-[11px] text-ink-600 leading-relaxed bg-ink-100/60 border border-ink-200 rounded-[var(--radius-sm)] px-2.5 py-1.5">
      <Terminal size={11} strokeWidth={2.5} className="text-ink-500 flex-shrink-0 mt-px" />
      <span>{children}</span>
    </div>
  );
}

function Prereq({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <li className="flex items-start gap-2 text-[12px] leading-relaxed">
      <span
        aria-hidden
        className="flex-shrink-0 mt-0.5 w-3.5 h-3.5 rounded-sm border border-ink-300 bg-white"
      />
      <div className="flex-1 min-w-0">
        <strong className="text-ink-900 font-medium">{label}</strong>
        <span className="text-ink-600"> — {children}</span>
      </div>
    </li>
  );
}
