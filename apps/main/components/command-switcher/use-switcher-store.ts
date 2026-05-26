"use client";

import { create } from "zustand";

interface SwitcherState {
  open: boolean;
  query: string;
  focusedProjectId: string | null;
  focusedVersionId: string | null;
  createMode: "none" | "project" | "version";
  setOpen: (v: boolean) => void;
  toggle: () => void;
  setQuery: (q: string) => void;
  setFocusedProject: (id: string | null) => void;
  setFocusedVersion: (id: string | null) => void;
  setCreateMode: (m: "none" | "project" | "version") => void;
  reset: () => void;
}

export const useSwitcherStore = create<SwitcherState>((set) => ({
  open: false,
  query: "",
  focusedProjectId: null,
  focusedVersionId: null,
  createMode: "none",
  setOpen: (open) => set({ open, createMode: open ? "none" : "none" }),
  toggle: () => set((s) => ({ open: !s.open, createMode: "none" })),
  setQuery: (query) => set({ query }),
  setFocusedProject: (focusedProjectId) => set({ focusedProjectId }),
  setFocusedVersion: (focusedVersionId) => set({ focusedVersionId }),
  setCreateMode: (createMode) => set({ createMode }),
  reset: () => set({ open: false, query: "", createMode: "none" }),
}));
