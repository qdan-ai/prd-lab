"use client";

import { create } from "zustand";

interface SidebarState {
  leftOpen: boolean;
  setLeft: (v: boolean) => void;
  toggleLeft: () => void;
}

export const useSidebarStore = create<SidebarState>((set) => ({
  leftOpen: false,
  setLeft: (leftOpen) => set({ leftOpen }),
  toggleLeft: () => set((s) => ({ leftOpen: !s.leftOpen })),
}));
