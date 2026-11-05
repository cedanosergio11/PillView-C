import { useMemo, useState } from "react";
import type { PointerEvent } from "react";
import type { ScheduleRow } from "@/lib/calc/types";
import { formatNumber } from "@/lib/utils";
import { dPsi, dStk } from "@/components/fmt";

const VW = 720;
const VH = 280;
const L = 52;
const R = 704;
const T = 18;
const B = 248;
const PW = R - L;
const PH = B - T;

function sbpValue(row: ScheduleRow) {
  return typeof row.sbp === "number" ? Math.max(0, row.sbp) : 0;
}

function niceMax(value: number) {
  if (!(value > 0)) return 100;
  const padded = value * 1.12;
  const mag = 10 ** Math.floor(Math.log10(padded));
  const n = padded / mag;
  const nice = n <= 1 ? 1 : n <= 2 ? 2 : n <= 5 ? 5 : 10;
  return nice * mag;
}

export function ScheduleSbpChart({
  rows,
  marker = null,
  bare = false,
  title = "SBP vs pump strokes",
}: {
  rows: ScheduleRow[];
  /** Strokes pumped so far during playback; draws a cursor at the SBP being held. */
  marker?: number | null;
  /** Drop the card frame when the chart sits inside another card. */
  bare?: boolean;
  title?: string;
}) {
  const points = useMemo(
    () =>
      rows.map((row) => ({
        step: row.step,
        strokes: row.strokes,
        sbp: sbpValue(row),
        open: row.sbp === "Open Choke",
        flow: row.flow,
        notes: row.activityNotes,
      })),
    [rows],
  );

  const xMax = niceMax(Math.max(...points.map((p) => p.strokes), 1));
  const yMax = niceMax(Math.max(...points.map((p) => p.sbp), 1));
  const xFor = (stk: number) => L + (Math.max(0, stk) / xMax) * PW;
  const yFor = (psi: number) => T + (1 - Math.max(0, psi) / yMax) * PH;

  const yTicks = [0, 0.25, 0.5, 0.75, 1].map((f) => f * yMax);
  const xTicks = [0, 0.25, 0.5, 0.75, 1].map((f) => f * xMax);

  const d = points
    .map((p, i) => `${i === 0 ? "M" : "L"}${xFor(p.strokes).toFixed(1)} ${yFor(p.sbp).toFixed(1)}`)
    .join(" ");

  const [hover, setHover] = useState<number | null>(null);

  function onPointer(event: PointerEvent<SVGSVGElement>) {
    const svg = event.currentTarget;
    const pt = svg.createSVGPoint();
    pt.x = event.clientX;
    pt.y = event.clientY;
    const ctm = svg.getScreenCTM();
    if (!ctm) return;
    const local = pt.matrixTransform(ctm.inverse());
    if (local.x < L || local.x > R || local.y < T || local.y > B) {
      setHover(null);
      return;
    }
    let best = 0;
    let bestD = Infinity;
    points.forEach((p, i) => {
      const dx = local.x - xFor(p.strokes);
      const dist = dx * dx;
      if (dist < bestD) {
        bestD = dist;
        best = i;
      }
    });
    setHover(best);
  }

  if (!points.length) return null;
  const active = hover != null ? points[hover] : null;
  // SBP held at the marker: step 1's until its strokes are reached, then the last step reached.
  const held =
    marker != null
      ? points.reduce((acc, p) => (p.strokes <= marker + 1e-6 ? p : acc), points[0])
      : null;

  return (
    <section className={bare ? "" : "rounded-2xl border border-border bg-card p-4"}>
      <div className="mb-2 flex items-center justify-between gap-2">
        <h3 className="text-sm font-semibold">{title}</h3>
        <span className="text-[11px] text-muted-foreground">
          {active
            ? `Step ${active.step} · ${dStk(active.strokes)} stk · ${active.open ? "Open choke" : `${dPsi(active.sbp)} psi`}`
            : "Hover a step"}
        </span>
      </div>
      <svg
        viewBox={`0 0 ${VW} ${VH}`}
        className="wb-svg block h-auto w-full"
        role="img"
        aria-label="Surface backpressure versus pump strokes"
        onPointerMove={onPointer}
        onPointerLeave={() => setHover(null)}
      >
        {yTicks.map((psi) => (
          <g key={`y-${psi}`}>
            <line x1={L} x2={R} y1={yFor(psi)} y2={yFor(psi)} className="sbp-grid" />
            <text x={L - 8} y={yFor(psi) + 3} textAnchor="end" className="sbp-tick">
              {formatNumber(psi, 0)}
            </text>
          </g>
        ))}
        {xTicks.map((stk) => (
          <g key={`x-${stk}`}>
            <line x1={xFor(stk)} x2={xFor(stk)} y1={T} y2={B} className="sbp-grid" />
            <text x={xFor(stk)} y={B + 16} textAnchor="middle" className="sbp-tick">
              {formatNumber(stk, 0)}
            </text>
          </g>
        ))}
        <rect x={L} y={T} width={PW} height={PH} className="sbp-frame" />
        <path d={d} className="sbp-line" />
        {points.map((p, i) => (
          <circle
            key={p.step}
            cx={xFor(p.strokes)}
            cy={yFor(p.sbp)}
            r={hover === i ? 5 : 3.5}
            className={p.open ? "sbp-dot-open" : hover === i ? "sbp-dot-active" : "sbp-dot"}
          />
        ))}
        {active ? (
          <line
            x1={xFor(active.strokes)}
            x2={xFor(active.strokes)}
            y1={T}
            y2={B}
            className="wb-hover"
          />
        ) : null}
        {marker != null && held ? (
          <g data-sbp-marker>
            <line x1={xFor(marker)} x2={xFor(marker)} y1={T} y2={B} className="sbp-marker" />
            <circle cx={xFor(marker)} cy={yFor(held.sbp)} r="5" className="sbp-marker-dot" />
          </g>
        ) : null}
        <text x={(L + R) / 2} y={VH - 4} textAnchor="middle" className="sbp-axis">
          Pump strokes
        </text>
        <text
          x="14"
          y={(T + B) / 2}
          textAnchor="middle"
          className="sbp-axis"
          transform={`rotate(-90 14 ${(T + B) / 2})`}
        >
          SBP (psi)
        </text>
      </svg>
    </section>
  );
}
