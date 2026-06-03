"use client";

import { create } from "zustand";

interface SidebarState {
  leftOpen: boolean;
  /** 用户是否手动切换过（手动关闭后切 snapshot 不应被强制重开） */
  userToggled: boolean;
  setLeft: (v: boolean) => void;
  toggleLeft: () => void;
  /** 进版本页首次默认展开：仅当用户未手动操作过时打开 */
  ensureDefaultOpen: () => void;
}

export const useSidebarStore = create<SidebarState>((set) => ({
  leftOpen: false,
  userToggled: false,
  setLeft: (leftOpen) => set({ leftOpen, userToggled: true }),
  toggleLeft: () => set((s) => ({ leftOpen: !s.leftOpen, userToggled: true })),
  ensureDefaultOpen: () =>
    set((s) => (s.userToggled ? s : { leftOpen: true })),
}));
