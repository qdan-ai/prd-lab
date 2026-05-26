"use client";

import { useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";

interface Props {
  open: boolean;
  title: string;
  subtitle?: string;
  fieldLabel: string;
  initial: string;
  maxLength: number;
  placeholder?: string;
  /** 允许提交空字符串（用于清除可选标签，如 version_label） */
  allowEmpty?: boolean;
  /** 输入提示行（可选，渲染在 Input 下方） */
  hint?: string;
  onSubmit: (value: string) => Promise<void>;
  onClose: () => void;
}

/**
 * 通用单字段重命名 Dialog。
 *
 * - Input 预填 initial
 * - ⌘+Enter 提交
 * - 默认禁止空值（除非 allowEmpty）
 * - 与 initial 相同则禁用保存按钮（无变化）
 * - 错误处理由调用方决定（onSubmit 抛错时这里只 stay；toast 由 apiFetch 自动）
 */
export function RenameDialog({
  open,
  title,
  subtitle,
  fieldLabel,
  initial,
  maxLength,
  placeholder,
  allowEmpty,
  hint,
  onSubmit,
  onClose,
}: Props) {
  const [value, setValue] = useState(initial);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (open) {
      setValue(initial);
      setSaving(false);
    }
  }, [open, initial]);

  const trimmed = value.trim();
  const canSubmit =
    !saving &&
    trimmed !== initial.trim() &&
    (allowEmpty || trimmed.length > 0) &&
    trimmed.length <= maxLength;

  const handleSubmit = async () => {
    if (!canSubmit) return;
    setSaving(true);
    try {
      await onSubmit(trimmed);
    } catch {
      // toast 已自动；保持窗口打开让用户修正
    } finally {
      setSaving(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="w-[480px] max-w-[calc(100vw-32px)] p-0 flex flex-col">
        <div className="px-6 pt-6 pb-5 border-b border-ink-150">
          <DialogTitle className="text-[16px]">{title}</DialogTitle>
          {subtitle ? (
            <div className="text-[13px] text-ink-500 mt-1">{subtitle}</div>
          ) : null}
        </div>

        <div className="px-6 py-5">
          <label className="text-[12px] text-ink-700 font-medium block mb-1.5">
            {fieldLabel}
          </label>
          <Input
            autoFocus
            value={value}
            onChange={(e) => setValue(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) {
                e.preventDefault();
                handleSubmit();
              } else if (e.key === "Enter" && !e.shiftKey) {
                e.preventDefault();
                handleSubmit();
              }
            }}
            maxLength={maxLength}
            placeholder={placeholder}
            data-testid="rename-dialog-input"
          />
          {hint ? (
            <div className="mt-2 text-[11px] text-ink-500">{hint}</div>
          ) : null}
        </div>

        <div className="flex justify-end gap-2 px-6 py-4 border-t border-ink-150 bg-ink-50/40 rounded-b-[var(--radius-lg)]">
          <Button variant="ghost" size="md" onClick={onClose} disabled={saving}>
            取消
          </Button>
          <Button
            variant="primary"
            size="md"
            onClick={handleSubmit}
            disabled={!canSubmit}
            data-testid="rename-dialog-save"
            className="min-w-[88px]"
          >
            {saving ? "保存中..." : "保存"}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
