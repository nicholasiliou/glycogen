import * as React from "react";
import * as DialogPrimitive from "@radix-ui/react-dialog";
import { cn } from "@/ui/lib/cn";

export const Dialog = DialogPrimitive.Root;
export const DialogTrigger = DialogPrimitive.Trigger;
export const DialogClose = DialogPrimitive.Close;

/**
 * Dialogs portal into the element carrying this id (the stage/canvas area) when present, so they
 * center on the canvas — not the whole page — and re-center as the controls drawer resizes it.
 * Falls back to a body portal (viewport-centered) when no such element exists.
 */
export const DIALOG_PORTAL_ID = "dialog-portal-area";

function portalContainer(): HTMLElement | null {
  return typeof document !== "undefined" ? document.getElementById(DIALOG_PORTAL_ID) : null;
}

export const DialogOverlay = React.forwardRef<
  React.ElementRef<typeof DialogPrimitive.Overlay>,
  React.ComponentPropsWithoutRef<typeof DialogPrimitive.Overlay>
>(({ className, ...props }, ref) => (
  <DialogPrimitive.Overlay
    ref={ref}
    className={cn("inset-0 z-50", portalContainer() ? "absolute" : "fixed", className)}
    {...props}
  />
));
DialogOverlay.displayName = "DialogOverlay";

export const DialogContent = React.forwardRef<
  React.ElementRef<typeof DialogPrimitive.Content>,
  React.ComponentPropsWithoutRef<typeof DialogPrimitive.Content>
>(({ className, children, ...props }, ref) => {
  const container = portalContainer();
  return (
    <DialogPrimitive.Portal container={container ?? undefined}>
      <DialogOverlay />
      <DialogPrimitive.Content
        ref={ref}
        className={cn(
          "left-1/2 top-1/2 z-50 flex max-h-[88vh] w-[min(880px,94vw)] -translate-x-1/2 -translate-y-1/2 flex-col overflow-hidden rounded-lg bg-black/70 backdrop-blur-md text-ink shadow-2xl outline-none",
          container ? "absolute" : "fixed",
          className,
        )}
        {...props}
      >
        {children}
      </DialogPrimitive.Content>
    </DialogPrimitive.Portal>
  );
});
DialogContent.displayName = "DialogContent";

export function DialogHeader({ className, ...props }: React.HTMLAttributes<HTMLDivElement>) {
  return <div className={cn("shrink-0  px-4 py-3", className)} {...props} />;
}

export const DialogTitle = React.forwardRef<
  React.ElementRef<typeof DialogPrimitive.Title>,
  React.ComponentPropsWithoutRef<typeof DialogPrimitive.Title>
>(({ className, ...props }, ref) => (
  <DialogPrimitive.Title ref={ref} className={cn("text-sm font-semibold tracking-tight text-ink", className)} {...props} />
));
DialogTitle.displayName = "DialogTitle";

export const DialogDescription = React.forwardRef<
  React.ElementRef<typeof DialogPrimitive.Description>,
  React.ComponentPropsWithoutRef<typeof DialogPrimitive.Description>
>(({ className, ...props }, ref) => (
  <DialogPrimitive.Description ref={ref} className={cn("mt-0.5 text-xs text-ink-dim", className)} {...props} />
));
DialogDescription.displayName = "DialogDescription";
