import { hexToRGB, toHex, toRGBA } from "@/ui/lib/color";

/** Swatch (opens the native picker) + alpha slider → emits an [r,g,b,a] array. */
export function ColorField({ value, onChange }: { value: unknown; onChange: (v: number[]) => void }) {
  const [r, g, b, a] = toRGBA(value);
  return (
    <div className="flex items-center gap-1.5">
      <label
        className="relative h-6 w-9 shrink-0 cursor-pointer overflow-hidden rounded border border-edge"
        style={{ background: `rgba(${r},${g},${b},${a / 255})` }}
        title="Pick colour"
      >
        <input
          type="color"
          value={toHex(value)}
          onChange={(e) => {
            const [nr, ng, nb] = hexToRGB(e.target.value);
            onChange([nr, ng, nb, a]);
          }}
          className="absolute inset-0 cursor-pointer opacity-0"
        />
      </label>
      <input
        type="range"
        min={0}
        max={255}
        value={a}
        onChange={(e) => onChange([r, g, b, Number(e.target.value)])}
        className="h-1 flex-1 cursor-pointer accent-[var(--color-accent)]"
        title="Alpha"
      />
    </div>
  );
}
