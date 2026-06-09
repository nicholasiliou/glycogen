import { NumberField } from "./NumberField";

/** Three scrubby fields for an [x, y, z] value (3D points). */
export function Vec3Field({
  value,
  onChange,
  step,
}: {
  value: unknown;
  onChange: (v: number[]) => void;
  step?: number;
}) {
  const a = Array.isArray(value) ? (value as number[]) : [0, 0, 0];
  return (
    <div className="grid grid-cols-3 gap-1">
      <NumberField value={a[0] ?? 0} step={step} onChange={(v) => onChange([v, a[1] ?? 0, a[2] ?? 0])} />
      <NumberField value={a[1] ?? 0} step={step} onChange={(v) => onChange([a[0] ?? 0, v, a[2] ?? 0])} />
      <NumberField value={a[2] ?? 0} step={step} onChange={(v) => onChange([a[0] ?? 0, a[1] ?? 0, v])} />
    </div>
  );
}
