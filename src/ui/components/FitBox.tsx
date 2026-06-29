import { useLayoutEffect, useRef, useState, type ReactNode } from "react";

/**
 * Scales its (fixed-size) content uniformly so it fits inside the available space without scrolling
 * and without distorting aspect — a single `transform: scale(k)` where k is the smaller of the
 * width/height ratios (capped at `max`, default 1, so it shrinks but never blows content up). Used
 * to fit the skeuomorphic controller surface inside the masked overlay at any window size.
 */
export function FitBox({ children, max = 1, className }: { children: ReactNode; max?: number; className?: string }) {
  const outer = useRef<HTMLDivElement>(null);
  const inner = useRef<HTMLDivElement>(null);
  const [scale, setScale] = useState(1);

  useLayoutEffect(() => {
    const o = outer.current;
    const i = inner.current;
    if (!o || !i) return;
    const measure = () => {
      const cw = o.clientWidth;
      const ch = o.clientHeight;
      const iw = i.offsetWidth;
      const ih = i.offsetHeight;
      if (!iw || !ih) return;
      setScale(Math.min(max, cw / iw, ch / ih));
    };
    const ro = new ResizeObserver(measure);
    ro.observe(o);
    ro.observe(i);
    measure();
    return () => ro.disconnect();
  }, [max]);

  return (
    <div ref={outer} className={`flex min-h-0 min-w-0 items-center justify-center overflow-hidden ${className ?? ""}`}>
      <div ref={inner} style={{ transform: `scale(${scale})`, transformOrigin: "center" }}>
        {children}
      </div>
    </div>
  );
}
