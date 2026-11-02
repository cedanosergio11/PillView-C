import { useId, useMemo, useState, type PointerEvent } from "react";
import { dEmw, dFt, dPsi, ft, ppg, ppg2, tick0, tick1 } from "@/components/fmt";
import {
  emwAt,
  hydrostaticLayers,
  layerAt,
  niceTicks,
  pressureAt,
  sampleEmwProfile,
  tvdFn,
} from "@/lib/pill/hydrostatic";
import { PLOT_HEIGHT, PLOT_TOP, VIEW_H, VIEW_W } from "@/lib/pill/plot";
import type { PillModel, WellState } from "@/lib/pill/types";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";

const PLOT_LEFT = 58;
const PLOT_RIGHT = 404;
const PLOT_WIDTH = PLOT_RIGHT - PLOT_LEFT;
const PLOT_BOTTOM = PLOT_TOP + PLOT_HEIGHT;

const DEFAULT_MIN = 5;
const DEFAULT_MAX = 20;
const SCALE_ABS_MIN = 0;
const SCALE_ABS_MAX = 30;

type Props = {
  state: WellState;
  model: PillModel;
  probeDepth?: number | null;
  onProbeDepth?: (depth: number | null) => void;
  fit?: number | null;
  desiredEmw?: number | null;
  anchorMd?: number | null;
  anchorTvd?: number | null;
  casingMd?: number | null;
};

function clampScale(min: number, max: number) {
  let lo = Number.isFinite(min) ? min : DEFAULT_MIN;
  let hi = Number.isFinite(max) ? max : DEFAULT_MAX;
  lo = Math.max(SCALE_ABS_MIN, Math.min(SCALE_ABS_MAX - 1, lo));
  hi = Math.max(SCALE_ABS_MIN + 1, Math.min(SCALE_ABS_MAX, hi));
  if (hi - lo < 1) {
    hi = Math.min(SCALE_ABS_MAX, lo + 1);
    if (hi - lo < 1) lo = Math.max(SCALE_ABS_MIN, hi - 1);
  }
  return { min: lo, max: hi };
}

/**
 * niceTicks always adds the range ends, which can land a label on top of the
 * nearest round tick (5.0 next to 6.0, TD next to 18,000). Drop the crowded one:
 * the end itself (`keepEnds: false`) or its neighbour (`keepEnds: true`).
 */
function spaceTicks(ticks: number[], keepEnds: boolean, minGapFraction = 0.6): number[] {
  if (ticks.length < 4) return ticks;
  let step = 0;
  for (let i = 1; i < ticks.length; i += 1) step = Math.max(step, ticks[i] - ticks[i - 1]);
  const out = [...ticks];
  if (out[1] - out[0] < step * minGapFraction) out.splice(keepEnds ? 1 : 0, 1);
  const n = out.length;
  if (out[n - 1] - out[n - 2] < step * minGapFraction) out.splice(keepEnds ? n - 2 : n - 1, 1);
  return out;
}

function fitScale(emws: number[], baseMw: number, pillMw: number, extras: number[] = []) {
  const values = [...emws, baseMw, pillMw, ...extras].filter((n) => Number.isFinite(n));
  const lo = Math.min(...values);
  const hi = Math.max(...values);
  return clampScale(Math.floor(lo - 0.5), Math.ceil(hi + 0.5));
}

