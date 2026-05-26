"use client";

import { useHotkeys } from "react-hotkeys-hook";
import { useSwitcherStore } from "@/components/command-switcher/use-switcher-store";

/**
 * 全局快捷键（docs/02 §2.2bis）：
 *   cmd/ctrl+K → 唤起 CommandSwitcher 弹窗
 *   输入框聚焦时除外（防误触）
 */
export function GlobalHotkeys() {
  const toggle = useSwitcherStore((s) => s.toggle);
  useHotkeys("mod+k", () => toggle(), { enableOnFormTags: false, preventDefault: true });
  return null;
}
