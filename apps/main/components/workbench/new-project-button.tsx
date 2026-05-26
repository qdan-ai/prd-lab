"use client";

import { Plus } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useSwitcherStore } from "@/components/command-switcher/use-switcher-store";

export function NewProjectButton() {
  const setOpen = useSwitcherStore((s) => s.setOpen);
  const setCreateMode = useSwitcherStore((s) => s.setCreateMode);
  return (
    <Button
      variant="primary"
      size="md"
      onClick={() => {
        setOpen(true);
        setCreateMode("project");
      }}
      className="gap-1.5"
      data-testid="workbench-new-project"
    >
      <Plus size={14} strokeWidth={2.25} />
      <span>新建项目</span>
    </Button>
  );
}
