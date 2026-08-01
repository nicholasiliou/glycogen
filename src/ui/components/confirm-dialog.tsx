import { useState } from "react";
import type { ReactNode } from "react";
import { Button } from "@/ui/components/button";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/ui/components/dialog";

/**
 * A small confirm/cancel dialog. Controlled: the caller owns `open` and reacts to `onConfirm`;
 * both buttons (and the dialog's own close affordances) end up in `onOpenChange(false)`.
 *
 * Pass `suppressKey` to enable a "Do not show again" checkbox — if the user checks it and
 * confirms, that key is stored in localStorage and the dialog auto-confirms on future opens.
 */
export function ConfirmDialog({
  open,
  onOpenChange,
  title,
  description,
  confirmLabel = "Confirm",
  confirmVariant = "default",
  onConfirm,
  suppressKey,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: string;
  description: ReactNode;
  confirmLabel?: string;
  confirmVariant?: "default" | "danger";
  onConfirm: () => void;
  /** localStorage key; when set, shows a "Do not show again" checkbox. */
  suppressKey?: string;
}) {
  const [suppress, setSuppress] = useState(false);

  const handleConfirm = () => {
    if (suppressKey && suppress) localStorage.setItem(suppressKey, "1");
    onConfirm();
    onOpenChange(false);
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="w-[min(360px,90vw)]">
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
          <DialogDescription>{description}</DialogDescription>
        </DialogHeader>
        {suppressKey && (
          <label className="flex cursor-pointer items-center gap-2 px-4 pb-1 text-xs text-ink-dim select-none">
            <input
              type="checkbox"
              checked={suppress}
              onChange={(e) => setSuppress(e.target.checked)}
              className="accent-current"
            />
            Do not show again
          </label>
        )}
        <div className="flex justify-end gap-2 px-4 pb-4 pt-1">
          <Button variant="ghost" size="sm" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button
            variant={confirmVariant}
            size="sm"
            onClick={handleConfirm}
          >
            {confirmLabel}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}

/**
 * Returns `true` if the user has previously suppressed the dialog for the given key.
 * Pass this as a guard before setting `open` to true to skip the dialog entirely.
 */
export function isSuppressed(suppressKey: string): boolean {
  try {
    return localStorage.getItem(suppressKey) === "1";
  } catch {
    return false;
  }
}
