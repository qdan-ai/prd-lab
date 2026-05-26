"use client";

import * as RadixDialog from "@radix-ui/react-dialog";
import { X } from "lucide-react";
import { forwardRef, type ComponentPropsWithoutRef, type ReactNode } from "react";
import { cn } from "@/lib/utils";

export const Dialog = RadixDialog.Root;
export const DialogTrigger = RadixDialog.Trigger;
export const DialogClose = RadixDialog.Close;
export const DialogPortal = RadixDialog.Portal;

export const DialogOverlay = forwardRef<
  HTMLDivElement,
  ComponentPropsWithoutRef<typeof RadixDialog.Overlay>
>(({ className, ...props }, ref) => (
  <RadixDialog.Overlay
    ref={ref}
    data-prd-anim="overlay"
    className={cn(
      "fixed inset-0 z-50",
      // 去掉 backdrop-blur：fade 期间动态计算 blur 是 GPU 大开销，是动画卡顿的主因之一。
      // 用更深一点的纯色遮罩补足层次感。
      "bg-[oklch(0_0_0/0.5)]",
      className,
    )}
    {...props}
  />
));
DialogOverlay.displayName = "DialogOverlay";

interface DialogContentProps extends ComponentPropsWithoutRef<typeof RadixDialog.Content> {
  showClose?: boolean;
}

export const DialogContent = forwardRef<HTMLDivElement, DialogContentProps>(
  ({ className, children, showClose = true, ...props }, ref) => (
    <DialogPortal>
      <DialogOverlay />
      <RadixDialog.Content
        ref={ref}
        data-prd-anim="dialog"
        className={cn(
          "fixed left-1/2 top-1/2 z-50 -translate-x-1/2 -translate-y-1/2",
          "bg-white shadow-[var(--shadow-popup)] rounded-[var(--radius-lg)]",
          "border border-ink-200",
          "origin-center",
          className,
        )}
        {...props}
      >
        {children}
        {showClose ? (
          <RadixDialog.Close
            className="absolute right-3 top-3 rounded-[var(--radius-sm)] p-1 text-ink-500 hover:text-ink-900 hover:bg-ink-100 transition-colors"
            aria-label="关闭"
          >
            <X size={14} />
          </RadixDialog.Close>
        ) : null}
      </RadixDialog.Content>
    </DialogPortal>
  ),
);
DialogContent.displayName = "DialogContent";

export function DialogTitle({ children, className }: { children: ReactNode; className?: string }) {
  return (
    <RadixDialog.Title className={cn("text-[15px] font-semibold text-ink-900 tracking-tight", className)}>
      {children}
    </RadixDialog.Title>
  );
}

export function DialogDescription({ children, className }: { children: ReactNode; className?: string }) {
  return (
    <RadixDialog.Description className={cn("text-sm text-ink-500 mt-1", className)}>
      {children}
    </RadixDialog.Description>
  );
}
