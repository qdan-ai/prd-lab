"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Eye, EyeOff } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

interface Props {
  shareId: string;
}

export function ShareLoginForm({ shareId }: Props) {
  const router = useRouter();
  const [password, setPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [busy, setBusy] = useState(false);

  const onSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!password) {
      toast.error("请填写访问密码");
      return;
    }
    setBusy(true);
    try {
      const res = await fetch(`/share/${shareId}/api/login`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ password }),
      });
      if (!res.ok) {
        const body = await res.json().catch(() => null);
        if (body?.error_code === "rate_limited") {
          toast.error("失败次数过多，请 15 分钟后重试");
        } else if (body?.error_code === "share_revoked") {
          toast.error("分享已被撤销");
        } else if (body?.error_code === "share_not_found") {
          toast.error("分享链接不存在");
        } else if (body?.error_code === "validation_error") {
          toast.error("密码错误");
        } else {
          toast.error("登入失败，请稍后重试");
        }
        return;
      }
      router.replace(`/share/${shareId}`);
      router.refresh();
    } finally {
      setBusy(false);
    }
  };

  return (
    <form onSubmit={onSubmit} className="space-y-4" data-testid="share-login-form">
      <div>
        <label className="text-[12px] text-ink-700 font-medium block mb-1.5">访问密码</label>
        <div className="relative">
          <Input
            type={showPassword ? "text" : "password"}
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            autoFocus
            autoComplete="current-password"
            data-testid="share-login-password"
            className="pr-9"
          />
          <button
            type="button"
            onClick={() => setShowPassword((v) => !v)}
            className="absolute right-2 top-1/2 -translate-y-1/2 text-ink-500 hover:text-ink-900"
            aria-label={showPassword ? "隐藏密码" : "显示密码"}
          >
            {showPassword ? <EyeOff size={14} strokeWidth={2.25} /> : <Eye size={14} strokeWidth={2.25} />}
          </button>
        </div>
      </div>
      <Button
        type="submit"
        variant="primary"
        size="md"
        disabled={busy}
        className="w-full"
        data-testid="share-login-submit"
      >
        {busy ? "进入中..." : "进入"}
      </Button>
    </form>
  );
}
