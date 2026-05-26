"use client";

import { Search } from "lucide-react";
import { useWorkbenchSearchStore } from "./search-store";

export function WorkbenchSearchBox() {
  const query = useWorkbenchSearchStore((s) => s.query);
  const setQuery = useWorkbenchSearchStore((s) => s.setQuery);
  return (
    <div className="relative">
      <Search
        size={13}
        strokeWidth={2}
        className="absolute left-2.5 top-1/2 -translate-y-1/2 text-ink-400 pointer-events-none"
      />
      <input
        type="text"
        value={query}
        onChange={(e) => setQuery(e.target.value)}
        placeholder="按名称搜索项目"
        aria-label="按名称搜索项目"
        className="h-8 w-72 pl-7 pr-2.5 text-[13px] bg-white border border-ink-200 rounded-[var(--radius-md)] text-ink-900 placeholder:text-ink-400 transition-colors focus-visible:outline-none focus-visible:border-ink-500 focus-visible:ring-2 focus-visible:ring-ink-900/10"
        data-testid="workbench-search"
      />
    </div>
  );
}
