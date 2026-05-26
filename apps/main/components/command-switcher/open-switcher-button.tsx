"use client";

import { Search } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useSwitcherStore } from "./use-switcher-store";

interface Props {
  variant?: "primary" | "secondary";
  label?: string;
}

export function OpenSwitcherButton({ variant = "secondary", label = "切换项目 / 方案" }: Props) {
  const open = useSwitcherStore((s) => s.setOpen);
  return (
    <Button variant={variant} size="sm" onClick={() => open(true)} className="gap-1.5">
      <Search size={12} strokeWidth={2.25} />
      <span>{label}</span>
      <kbd className="ml-0.5">⌘K</kbd>
    </Button>
  );
}
