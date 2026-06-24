import * as React from "react";
import { cn } from "@/ui/lib/cn";

export const Input = React.forwardRef<HTMLInputElement, React.InputHTMLAttributes<HTMLInputElement>>(
  ({ className, ...props }, ref) => (
    <input
      ref={ref}
      className={cn(
        "h-6 w-full rounded border border-edge bg-panel-raised px-1.5 text-xs text-ink outline-none transition-colors placeholder:text-ink-dim/60 focus:border-accent/60 disabled:opacity-40",
        className,
      )}
      {...props}
    />
  ),
);
Input.displayName = "Input";
