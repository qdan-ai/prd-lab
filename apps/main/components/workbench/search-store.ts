"use client";

import { create } from "zustand";

interface SearchState {
  query: string;
  setQuery: (q: string) => void;
}

export const useWorkbenchSearchStore = create<SearchState>((set) => ({
  query: "",
  setQuery: (query) => set({ query }),
}));
