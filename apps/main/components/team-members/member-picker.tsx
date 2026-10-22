"use client";

import { useEffect, useId, useMemo, useRef, useState } from "react";
import { Check, ChevronDown } from "lucide-react";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";

export interface Candidate {
  id: string;
  name: string;
  /** 已是在册成员：列出来但不能选 */
  inTeam: boolean;
}

interface Props {
  value: string;
  onChange: (name: string) => void;
  /** 候选名单；还在加载时为 undefined */
  candidates: Candidate[] | undefined;
  /** 名单没加载出来 */
  loadFailed: boolean;
  disabled?: boolean;
}

/** 名字里包含关键词即算匹配，不分大小写。 */
export function filterCandidates(candidates: Candidate[], query: string): Candidate[] {
  const q = query.trim().toLowerCase();
  if (!q) return candidates;
  return candidates.filter((c) => c.name.toLowerCase().includes(q));
}

/**
 * 「添加成员」的选人框（WAI-ARIA combobox）：聚焦或点右侧箭头展开名单，输入时按姓名过滤；
 * ↑↓ 移动、回车选中、Esc 收起。已在团队的人列出但不能选。列表收起时回车交给外层表单提交。
 */
export function MemberPicker({ value, onChange, candidates, loadFailed, disabled }: Props) {
  const listId = useId();
  const inputRef = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLUListElement>(null);
  const [open, setOpen] = useState(false);
  // 选中某人之后再展开，列出全部名单；用户改了文字才按文字过滤
  const [filtering, setFiltering] = useState(false);
  const [activeId, setActiveId] = useState<string | null>(null);

  const shown = useMemo(
    () => (candidates ? (filtering ? filterCandidates(candidates, value) : candidates) : []),
    [candidates, filtering, value],
  );
  const selectable = useMemo(() => shown.filter((c) => !c.inTeam), [shown]);

  // 名单变化时把高亮放到当前选中的人，否则第一个可选的人
  useEffect(() => {
    if (!open) return;
    setActiveId((prev) => {
      if (prev && selectable.some((c) => c.id === prev)) return prev;
      const current = selectable.find((c) => c.name === value.trim());
      return (current ?? selectable[0])?.id ?? null;
    });
  }, [open, selectable, value]);

  useEffect(() => {
    if (!open || !activeId) return;
    listRef.current?.querySelector(`[data-id="${CSS.escape(activeId)}"]`)?.scrollIntoView({ block: "nearest" });
  }, [open, activeId]);

  const choose = (c: Candidate) => {
    onChange(c.name);
    setFiltering(false);
    setOpen(false);
  };

  const move = (step: 1 | -1) => {
    if (selectable.length === 0) return;
    const at = selectable.findIndex((c) => c.id === activeId);
    const next = at < 0 ? (step === 1 ? 0 : selectable.length - 1) : (at + step + selectable.length) % selectable.length;
    setActiveId(selectable[next]!.id);
  };

  const onKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === "ArrowDown" || e.key === "ArrowUp") {
      e.preventDefault();
      if (!open) setOpen(true);
      else move(e.key === "ArrowDown" ? 1 : -1);
    } else if (e.key === "Enter") {
      const active = open ? selectable.find((c) => c.id === activeId) : undefined;
      if (active) {
        e.preventDefault();
        choose(active);
      }
    } else if (e.key === "Escape" && open) {
      e.preventDefault();
      e.stopPropagation();
      setOpen(false);
    }
  };

  const query = value.trim();
  let status: string | null = null;
  if (loadFailed) status = "名单没有加载出来，可以直接输入完整的账号名";
  else if (!candidates) status = "加载中...";
  else if (shown.length === 0) status = query ? `没有找到「${query}」，对方要先登录一次 PRD-Lab 才能添加` : "还没有其他人登录过 PRD-Lab";

  return (
    <div className="relative flex-1 min-w-0">
      <Input
        ref={inputRef}
        role="combobox"
        aria-expanded={open}
        aria-controls={listId}
        aria-autocomplete="list"
        aria-activedescendant={open && activeId ? `${listId}-${activeId}` : undefined}
        aria-label="成员姓名"
        autoComplete="off"
        value={value}
        onChange={(e) => {
          onChange(e.target.value);
          setFiltering(true);
          setOpen(true);
        }}
        onFocus={() => setOpen(true)}
        onClick={() => setOpen(true)}
        onBlur={() => setOpen(false)}
        onKeyDown={onKeyDown}
        placeholder="搜索姓名，或从名单里选择"
        data-testid="team-add-name"
        className="pr-8"
        disabled={disabled}
      />
      <button
        type="button"
        tabIndex={-1}
        aria-label={open ? "收起名单" : "展开名单"}
        data-testid="team-add-toggle"
        disabled={disabled}
        // 按下时不抢走输入框的焦点
        onMouseDown={(e) => e.preventDefault()}
        onClick={() => {
          if (open) {
            setOpen(false);
          } else {
            setFiltering(false);
            setOpen(true);
            inputRef.current?.focus();
          }
        }}
        className="absolute right-0 top-0 h-8 w-8 flex items-center justify-center text-ink-500 hover:text-ink-900 disabled:opacity-40 disabled:cursor-not-allowed"
      >
        <ChevronDown size={14} strokeWidth={2.25} className={cn("transition-transform", open && "rotate-180")} />
      </button>
      {open ? (
        <div
          className="absolute left-0 right-0 top-[calc(100%+4px)] z-20 rounded-[var(--radius-md)] border border-ink-200 bg-white p-1 shadow-[var(--shadow-md)]"
          onMouseDown={(e) => e.preventDefault()}
          data-testid="team-add-options"
        >
          {status ? (
            <div className="px-2 py-2 text-[13px] text-ink-500" data-testid="team-add-options-status">
              {status}
            </div>
          ) : null}
          <ul
            ref={listRef}
            id={listId}
            role="listbox"
            aria-label="可添加的人"
            className={cn("max-h-[240px] overflow-y-auto", shown.length === 0 && "hidden")}
          >
            {shown.map((c) => {
              const active = c.id === activeId;
              const selected = !c.inTeam && c.name === query;
              return (
                <li
                  key={c.id}
                  id={`${listId}-${c.id}`}
                  data-id={c.id}
                  role="option"
                  aria-selected={selected}
                  aria-disabled={c.inTeam || undefined}
                  data-testid="team-add-option"
                  data-user={c.name}
                  onMouseEnter={() => !c.inTeam && setActiveId(c.id)}
                  onClick={() => !c.inTeam && choose(c)}
                  className={cn(
                    "h-8 px-2 flex items-center gap-2 text-sm rounded-[var(--radius-sm)] select-none",
                    c.inTeam ? "text-ink-400 cursor-default" : "text-ink-900 cursor-pointer",
                    active && "bg-ink-100",
                  )}
                >
                  <span className="flex-1 truncate">{c.name}</span>
                  {c.inTeam ? (
                    <span className="text-[12px] shrink-0">已在团队</span>
                  ) : selected ? (
                    <Check size={14} strokeWidth={2.25} className="shrink-0 text-ink-700" />
                  ) : null}
                </li>
              );
            })}
          </ul>
        </div>
      ) : null}
    </div>
  );
}
