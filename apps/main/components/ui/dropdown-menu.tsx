"use client";

import * as RadixMenu from "@radix-ui/react-dropdown-menu";
import { forwardRef, type ComponentPropsWithoutRef } from "react";
import { cn } from "@/lib/utils";

export const DropdownMenu = RadixMenu.Root;
export const DropdownMenuTrigger = RadixMenu.Trigger;

export const DropdownMenuContent = forwardRef<
  HTMLDivElement,
  ComponentPropsWithoutRef<typeof RadixMenu.Content>
>(({ className, sideOffset = 6, align = "end", ...props }, ref) => (
  <RadixMenu.Portal>
    <RadixMenu.Content
      ref={ref}
      data-prd-anim="popover"
      align={align}
      sideOffset={sideOffset}
      className={cn(
        "z-50 min-w-[9rem] rounded-[var(--radius-md)] border border-ink-200 bg-white p-1 shadow-[var(--shadow-md)]",
        className,
      )}
      {...props}
    />
  </RadixMenu.Portal>
));
DropdownMenuContent.displayName = "DropdownMenuContent";

export const DropdownMenuItem = forwardRef<
  HTMLDivElement,
  ComponentPropsWithoutRef<typeof RadixMenu.Item> & { destructive?: boolean }
>(({ className, destructive, ...props }, ref) => (
  <RadixMenu.Item
    ref={ref}
    className={cn(
      "relative flex cursor-pointer select-none items-center rounded-[var(--radius-sm)] px-2 py-1.5 text-sm",
      "outline-none transition-colors",
      destructive
        ? "text-[color:var(--color-danger)] hover:bg-[color:var(--color-danger-bg)] focus:bg-[color:var(--color-danger-bg)]"
        : "text-ink-900 hover:bg-ink-100 focus:bg-ink-100",
      "data-[disabled]:pointer-events-none data-[disabled]:opacity-40",
      className,
    )}
    {...props}
  />
));
DropdownMenuItem.displayName = "DropdownMenuItem";

export const DropdownMenuSeparator = forwardRef<
  HTMLDivElement,
  ComponentPropsWithoutRef<typeof RadixMenu.Separator>
>(({ className, ...props }, ref) => (
  <RadixMenu.Separator
    ref={ref}
    className={cn("-mx-1 my-1 h-px bg-ink-200", className)}
    {...props}
  />
));
DropdownMenuSeparator.displayName = "DropdownMenuSeparator";
