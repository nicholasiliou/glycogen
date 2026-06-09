import * as React from "react";
import { GripVertical } from "lucide-react";
import * as ResizablePrimitive from "react-resizable-panels";
import { cn } from "@/ui/lib/cn";

export const ResizablePanelGroup = ({
  className,
  ...props
}: React.ComponentProps<typeof ResizablePrimitive.PanelGroup>) => (
  <ResizablePrimitive.PanelGroup
    className={cn("flex h-full w-full data-[panel-group-direction=vertical]:flex-col", className)}
    {...props}
  />
);

export const ResizablePanel = ResizablePrimitive.Panel;

export const ResizableHandle = ({
  withHandle,
  className,
  ...props
}: React.ComponentProps<typeof ResizablePrimitive.PanelResizeHandle> & { withHandle?: boolean }) => (
  <ResizablePrimitive.PanelResizeHandle
    className={cn(
      "relative flex items-center justify-center bg-black/40 transition-colors hover:bg-accent/40 data-[resize-handle-state=drag]:bg-accent/60",
      "w-px data-[panel-group-direction=vertical]:h-px data-[panel-group-direction=vertical]:w-full",
      "after:absolute after:inset-0 after:-m-1 after:content-['']",
      className,
    )}
    {...props}
  >
    {withHandle && (
      <div className="z-10 flex h-4 w-2.5 items-center justify-center rounded-sm border border-edge bg-panel-raised">
        <GripVertical className="h-2.5 w-2.5 text-ink-dim" />
      </div>
    )}
  </ResizablePrimitive.PanelResizeHandle>
);
