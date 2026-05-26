"use client";

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useId,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";

/**
 * ESC LIFO 栈（docs/10 §12.2）：
 * 多层 modal/popover 叠加时，按"后进先出"关闭：
 *   1. 删除/重命名/上传二次确认 modal
 *   2. CommandSwitcher 弹窗（含其内 createMode）
 *   3. 紧凑快照 popover
 *   4. 左/右抽屉
 *
 * 使用：调用方在 mount 时 `register(handler)`，unmount 时 `unregister(id)`。
 * 全局 ESC 监听只调用栈顶 handler；栈空时 ESC 无效果。
 */

type EscHandler = () => boolean | void; // 返回 true 表示已消费（停止冒泡）

type StackEntry = { id: string; handler: EscHandler };

type ModalStackContext = {
  register: (id: string, handler: EscHandler) => void;
  unregister: (id: string) => void;
};

const Ctx = createContext<ModalStackContext | null>(null);

export function ModalStackProvider({ children }: { children: ReactNode }) {
  const stackRef = useRef<StackEntry[]>([]);

  const register = useCallback((id: string, handler: EscHandler) => {
    // 同 id 重复注册视为更新
    stackRef.current = stackRef.current.filter((e) => e.id !== id);
    stackRef.current.push({ id, handler });
  }, []);

  const unregister = useCallback((id: string) => {
    stackRef.current = stackRef.current.filter((e) => e.id !== id);
  }, []);

  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key !== "Escape") return;
      const top = stackRef.current[stackRef.current.length - 1];
      if (!top) return;
      const consumed = top.handler();
      if (consumed !== false) {
        e.preventDefault();
        e.stopPropagation();
      }
    };
    window.addEventListener("keydown", onKeyDown, true); // capture 阶段，比 Radix 内部更早
    return () => window.removeEventListener("keydown", onKeyDown, true);
  }, []);

  const value = useMemo(() => ({ register, unregister }), [register, unregister]);

  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

/**
 * 调用方：当组件 open 时注册 esc handler；unmount / close 时自动注销。
 */
export function useModalStack(active: boolean, handler: EscHandler) {
  const ctx = useContext(Ctx);
  const id = useId();
  const handlerRef = useRef(handler);
  handlerRef.current = handler;

  useEffect(() => {
    if (!ctx) return;
    if (!active) return;
    ctx.register(id, () => handlerRef.current());
    return () => ctx.unregister(id);
  }, [ctx, id, active]);
}