export function EmwProfile({
  state,
  model,
  probeDepth = null,
  onProbeDepth,
  fit = null,
  desiredEmw = null,
  anchorMd = null,
  anchorTvd = null,
  casingMd = null,
}: Props) {
  const clipId = `emw-plot-${useId().replace(/:/g, "")}`;
  const [emwMin, setEmwMin] = useState(DEFAULT_MIN);
  const [emwMax, setEmwMax] = useState(DEFAULT_MAX);
  const [minText, setMinText] = useState(DEFAULT_MIN.toFixed(1));
  const [maxText, setMaxText] = useState(DEFAULT_MAX.toFixed(1));
  const [localDepth, setLocalDepth] = useState<number | null>(null);

  const layers = useMemo(
    () => hydrostaticLayers(state, model),
    [state, model],
  );
  const toTvd = useMemo(() => tvdFn(state), [state.survey]);
  const points = useMemo(
    () => sampleEmwProfile(state.wellDepth, layers, toTvd, state.baseMw),
    [state.wellDepth, layers, toTvd, state.baseMw],
  );

  const scale = clampScale(emwMin, emwMax);
  const xTicks = spaceTicks(niceTicks(scale.min, scale.max, 5), false);
  const yTicks = spaceTicks(niceTicks(0, state.wellDepth, 8), true);
  const deviated = state.survey.some((p) => p.md - p.tvd > 1);

  const xFor = (emw: number) => {
    const t = (emw - scale.min) / (scale.max - scale.min);
    return PLOT_LEFT + Math.max(0, Math.min(1, t)) * PLOT_WIDTH;
  };
  const yFor = (depth: number) =>
    PLOT_TOP +
    (Math.max(0, Math.min(state.wellDepth, depth)) / state.wellDepth) *
      PLOT_HEIGHT;

  const emwPath = points
    .map((p, i) => {
      const cmd = i === 0 ? "M" : "L";
      return `${cmd}${xFor(p.emw).toFixed(2)} ${yFor(p.depth).toFixed(2)}`;
    })
    .join(" ");

  const localPath = layers
    .map((layer, i) => {
      const x = xFor(layer.mw);
      const y0 = yFor(layer.top);
      const y1 = yFor(layer.bottom);
      const jump =
        i === 0
          ? `M${x.toFixed(2)} ${y0.toFixed(2)}`
          : `L${x.toFixed(2)} ${y0.toFixed(2)}`;
      return `${jump} L${x.toFixed(2)} ${y1.toFixed(2)}`;
    })
    .join(" ");

  const hoverDepth = onProbeDepth ? probeDepth : localDepth;
  const hover =
    hoverDepth != null
      ? {
          depth: hoverDepth,
          tvd: toTvd(hoverDepth),
          pressure: pressureAt(hoverDepth, layers, toTvd, state.baseMw),
          emw: emwAt(hoverDepth, layers, toTvd, state.baseMw),
          layer: layerAt(hoverDepth, layers),
        }
      : null;

  const tdEmw = emwAt(state.wellDepth, layers, toTvd, state.baseMw);
  const tdPsi = pressureAt(state.wellDepth, layers, toTvd, state.baseMw);
  const shoeY = yFor(state.pipeDepth);
  const pillTopY = yFor(model.pillTop);
  const pillBtmY = yFor(model.pillBottom);
  const tdY = yFor(state.wellDepth);
  const showAnchor =
    anchorMd != null &&
    Number.isFinite(anchorMd) &&
    anchorMd > 0 &&
    Math.abs(anchorMd - state.wellDepth) > 30;
  const anchorY = showAnchor ? yFor(anchorMd) : null;
  const showCasing =
    casingMd != null &&
    Number.isFinite(casingMd) &&
    casingMd > 80 &&
    Math.abs(casingMd - state.wellDepth) > 30;
  const casingY = showCasing ? yFor(casingMd) : null;
  const anchorTvdUsed =
    showAnchor && anchorTvd != null && Number.isFinite(anchorTvd) && anchorTvd > 0
      ? anchorTvd
      : showAnchor && anchorMd != null
        ? toTvd(anchorMd)
        : 0;
  const anchorEmw = showAnchor && anchorMd != null ? emwAt(anchorMd, layers, toTvd, state.baseMw) : null;
  // Depth lines are labelled where they cross the plot. The legend lists only the
  // lines whose in-plot label had to be hidden for space.
  const bitLabelShown = shoeY < tdY - 18 && shoeY > PLOT_TOP + 70;
  const anchorLabelShown =
    anchorY != null && Math.abs(anchorY - shoeY) >= 16 && anchorY < tdY - 18 && anchorY > PLOT_TOP + 70;
  const casingLabelShown =
    casingY != null &&
    Math.abs(casingY - shoeY) >= 16 &&
    (anchorY == null || Math.abs(casingY - anchorY) >= 16) &&
    casingY < tdY - 18 &&
    casingY > PLOT_TOP + 70;
  const anchorPsi =
    showAnchor && anchorMd != null ? pressureAt(anchorMd, layers, toTvd, state.baseMw) : null;

  function commitScaleFromText() {
    const next = clampScale(Number(minText), Number(maxText));
    setEmwMin(next.min);
    setEmwMax(next.max);
    setMinText(next.min.toFixed(1));
    setMaxText(next.max.toFixed(1));
  }

  function applyFit() {
    const next = fitScale(
      points.map((p) => p.emw),
      state.baseMw,
      state.pillMw,
      [fit ?? Number.NaN, desiredEmw ?? Number.NaN],
    );
    setEmwMin(next.min);
    setEmwMax(next.max);
    setMinText(next.min.toFixed(1));
    setMaxText(next.max.toFixed(1));
  }

  function resetScale() {
    setEmwMin(DEFAULT_MIN);
    setEmwMax(DEFAULT_MAX);
    setMinText(DEFAULT_MIN.toFixed(1));
    setMaxText(DEFAULT_MAX.toFixed(1));
  }

  function depthFromEvent(event: PointerEvent<SVGSVGElement>) {
    const svg = event.currentTarget;
    const pt = svg.createSVGPoint();
    pt.x = event.clientX;
    pt.y = event.clientY;
    const ctm = svg.getScreenCTM();
    if (!ctm) return null;
    const local = pt.matrixTransform(ctm.inverse());
    if (local.y < PLOT_TOP || local.y > PLOT_BOTTOM) return null;
    return ((local.y - PLOT_TOP) / PLOT_HEIGHT) * state.wellDepth;
  }

  function onPointer(event: PointerEvent<SVGSVGElement>) {
    const depth = depthFromEvent(event);
    if (onProbeDepth) onProbeDepth(depth);
    else setLocalDepth(depth);
  }

  function onLeave() {
    if (onProbeDepth) onProbeDepth(null);
    else setLocalDepth(null);
  }

  const tipX = hover ? xFor(hover.emw) : 0;
  const tipY = hover ? yFor(hover.depth) : 0;
  const tipOnRight = hover ? tipX < PLOT_LEFT + PLOT_WIDTH * 0.55 : true;

  return (
    <div className="min-w-0 rounded-xl bg-card p-3 border border-border sm:p-4">
      <div className="mb-2 flex min-h-11 flex-wrap items-center justify-between gap-2">
        <h2 className="text-sm font-medium tracking-wide text-foreground">
          Equivalent Mud Weight
        </h2>
        <form
          className="flex flex-wrap items-center gap-1.5"
          onSubmit={(event) => {
            event.preventDefault();
            commitScaleFromText();
          }}
        >
          <span className="text-xs text-muted-foreground">EMW</span>
          <Input
            id="emw-axis-min"
            type="number"
            inputMode="decimal"
            min={SCALE_ABS_MIN}
            max={SCALE_ABS_MAX}
            step={0.5}
            value={minText}
            onChange={(event) => setMinText(event.target.value)}
            onBlur={commitScaleFromText}
            aria-label="EMW axis minimum, ppg"
            className="h-11 w-16 px-1.5 text-center"
          />
          <span className="text-xs text-muted-foreground">–</span>
          <Input
            id="emw-axis-max"
            type="number"
            inputMode="decimal"
            min={SCALE_ABS_MIN}
            max={SCALE_ABS_MAX}
            step={0.5}
            value={maxText}
            onChange={(event) => setMaxText(event.target.value)}
            onBlur={commitScaleFromText}
            aria-label="EMW axis maximum, ppg"
            className="h-11 w-16 px-1.5 text-center"
          />
          <Button type="button" variant="secondary" size="sm" className="h-11" onClick={applyFit}>
            Fit
          </Button>
          <Button type="button" variant="ghost" size="sm" className="h-11 px-2.5" onClick={resetScale}>
            5–20
          </Button>
        </form>
      </div>

      <div className="relative">
        <svg
          viewBox={`0 0 ${VIEW_W} ${VIEW_H}`}
          className="wb-svg emw-svg block h-auto w-full"
          role="img"
          aria-label="Equivalent mud weight versus measured depth"
          onPointerMove={onPointer}
          onPointerLeave={onLeave}
          onPointerDown={onPointer}
        >
          <defs>
            <clipPath id={clipId}>
              <rect
                x={PLOT_LEFT}
                y={PLOT_TOP}
                width={PLOT_WIDTH}
                height={PLOT_HEIGHT}
              />
            </clipPath>
          </defs>

          <rect
            x={PLOT_LEFT}
            y={PLOT_TOP}
            width={PLOT_WIDTH}
            height={PLOT_HEIGHT}
            className="emw-plot-bg"
          />

          {xTicks.map((tick) => {
            const x = xFor(tick);
            return (
              <g key={`x-${tick}`}>
                <line
                  x1={x}
                  x2={x}
                  y1={PLOT_TOP}
                  y2={PLOT_BOTTOM}
                  className="emw-grid"
                />
                <text
                  x={x}
                  y={PLOT_TOP - 10}
                  textAnchor="middle"
                  className="wb-muted-label"
                >
                  {tick1(tick)}
                </text>
                <text
                  x={x}
                  y={PLOT_BOTTOM + 16}
                  textAnchor="middle"
                  className="wb-muted-label"
                >
                  {tick1(tick)}
                </text>
              </g>
            );
          })}

          {yTicks.map((tick) => {
            const y = yFor(tick);
            const isTd = Math.abs(tick - state.wellDepth) < 0.5;
            return (
              <g key={`y-${tick}`}>
                <line
                  x1={PLOT_LEFT}
                  x2={PLOT_RIGHT}
                  y1={y}
                  y2={y}
                  className="emw-grid"
                />
                <text
                  x={PLOT_LEFT - 8}
                  y={y + 3}
                  textAnchor="end"
                  className="wb-muted-label"
                >
                  {isTd ? "TD" : tick0(tick)}
                </text>
              </g>
            );
          })}

          <rect
            x={PLOT_LEFT}
            y={PLOT_TOP}
            width={PLOT_WIDTH}
            height={PLOT_HEIGHT}
            className="emw-frame"
          />

          {/* Axis titles sit above the plot so they never cross the tick labels. */}
          <text x={PLOT_LEFT - 8} y={PLOT_TOP - 28} textAnchor="end" className="wb-muted-label emw-axis-title">
            MD, ft
          </text>
          <text
            x={(PLOT_LEFT + PLOT_RIGHT) / 2}
            y={PLOT_TOP - 28}
            textAnchor="middle"
            className="wb-muted-label emw-axis-title"
          >
            EMW, ppg
          </text>

          <g clipPath={`url(#${clipId})`}>
            <line
              x1={xFor(state.baseMw)}
              x2={xFor(state.baseMw)}
              y1={PLOT_TOP}
              y2={PLOT_BOTTOM}
              className="emw-ref-base"
            />
            <line
              x1={xFor(state.pillMw)}
              x2={xFor(state.pillMw)}
              y1={PLOT_TOP}
              y2={PLOT_BOTTOM}
              className="emw-ref-pill"
            />
            {desiredEmw != null && Number.isFinite(desiredEmw) ? (
              <line
                x1={xFor(desiredEmw)}
                x2={xFor(desiredEmw)}
                y1={PLOT_TOP}
                y2={PLOT_BOTTOM}
                className="emw-ref-target"
              />
            ) : null}
            {fit != null && Number.isFinite(fit) ? (
              <line
                x1={xFor(fit)}
                x2={xFor(fit)}
                y1={PLOT_TOP}
                y2={PLOT_BOTTOM}
                className="emw-ref-fit"
              />
            ) : null}

            <path d={localPath} className="emw-local" />
            <path d={emwPath} className="emw-curve" />

            <line
              x1={PLOT_LEFT}
              x2={PLOT_RIGHT}
              y1={pillTopY}
              y2={pillTopY}
              className="emw-pill-guide"
            />
            <line
              x1={PLOT_LEFT}
              x2={PLOT_RIGHT}
              y1={pillBtmY}
              y2={pillBtmY}
              className="emw-pill-guide"
            />

            <line
              x1={PLOT_LEFT}
              x2={PLOT_RIGHT}
              y1={shoeY}
              y2={shoeY}
              className="emw-shoe"
            />
            {anchorY != null ? (
              <line
                x1={PLOT_LEFT}
                x2={PLOT_RIGHT}
                y1={anchorY}
                y2={anchorY}
                className="emw-anchor"
              />
            ) : null}
            {casingY != null ? (
              <line
                x1={PLOT_LEFT}
                x2={PLOT_RIGHT}
                y1={casingY}
                y2={casingY}
                className="wb-casing-line"
              />
            ) : null}
            <line
              x1={PLOT_LEFT}
              x2={PLOT_RIGHT}
              y1={tdY}
              y2={tdY}
              className="emw-td"
            />
          </g>

          <circle
            cx={xFor(tdEmw)}
            cy={tdY}
            r="3.5"
            className="emw-td-dot"
          />
          <text
            x={Math.min(PLOT_RIGHT - 4, xFor(tdEmw) + 8)}
            y={tdY - 8}
            className="emw-td-label"
          >
            {dEmw(tdEmw)}
          </text>

          {anchorY != null && anchorEmw != null ? (
            <g>
              <circle
                cx={xFor(anchorEmw)}
                cy={anchorY}
                r="3.5"
                className="emw-anchor-dot"
              />
              <text
                x={Math.min(PLOT_RIGHT - 4, xFor(anchorEmw) + 8)}
                y={anchorY - 8}
                className="emw-anchor-label"
              >
                {dEmw(anchorEmw)}
              </text>
            </g>
          ) : null}

          {bitLabelShown ? (
            <text
              x={PLOT_LEFT + 8}
              y={shoeY - 5}
              className="wb-data"
            >
              Bit {dFt(state.pipeDepth)}
            </text>
          ) : null}

          {anchorLabelShown ? (
            <text
              x={PLOT_LEFT + 8}
              y={(anchorY ?? 0) - 5}
              className="wb-anchor-label"
            >
              Anchor {dFt(anchorMd ?? 0)}
            </text>
          ) : null}

          {casingLabelShown ? (
            <text
              x={PLOT_LEFT + 8}
              y={casingY - 5}
              className="wb-casing-label"
            >
              Csg {dFt(casingMd ?? 0)}
            </text>
          ) : null}

          {hover ? (
            <g>
              <line
                x1={PLOT_LEFT}
                x2={PLOT_RIGHT}
                y1={tipY}
                y2={tipY}
                className="wb-hover"
              />
              <line
                x1={tipX}
                x2={tipX}
                y1={PLOT_TOP}
                y2={PLOT_BOTTOM}
                className="wb-hover"
              />
              <circle cx={tipX} cy={tipY} r="4" className="emw-probe-dot" />
            </g>
          ) : null}

          <rect
            x={PLOT_LEFT}
            y={PLOT_TOP}
            width={PLOT_WIDTH}
            height={PLOT_HEIGHT}
            fill="transparent"
            className="emw-hit"
          />
        </svg>

        <div
          className={cn(
            "pointer-events-none absolute z-10 min-w-44 rounded-md border border-border bg-card/95 px-2.5 py-2 font-mono text-xs text-foreground",
            hover ? "opacity-100" : "opacity-0",
          )}
          style={
            hover
              ? {
                  left: `${((tipOnRight ? tipX + 14 : tipX - 14) / VIEW_W) * 100}%`,
                  top: `${(tipY / VIEW_H) * 100}%`,
                  transform: tipOnRight
                    ? "translate(0, -20%)"
                    : "translate(-100%, -20%)",
                }
              : undefined
          }
        >
          {hover ? (
            <div className="space-y-0.5">
              <div className="text-pill">
                EMW: {ppg2(hover.emw)}
              </div>
              <div>Pressure: {dPsi(hover.pressure)} psi</div>
              <div>Depth (MD): {dFt(hover.depth)} ft</div>
              <div>Depth (TVD): {dFt(hover.tvd)} ft</div>
              <div className="pt-0.5 text-muted-foreground">
                {hover.layer?.name ?? "—"} · {ppg(hover.layer?.mw ?? 0)}
              </div>
            </div>
          ) : null}
        </div>
      </div>

      <div className="mt-3 flex flex-wrap justify-center gap-x-4 gap-y-2 text-xs text-muted-foreground">
        <LegendSwatch lineClass="emw-curve" label="Static EMW" />
        <LegendSwatch lineClass="emw-local" label="Local fluid MW" />
        {desiredEmw != null ? (
          <LegendSwatch lineClass="emw-ref-target" label={`Target EMW ${dEmw(desiredEmw)} ppge`} />
        ) : null}
        {fit != null ? <LegendSwatch lineClass="emw-ref-fit" label={`FIT ${dEmw(fit)} ppge`} /> : null}
        {!bitLabelShown ? <LegendSwatch lineClass="emw-shoe" label={`Bit ${dFt(state.pipeDepth)} ft`} /> : null}
        {anchorY != null && !anchorLabelShown ? (
          <LegendSwatch lineClass="emw-anchor" label={`Anchor ${dFt(anchorMd ?? 0)} ft`} />
        ) : null}
        {casingY != null && !casingLabelShown ? (
          <LegendSwatch lineClass="wb-casing-line" label={`Casing shoe ${dFt(casingMd ?? 0)} ft`} />
        ) : null}
      </div>
      <p className="mt-3 text-center text-xs text-pretty text-muted-foreground">
        EMW = hydrostatic pressure / (0.052 × TVD).{" "}
        {deviated
          ? "TVD is interpolated from the MD/TVD pairs on the inputs."
          : "Vertical well: no TVD below MD is entered."}{" "}
        No circulating ECD or surface backpressure. Hover either track to inspect. Not for
        operational decisions.
      </p>
      <p className="sr-only">
        Bottomhole equivalent mud weight {ppg2(tdEmw)} at {ft(state.wellDepth)},
        {dPsi(tdPsi)} psi
        {anchorEmw != null && anchorMd != null
          ? `. Anchor EMW ${ppg2(anchorEmw)} at ${ft(anchorMd)}${anchorPsi != null ? `, ${dPsi(anchorPsi)} psi` : ""}`
          : ""}
        . Axis from {ppg(scale.min)} to {ppg(scale.max)}.
      </p>
    </div>
  );
}

/** Legend sample drawn with the same stroke class as the plotted line, so dashes and colours match. */
function LegendSwatch({ lineClass, label }: { lineClass: string; label: string }) {
  return (
    <span className="inline-flex items-center gap-2">
      <svg width="22" height="8" viewBox="0 0 22 8" aria-hidden="true" className="shrink-0 overflow-visible">
        <line x1="1" x2="21" y1="4" y2="4" className={lineClass} />
      </svg>
      {label}
    </span>
  );
}
