"use client";

import { create } from "zustand";

/**
 * S17：新建项目 / 新建方案 独立聚焦弹窗的全局状态。
 * 不复用 switcher 的 createMode——后者钉死在 switcher 分栏内；
 * 独立 store 让弹窗可从任意入口（工作台按钮 / Switcher / 空状态页 / 左抽屉）无依赖触发。
 */
interface CreateDialogState {
  mode: "none" | "project" | "version";
  projectId: string | null;
  projectName: string | null;
  openProject: () => void;
  openVersion: (projectId: string, projectName: string) => void;
  close: () => void;
}

export const useCreateDialogStore = create<CreateDialogState>((set) => ({
  mode: "none",
  projectId: null,
  projectName: null,
  openProject: () => set({ mode: "project", projectId: null, projectName: null }),
  openVersion: (projectId, projectName) => set({ mode: "version", projectId, projectName }),
  close: () => set({ mode: "none", projectId: null, projectName: null }),
}));
