"use client";

import { useEffect } from "react";
import { useSidebarStore } from "@/components/layout/sidebar-store";

/**
 * S17：进入版本页时左抽屉默认展开。
 * 仅在版本页挂载（首页不挂 → 不影响工作台）；
 * useEffect 仅在 mount 跑一次：同页切 snapshot 不重跑，用户手动关后不被强制重开。
 */
export function DefaultOpenLeftSidebar() {
  const ensureDefaultOpen = useSidebarStore((s) => s.ensureDefaultOpen);
  useEffect(() => {
    ensureDefaultOpen();
  }, [ensureDefaultOpen]);
  return null;
}
