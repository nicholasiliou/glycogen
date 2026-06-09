import { NumberField } from "./NumberField";

/** Two scrubby fields for an [x, y] value (position, anchor, scale…). */
export function PointField({
  value,
  onChange,
  step,
}: {
  value: unknown;
  onChange: (v: number[]) => void;
  step?: number;
}) {
  const arr = Array.isArray(value) ? (value as number[]) : [0, 0];
  return (
    <div className="grid grid-cols-2 gap-1">
      <NumberField value={arr[0] ?? 0} step={step} onChange={(v) => onChange([v, arr[1] ?? 0])} />
      <NumberField value={arr[1] ?? 0} step={step} onChange={(v) => onChange([arr[0] ?? 0, v])} />
    </div>
  );
}
