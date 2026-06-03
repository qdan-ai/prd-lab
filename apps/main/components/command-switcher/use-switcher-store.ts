"use client";

import { create } from "zustand";

interface SwitcherState {
  open: boolean;
  query: string;
  focusedProjectId: string | null;
  focusedVersionId: string | null;
  setOpen: (v: boolean) => void;
  toggle: () => void;
  setQuery: (q: string) => void;
  setFocusedProject: (id: string | null) => void;
  setFocusedVersion: (id: string | null) => void;
  reset: () => void;
}

export const useSwitcherStore = create<SwitcherState>((set) => ({
  open: false,
  query: "",
  focusedProjectId: null,
  focusedVersionId: null,
  setOpen: (open) => set({ open }),
  toggle: () => set((s) => ({ open: !s.open })),
  setQuery: (query) => set({ query }),
  setFocusedProject: (focusedProjectId) => set({ focusedProjectId }),
  setFocusedVersion: (focusedVersionId) => set({ focusedVersionId }),
  reset: () => set({ open: false, query: "" }),
}));
