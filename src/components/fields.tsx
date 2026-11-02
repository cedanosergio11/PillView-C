import { useId, useState, type ReactNode } from "react";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { cn } from "@/lib/utils";

/** Small marker after a label for inputs the sheet needs. */
function RequiredMark() {
  return (
    <span className="ml-1 text-primary" aria-hidden="true" title="Required">
      •
    </span>
  );
}

/** Amber outline for a required input that is still blank once the well has values. */
const MISSING_INPUT = "border-warn/70 focus-visible:ring-warn/60";

export function Field({
  label,
  unit,
  hint,
  required,
  htmlFor,
  children,
  className,
}: {
  label: string;
  unit?: string;
  hint?: string;
  required?: boolean;
  htmlFor?: string;
  children: ReactNode;
  className?: string;
}) {
  return (
    <div className={cn("grid gap-1.5", className)}>
      <div className="flex items-baseline justify-between gap-2">
        <Label className="text-pretty" htmlFor={htmlFor}>
          {label}
          {required ? <RequiredMark /> : null}
          {required ? <span className="sr-only"> (required)</span> : null}
        </Label>
        {unit ? (
          <span className="font-mono text-[10px] uppercase tracking-wider text-muted-foreground">{unit}</span>
        ) : null}
      </div>
      {children}
      {hint ? <p className="text-[11px] leading-snug text-muted-foreground">{hint}</p> : null}
    </div>
  );
}

function parseNumber(raw: string): number | "" {
  if (raw === "") return "";
  const n = Number(raw);
  return Number.isFinite(n) ? n : "";
}

export function NumberField({
  label,
  unit,
  value,
  onChange,
  hint,
  step = "any",
  disabled,
  required,
  missing,
}: {
  label: string;
  unit?: string;
  value: number | "";
  onChange: (v: number | "") => void;
  hint?: string;
  step?: string;
  disabled?: boolean;
  required?: boolean;
  missing?: boolean;
}) {
  const id = useId();
  return (
    <Field label={label} unit={unit} hint={hint} required={required} htmlFor={id}>
      <Input
        id={id}
        type="number"
        step={step}
        inputMode="decimal"
        disabled={disabled}
        value={value}
        aria-invalid={missing || undefined}
        onChange={(e) => onChange(parseNumber(e.target.value))}
        className={cn(disabled && "bg-muted text-muted-foreground", missing && MISSING_INPUT)}
      />
    </Field>
  );
}

type PairPart = {
  unit: string;
  value: number | "";
  onChange: (v: number | "") => void;
  required?: boolean;
  missing?: boolean;
  step?: string;
};

/**
 * Two related numbers on one row, such as a depth in MD and TVD or a pipe OD and ID.
 * Each input carries its own unit so the pair reads left to right.
 */
export function PairField({ label, left, right }: { label: string; left: PairPart; right: PairPart }) {
  const id = useId();
  const parts = [
    { ...left, id: `${id}-a` },
    { ...right, id: `${id}-b` },
  ];
  const required = Boolean(left.required || right.required);
  return (
    <div className="grid gap-1.5" role="group" aria-labelledby={`${id}-label`}>
      <div className="flex items-baseline justify-between gap-2">
        <span id={`${id}-label`} className="text-xs font-medium leading-none text-pretty text-muted-foreground">
          {label}
          {required ? <RequiredMark /> : null}
        </span>
      </div>
      <div className="grid grid-cols-2 gap-2">
        {parts.map((part) => (
          <div key={part.id} className="relative min-w-0">
            <Input
              id={part.id}
              type="number"
              step={part.step ?? "any"}
              inputMode="decimal"
              value={part.value}
              aria-label={`${label}, ${part.unit}${part.required ? " (required)" : ""}`}
              aria-invalid={part.missing || undefined}
              onChange={(e) => part.onChange(parseNumber(e.target.value))}
              className={cn("pr-14", part.missing && MISSING_INPUT)}
            />
            <span className="pointer-events-none absolute inset-y-0 right-2.5 flex items-center font-mono text-[10px] uppercase tracking-wider text-muted-foreground">
              {part.unit}
            </span>
          </div>
        ))}
      </div>
    </div>
  );
}

export function TextField({
  label,
  value,
  onChange,
  type = "text",
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  type?: string;
}) {
  return (
    <Field label={label}>
      <Input type={type} value={value} onChange={(e) => onChange(e.target.value)} />
    </Field>
  );
}

export function Section({
  title,
  children,
  defaultOpen = true,
  missingCount = 0,
}: {
  title: string;
  children: ReactNode;
  defaultOpen?: boolean;
  /** Required inputs still blank in this section; shown on the header so a closed section still says so. */
  missingCount?: number;
}) {
  const [open, setOpen] = useState(defaultOpen);
  return (
    <details
      open={open}
      onToggle={(e) => setOpen((e.target as HTMLDetailsElement).open)}
      className="group border-b border-border last:border-b-0"
    >
      <summary className="flex cursor-pointer list-none items-center justify-between gap-2 px-4 py-3 text-[11px] font-semibold uppercase tracking-[0.14em] text-muted-foreground hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring/70 [&::-webkit-details-marker]:hidden">
        <span>{title}</span>
        {missingCount > 0 ? (
          <span className="ml-auto rounded-full border border-warn/40 bg-warn/10 px-2 py-0.5 font-mono text-[10px] font-medium normal-case tracking-normal text-warn">
            {missingCount} missing
          </span>
        ) : null}
        <span className="inline-block text-muted-foreground transition-transform duration-150 group-open:rotate-180">
          <svg width="12" height="12" viewBox="0 0 12 12" aria-hidden="true">
            <path d="M2.5 4.5 L6 8 L9.5 4.5" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
          </svg>
        </span>
      </summary>
      <div className="grid gap-3 px-4 pb-4">{children}</div>
    </details>
  );
}
