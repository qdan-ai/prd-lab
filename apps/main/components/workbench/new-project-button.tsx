"use client";

import { Plus } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useCreateDialogStore } from "@/components/create-dialog/use-create-dialog-store";

export function NewProjectButton() {
  const openProject = useCreateDialogStore((s) => s.openProject);
  return (
    <Button
      variant="primary"
      size="md"
      onClick={() => openProject()}
      className="gap-1.5"
      data-testid="workbench-new-project"
    >
      <Plus size={14} strokeWidth={2.25} />
      <span>新建项目</span>
    </Button>
  );
}
