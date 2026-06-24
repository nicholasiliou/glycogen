import * as React from "react";
import { Slot } from "@radix-ui/react-slot";
import { cva, type VariantProps } from "class-variance-authority";
import { cn } from "@/ui/lib/cn";

const buttonVariants = cva(
  "inline-flex items-center justify-center gap-1.5 rounded text-xs font-medium transition-colors select-none disabled:opacity-40 disabled:pointer-events-none focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-accent/50",
  {
    variants: {
      variant: {
        default: "bg-panel-raised hover:bg-[#262626] text-ink border border-edge",
        ghost: "text-ink-dim hover:text-ink hover:bg-panel-raised",
        accent: "bg-accent text-black hover:brightness-110 border border-accent",
        outline: "border border-edge text-ink hover:bg-panel-raised",
        danger: "text-red-400 hover:bg-red-500/10",
      },
      size: {
        default: "h-7 px-2.5",
        sm: "h-6 px-2",
        xs: "h-5 px-1.5 text-[11px]",
        icon: "h-7 w-7",
        "icon-sm": "h-6 w-6",
      },
    },
    defaultVariants: { variant: "default", size: "default" },
  },
);

export interface ButtonProps
  extends React.ButtonHTMLAttributes<HTMLButtonElement>,
    VariantProps<typeof buttonVariants> {
  asChild?: boolean;
}

export const Button = React.forwardRef<HTMLButtonElement, ButtonProps>(
  ({ className, variant, size, asChild = false, ...props }, ref) => {
    const Comp = asChild ? Slot : "button";
    return <Comp ref={ref} className={cn(buttonVariants({ variant, size }), className)} {...props} />;
  },
);
Button.displayName = "Button";
export { buttonVariants };
