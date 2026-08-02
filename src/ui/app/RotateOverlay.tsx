import { useEffect, useState } from "react";

/** Treat only touch-capable, narrow-in-portrait devices as "phones" — desktop windows that happen
 *  to be tall shouldn't get nagged. */
function isPortraitPhone(): boolean {
  if (typeof window === "undefined") return false;
  const touch = window.matchMedia("(pointer: coarse)").matches;
  const portrait = window.matchMedia("(orientation: portrait)").matches;
  return touch && portrait;
}

/**
 * Portrait-orientation nag for phones. The stage is a 16:9 landscape canvas, so a vertical phone
 * shows it letterboxed and tiny — prompt a rotate, with a "continue anyway" escape hatch that
 * sticks for the session.
 */
export function RotateOverlay() {
  const [portrait, setPortrait] = useState(isPortraitPhone);
  const [dismissed, setDismissed] = useState(false);

  useEffect(() => {
    const update = () => setPortrait(isPortraitPhone());
    const mqO = window.matchMedia("(orientation: portrait)");
    const mqP = window.matchMedia("(pointer: coarse)");
    mqO.addEventListener("change", update);
    mqP.addEventListener("change", update);
    window.addEventListener("resize", update);
    return () => {
      mqO.removeEventListener("change", update);
      mqP.removeEventListener("change", update);
      window.removeEventListener("resize", update);
    };
  }, []);

  // Reset the dismissal when the phone is rotated back to landscape, so returning to portrait
  // re-prompts.
  useEffect(() => {
    if (!portrait) setDismissed(false);
  }, [portrait]);

  if (!portrait || dismissed) return null;

  return (
    <div className="fixed inset-0 z-[100] flex flex-col items-center justify-center gap-6 bg-black/95 px-8 text-center text-ink backdrop-blur">
      <svg viewBox="0 0 64 64" className="h-16 w-16 animate-pulse text-ink-dim" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
        {/* Phone body tilted ~45° */}
        <rect x="18" y="10" width="22" height="36" rx="3" transform="rotate(40 29 28)" />
        {/* Home button dot */}
        <circle cx="29" cy="38" r="1.5" fill="currentColor" stroke="none" transform="rotate(40 29 28)" />
        {/* Rotation arc arrow */}
        <path d="M48 14 A22 22 0 0 1 14 48" strokeDasharray="4 3" />
        <polyline points="46,8 48,14 54,12" />
      </svg>
      <div className="space-y-2">
        <p className="text-lg font-medium">Rotate your phone</p>
        <p className="max-w-xs text-sm text-ink-dim">
          Glycogen is a widescreen stage. Please rotate your phone for the best experience.
        </p>
      </div>
      <button
        onClick={() => setDismissed(true)}
        className="rounded-full border border-red-800/60 px-5 py-2 text-sm text-red-500/70 transition-colors hover:text-red-400"
      >
        Continue anyway
      </button>
    </div>
  );
}
