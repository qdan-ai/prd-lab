"use client";

import { useState } from "react";
import useSWR from "swr";
import { toast } from "sonner";
import { Copy, KeyRound, Plus, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Dialog, DialogContent, DialogDescription, DialogTitle } from "@/components/ui/dialog";
import { apiFetch } from "@/lib/api-client";

interface TokenRow {
  id: string;
  name: string;
  tokenPrefix: string;
  scopes: string[];
  lastUsedAt: string | null;
  createdAt: string;
}

interface CreateResult {
  id: string;
  name: string;
  tokenPrefix: string;
  scopes: string[];
  createdAt: string;
  plainToken: string;
}

const TOKENS_KEY = "/api/v1/cli/tokens";

export function TokenManager() {
  const { data, isLoading, mutate } = useSWR<TokenRow[]>(TOKENS_KEY, (url: string) =>
    apiFetch<TokenRow[]>(url, { method: "GET" }),
  );
  const [creating, setCreating] = useState(false);
  const [newName, setNewName] = useState("");
  const [newSecret, setNewSecret] = useState<CreateResult | null>(null);
  const [revokingId, setRevokingId] = useState<string | null>(null);

  async function handleCreate() {
    const name = newName.trim();
    if (!name) {
      toast.error("请填 token 名称");
      return;
    }
    setCreating(true);
    try {
      const result = await apiFetch<CreateResult>(TOKENS_KEY, {
        method: "POST",
        body: JSON.stringify({ name }),
      });
      setNewSecret(result);
      setNewName("");
      await mutate();
    } catch {
      // apiFetch 已 toast，不重复
    } finally {
      setCreating(false);
    }
  }

  async function handleRevoke(id: string) {
    setRevokingId(null);
    try {
      await apiFetch<void>(`${TOKENS_KEY}/${id}`, { method: "DELETE" });
      toast.success("token 已撤销");
      await mutate();
    } catch {
      // apiFetch 已 toast
    }
  }

  function copyToClipboard(text: string) {
    void navigator.clipboard.writeText(text);
    toast.success("已复制到剪贴板");
  }

  return (
    <div>
      {/* 创建表单 */}
      <div className="flex items-center gap-2 mb-4">
        <Input
          placeholder="新 token 名称（如：CLI on macbook-pro）"
          value={newName}
          onChange={(e) => setNewName(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && !creating) void handleCreate();
          }}
          maxLength={128}
          disabled={creating}
          data-testid="token-name-input"
          className="flex-1 min-w-0"
        />
        <Button
          onClick={handleCreate}
          disabled={creating || !newName.trim()}
          size="md"
          data-testid="token-create-button"
          className="flex-shrink-0 whitespace-nowrap gap-1"
        >
          <Plus size={14} strokeWidth={2.25} />
          <span>创建 token</span>
        </Button>
      </div>

      {/* 列表 */}
      {isLoading ? (
        <div className="text-[12px] text-ink-500 py-6 text-center">加载中…</div>
      ) : !data || data.length === 0 ? (
        <div className="text-[12px] text-ink-500 py-8 text-center border border-dashed border-ink-200 rounded-[var(--radius-md)]">
          <KeyRound size={16} strokeWidth={2.25} className="mx-auto text-ink-300 mb-2" />
          尚未创建任何 token
        </div>
      ) : (
        <ul
          className="divide-y divide-ink-150 border border-ink-200 rounded-[var(--radius-md)] overflow-hidden"
          data-testid="token-list"
        >
          {data.map((t) => (
            <li
              key={t.id}
              className="flex items-center gap-3 px-3 py-2.5 bg-white hover:bg-ink-50 transition-colors"
              data-testid={`token-row-${t.id}`}
            >
              <KeyRound size={14} strokeWidth={2.25} className="text-ink-400 flex-shrink-0" />
              <div className="flex-1 min-w-0">
                <div className="text-[13px] font-medium text-ink-900 truncate">{t.name}</div>
                <div className="text-[11px] text-ink-500 mt-0.5">
                  <code className="font-mono">{t.tokenPrefix}…</code>
                  <span className="mx-2 text-ink-300">·</span>
                  上次使用：{t.lastUsedAt ? new Date(t.lastUsedAt).toLocaleString() : "从未"}
                  <span className="mx-2 text-ink-300">·</span>
                  创建于 {new Date(t.createdAt).toLocaleDateString()}
                </div>
              </div>
              <Button
                variant="ghost"
                size="sm"
                onClick={() => setRevokingId(t.id)}
                aria-label={`撤销 ${t.name}`}
                title="撤销"
                data-testid={`token-revoke-${t.id}`}
              >
                <Trash2 size={13} strokeWidth={2.25} className="text-[color:var(--color-danger)]" />
              </Button>
            </li>
          ))}
        </ul>
      )}

      {/* 创建成功：显明文 token（一次性） */}
      <Dialog open={!!newSecret} onOpenChange={(open) => !open && setNewSecret(null)}>
        <DialogContent className="w-[520px] max-w-[calc(100vw-32px)] p-6">
          <DialogTitle>token 已创建</DialogTitle>
          <DialogDescription>
            请立即复制并妥善保管，下次进入页面将无法再看到明文。
          </DialogDescription>
          <div className="flex items-center gap-2 bg-ink-100 px-3 py-2 rounded-[var(--radius-sm)] font-mono text-[12px] break-all mt-4">
            <span className="flex-1" data-testid="new-token-plain">
              {newSecret?.plainToken}
            </span>
            <Button
              variant="ghost"
              size="sm"
              onClick={() => newSecret && copyToClipboard(newSecret.plainToken)}
              aria-label="复制"
            >
              <Copy size={14} strokeWidth={2.25} />
            </Button>
          </div>
          <p className="text-[11px] text-ink-500 mt-3 leading-relaxed">
            正常用 AI 接入直接跑 <code className="font-mono">prd login</code>{" "}
            就行（浏览器授权自动拿 token）；手工创建只用于自动化脚本场景。
          </p>
          <div className="flex justify-end mt-5">
            <Button variant="primary" onClick={() => setNewSecret(null)}>
              我已保存
            </Button>
          </div>
        </DialogContent>
      </Dialog>

      {/* 撤销确认 */}
      <Dialog open={!!revokingId} onOpenChange={(open) => !open && setRevokingId(null)}>
        <DialogContent className="w-[420px] p-6">
          <DialogTitle>确认撤销 token？</DialogTitle>
          <DialogDescription>
            撤销后使用此 token 的命令行立即不可用，需重新跑{" "}
            <code className="font-mono">prd login</code> 拿新 token。
          </DialogDescription>
          <div className="flex justify-end gap-2 mt-5">
            <Button variant="ghost" onClick={() => setRevokingId(null)}>
              取消
            </Button>
            <Button
              variant="danger"
              onClick={() => revokingId && handleRevoke(revokingId)}
              data-testid="token-revoke-confirm"
            >
              撤销
            </Button>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}
