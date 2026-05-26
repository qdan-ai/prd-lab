import { Slot } from "@radix-ui/react-slot";
import type { ButtonHTMLAttributes } from "react";
import { forwardRef } from "react";
import { cn } from "@/lib/utils";

type ButtonVariant = "primary" | "secondary" | "ghost" | "danger" | "outline";
type ButtonSize = "sm" | "md" | "lg" | "icon";

interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: ButtonVariant;
  size?: ButtonSize;
  asChild?: boolean;
}

const variantClasses: Record<ButtonVariant, string> = {
  primary:
    "bg-ink-900 text-ink-50 hover:bg-ink-950 active:bg-ink-950 shadow-sm border border-ink-900",
  secondary:
    "bg-white text-ink-900 border border-ink-200 hover:bg-ink-50 hover:border-ink-300 active:bg-ink-100 shadow-sm",
  outline:
    "bg-transparent text-ink-700 border border-ink-200 hover:bg-ink-50 hover:text-ink-900",
  ghost:
    "bg-transparent text-ink-700 hover:bg-ink-100 hover:text-ink-900 active:bg-ink-200",
  danger:
    "bg-[color:var(--color-danger)] text-white hover:opacity-90 shadow-sm",
};

const sizeClasses: Record<ButtonSize, string> = {
  sm: "h-7 px-2.5 text-xs rounded-[var(--radius-sm)]",
  md: "h-8 px-3 text-sm rounded-[var(--radius-md)]",
  lg: "h-10 px-4 text-sm rounded-[var(--radius-md)]",
  icon: "h-7 w-7 p-0 rounded-[var(--radius-sm)]",
};

export const Button = forwardRef<HTMLButtonElement, ButtonProps>(
  ({ className, variant = "primary", size = "md", asChild = false, ...props }, ref) => {
    const Comp = asChild ? Slot : "button";
    return (
      <Comp
        ref={ref}
        className={cn(
          "inline-flex items-center justify-center gap-1.5 font-medium select-none",
          "transition-all duration-150",
          "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ink-900 focus-visible:ring-offset-2 focus-visible:ring-offset-white",
          "disabled:opacity-40 disabled:pointer-events-none",
          variantClasses[variant],
          sizeClasses[size],
          className,
        )}
        {...props}
      />
    );
  },
);
Button.displayName = "Button";
