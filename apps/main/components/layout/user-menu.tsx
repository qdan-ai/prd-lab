"use client";

import { useRouter } from "next/navigation";
import { LogOut, User } from "lucide-react";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { cn } from "@/lib/utils";

interface UserMenuProps {
  userName: string;
  onLogout: () => void;
}

/**
 * 用户头像下拉菜单（首字母 avatar）
 */
export function UserMenu({ userName, onLogout }: UserMenuProps) {
  const initial = userName.trim().charAt(0).toUpperCase() || "?";
  const router = useRouter();
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <button
          type="button"
          className={cn(
            "h-7 px-1.5 inline-flex items-center gap-1.5 rounded-[var(--radius-sm)]",
            "hover:bg-ink-100 transition-colors",
            "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ink-900 focus-visible:ring-offset-1 focus-visible:ring-offset-white",
          )}
          aria-label={`当前用户 ${userName}`}
          title={userName}
        >
          <div className="w-5 h-5 rounded-full bg-ink-900 text-ink-50 text-[10px] font-medium flex items-center justify-center select-none">
            {initial}
          </div>
          <span className="text-[12px] text-ink-700 max-w-[120px] truncate">
            {userName}
          </span>
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="min-w-[180px]">
        <div className="px-2 py-1.5 select-none">
          <div className="text-[11px] text-ink-500">已登入</div>
          <div className="text-[13px] font-medium text-ink-900 truncate">{userName}</div>
        </div>
        <DropdownMenuSeparator />
        <DropdownMenuItem
          className="gap-2"
          data-testid="user-menu-settings"
          onSelect={() => router.push("/settings/tokens")}
        >
          <User size={12} strokeWidth={2.25} />
          <span>接入 AI 工具</span>
        </DropdownMenuItem>
        <DropdownMenuSeparator />
        <DropdownMenuItem onSelect={onLogout} destructive className="gap-2">
          <LogOut size={12} strokeWidth={2.25} />
          <span>登出</span>
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
