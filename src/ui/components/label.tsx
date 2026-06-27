import * as React from "react";
import * as LabelPrimitive from "@radix-ui/react-label";
import { cn } from "@/ui/lib/cn";

export const Label = React.forwardRef<
  React.ElementRef<typeof LabelPrimitive.Root>,
  React.ComponentPropsWithoutRef<typeof LabelPrimitive.Root>
>(({ className, ...props }, ref) => (
  <LabelPrimitive.Root
    ref={ref}
    className={cn("text-[11px] leading-none text-ink-dim select-none", className)}
    {...props}
  />
));
Label.displayName = "Label";
