"use client";

import { useState } from "react";
import { toast } from "sonner";
import { Bot, Check, Copy, Download } from "lucide-react";

/**
 * "Claude Code 接入"卡片：下载 Skill zip + 安装命令复制。
 *
 * 配套 `GET /api/v1/skill` 路由动态打包 zip（含 endpoint 占位符替换）。
 */
export function SkillDownloadCard() {
  const [copied, setCopied] = useState(false);
  const installCmd = "unzip -o prd-publish-skill.zip -d ~/.claude/skills/";

  function handleCopy() {
    navigator.clipboard.writeText(installCmd).then(() => {
      setCopied(true);
      toast.success("已复制安装命令");
      setTimeout(() => setCopied(false), 1500);
    });
  }

  return (
    <section
      id="skill-download"
      className="mt-6 bg-white border border-ink-200 rounded-[var(--radius-lg)] p-5 scroll-mt-6"
    >
      <header className="mb-4">
        <h2 className="text-[15px] font-medium text-ink-900 flex items-center gap-1.5">
          <Bot size={14} strokeWidth={2.25} className="text-ink-700" />
          Claude Code 接入
        </h2>
        <p className="text-[12px] text-ink-500 mt-1 leading-relaxed">
          下载一个指令文件装到 Claude Code，AI 就能"读懂"如何调本站。然后说一句"把这个 demo 推到 PRD-Lab"，
          AI 会自动打包、上传、生成带 6 位密码的分享链接给你。
        </p>
      </header>

      <div className="space-y-3">
        <a
          href="/api/v1/skill"
          download="prd-publish-skill.zip"
          className="inline-flex items-center gap-1.5 h-9 px-3 rounded-[var(--radius-md)] bg-ink-900 text-white text-[13px] font-medium hover:bg-ink-800 transition-colors"
        >
          <Download size={14} strokeWidth={2.25} />
          下载 Skill
        </a>

        <div>
          <p className="text-[12px] text-ink-600 mb-1.5">下载完用这行命令解压（已有同名目录会被覆盖，下次更新直接重下重解压即可）：</p>
          <div className="flex items-center gap-1.5 bg-ink-50 border border-ink-200 rounded-[var(--radius-md)] px-3 py-2">
            <code className="flex-1 text-[12px] font-mono text-ink-800 select-all">
              {installCmd}
            </code>
            <button
              type="button"
              onClick={handleCopy}
              className="inline-flex items-center justify-center h-7 w-7 rounded-[var(--radius-sm)] text-ink-500 hover:text-ink-900 hover:bg-ink-100 transition-colors"
              aria-label="复制安装命令"
            >
              {copied ? <Check size={13} strokeWidth={2.5} /> : <Copy size={13} strokeWidth={2.25} />}
            </button>
          </div>
        </div>

        <div className="bg-[color:var(--color-accent-bg)] border border-[color:var(--color-accent)]/30 rounded-[var(--radius-md)] px-3 py-2.5">
          <p className="text-[12px] text-ink-700 leading-relaxed">
            <strong className="text-ink-900">装完先验证</strong>：完全退出并重启 Claude Code（首次必须），开一条新对话，输入{" "}
            <code className="font-mono text-[11px] bg-white px-1 py-px rounded border border-ink-200">/prd-publish</code>{" "}
            看 skill 是否能被手动调起。能就说明装上了，不能就检查解压路径是否为{" "}
            <code className="font-mono text-[11px] bg-white px-1 py-px rounded border border-ink-200">~/.claude/skills/prd-publish/SKILL.md</code>。
          </p>
        </div>
      </div>
    </section>
  );
}
