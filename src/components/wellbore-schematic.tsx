import { useId, useMemo, useState } from "react";
import type { PointerEvent } from "react";
import { dBbl, dFt, dPsi, ft, ppg2 } from "@/components/fmt";
import { emwAt, hydrostaticLayers, layerAt, pressureAt, tvdFn } from "@/lib/pill/hydrostatic";
import { PLOT_HEIGHT, PLOT_TOP, VIEW_H, VIEW_W } from "@/lib/pill/plot";
import type { PillModel, WellState } from "@/lib/pill/types";
import { cn } from "@/lib/utils";
const HOLE_X = 124;
const HOLE_W = 176;
const CX = HOLE_X + HOLE_W / 2;
const LABEL_GAP = 15;

type Props = {
  state: WellState;
  model: PillModel;
  probeDepth?: number | null;
  onProbeDepth?: (depth: number | null) => void;
  programTop?: number | null;
  programBottom?: number | null;
  anchorMd?: number | null;
  casingMd?: number | null;
};

function spreadLabels(
  items: { id: string; y: number }[],
  minY: number,
  maxY: number,
  gap = LABEL_GAP,
): Record<string, number> {
  if (!items.length) return {};
  const sorted = [...items].sort((a, b) => a.y - b.y || a.id.localeCompare(b.id));
  const ys = sorted.map((s) => Math.max(minY, Math.min(maxY, s.y)));
  for (let i = 1; i < ys.length; i++) {
    if (ys[i] - ys[i - 1] < gap) ys[i] = ys[i - 1] + gap;
  }
  if (ys[ys.length - 1] > maxY) {
    ys[ys.length - 1] = maxY;
    for (let i = ys.length - 2; i >= 0; i--) {
      if (ys[i + 1] - ys[i] < gap) ys[i] = ys[i + 1] - gap;
    }
  }
  if (ys[0] < minY) {
    ys[0] = minY;
    for (let i = 1; i < ys.length; i++) {
      if (ys[i] - ys[i - 1] < gap) ys[i] = ys[i - 1] + gap;
    }
  }
  const out: Record<string, number> = {};
  sorted.forEach((s, i) => {
    out[s.id] = ys[i];
  });
  return out;
}

function farFrom(y: number, others: number[], gap = LABEL_GAP) {
  return others.every((o) => Math.abs(o - y) >= gap);
}

/** Inside-DP air: RKB down to the first fluid in the string (chase, else KMW, else the bit). */
export function dpAirBottomFt(model: { pipeChaseInHole: number; pipeChaseTop: number; pipeKmwInHole: number; pipeKmwTop: number }, pipeDepth: number): number {
  return model.pipeChaseInHole > 0.05 ? model.pipeChaseTop : model.pipeKmwInHole > 0.05 ? model.pipeKmwTop : pipeDepth;
}
/** The air band is drawn (and labelled, and in the legend) once its bottom is more than ~1 ft below RKB. */
export const DP_AIR_MIN_FT = 1;
/** Visual minimum height of the air band. Drawing only: depth values and labels are unchanged. */
const DP_AIR_MIN_PX = 8;

export function WellboreSchematic({
  state,
  model,
  probeDepth = null,
  onProbeDepth,
  programTop = null,
  programBottom = null,
  anchorMd = null,
  casingMd = null,
}: Props) {
  const uid = useId().replace(/:/g, "");
  const holeClip = `hole-${uid}`;
  const formPat = `form-${uid}`;
  const pipeGrad = `pipe-${uid}`;
  const pillGrad = `pill-${uid}`;
  const fillGrad = `fill-${uid}`;
  const fluidGrad = `fluid-${uid}`;
  const arrow = `arrow-${uid}`;

  const yFor = (depth: number) =>
    PLOT_TOP + (Math.max(0, Math.min(state.wellDepth, depth)) / state.wellDepth) * PLOT_HEIGHT;

  const rawOuter = HOLE_W * (state.pipeOd / Math.max(state.holeId, 0.1));
  const rawInner = HOLE_W * (state.pipeId / Math.max(state.holeId, 0.1));
  const pipeOuter = Math.min(HOLE_W - 14, Math.max(36, rawOuter));
  const pipeInner = Math.min(pipeOuter - 14, Math.max(12, rawInner));
  const outerLeft = CX - pipeOuter / 2;
  const innerLeft = CX - pipeInner / 2;
  const wall = Math.max(3, (pipeOuter - pipeInner) / 2);
  const leftW = Math.max(0, outerLeft - HOLE_X);
  const rightX = outerLeft + pipeOuter;
  const rightW = Math.max(0, HOLE_X + HOLE_W - rightX);
  const annLabelX = rightW >= leftW ? rightX + rightW / 2 : HOLE_X + leftW / 2;

  const surfaceY = yFor(model.fluidDrop);
  const fillY = yFor(model.fillZoneDepth);
  const pillY = yFor(model.pillTop);
  const pillBottomY = yFor(model.pillBottom);
  const pipeBottomY = yFor(state.pipeDepth);
  const placeY = yFor(state.referencePipeDepth);
  const pipeKmwY = yFor(model.pipeKmwTop);
  const pipeChaseY = yFor(model.pipeChaseTop);
  const tdY = PLOT_TOP + PLOT_HEIGHT;
  const programY = programTop != null ? yFor(programTop) : null;
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
    casingMd < state.wellDepth - 10;
  const casingY = showCasing ? yFor(casingMd) : null;
  const CSG_CEMENT = 6;
  const CSG_WALL = 4;
  const csgOuterL = HOLE_X;
  const csgInnerL = HOLE_X + CSG_CEMENT + CSG_WALL;
  const csgOuterR = HOLE_X + HOLE_W;
  const csgInnerR = HOLE_X + HOLE_W - CSG_CEMENT - CSG_WALL;

  const layers = useMemo(
    () => hydrostaticLayers(state, model),
    [state, model],
  );

  const [localHover, setLocalHover] = useState<{ depth: number; y: number } | null>(null);

  function onPointer(event: PointerEvent<SVGSVGElement>) {
    const svg = event.currentTarget;
    const pt = svg.createSVGPoint();
    pt.x = event.clientX;
    pt.y = event.clientY;
    const ctm = svg.getScreenCTM();
    if (!ctm) return;
    const local = pt.matrixTransform(ctm.inverse());
    if (local.y < PLOT_TOP || local.y > tdY) {
      if (onProbeDepth) onProbeDepth(null);
      else setLocalHover(null);
      return;
    }
    const depth = ((local.y - PLOT_TOP) / PLOT_HEIGHT) * state.wellDepth;
    if (onProbeDepth) onProbeDepth(depth);
    else setLocalHover({ depth, y: local.y });
  }

  const hoverDepth = onProbeDepth ? probeDepth : localHover?.depth ?? null;
  const hoverY = hoverDepth != null ? yFor(hoverDepth) : null;
  const hoverLayer = hoverDepth != null ? layerAt(hoverDepth, layers) : null;
  const hoverPsi = hoverDepth != null ? pressureAt(hoverDepth, layers, tvdFn(state), state.baseMw) : 0;
  const hoverEmw = hoverDepth != null ? emwAt(hoverDepth, layers, tvdFn(state), state.baseMw) : 0;

  const closed = state.pipeEnd === "closed";
  const pipeHeight = Math.max(8, pipeBottomY - PLOT_TOP);

  const shoePath = closed
    ? `M${outerLeft.toFixed(1)} ${pipeBottomY.toFixed(1)} L${(outerLeft + pipeOuter).toFixed(1)} ${pipeBottomY.toFixed(1)} L${(outerLeft + pipeOuter - wall).toFixed(1)} ${(pipeBottomY + 11).toFixed(1)} L${(outerLeft + wall).toFixed(1)} ${(pipeBottomY + 11).toFixed(1)} Z`
    : [
        `M${outerLeft.toFixed(1)} ${pipeBottomY.toFixed(1)} L${(innerLeft).toFixed(1)} ${pipeBottomY.toFixed(1)} L${innerLeft.toFixed(1)} ${(pipeBottomY + 9).toFixed(1)} L${outerLeft.toFixed(1)} ${(pipeBottomY + 9).toFixed(1)} Z`,
        `M${(innerLeft + pipeInner).toFixed(1)} ${pipeBottomY.toFixed(1)} L${(outerLeft + pipeOuter).toFixed(1)} ${pipeBottomY.toFixed(1)} L${(outerLeft + pipeOuter).toFixed(1)} ${(pipeBottomY + 9).toFixed(1)} L${(innerLeft + pipeInner).toFixed(1)} ${(pipeBottomY + 9).toFixed(1)} Z`,
      ].join(" ");

  const showPlaceLine = Math.abs(state.pipeDepth - state.referencePipeDepth) >= 1;
  const showPlaceLabel = showPlaceLine && Math.abs(placeY - pipeBottomY) >= LABEL_GAP;
  const fillVisible = model.fillZoneVolume > 0.02;
  const moving = Math.abs(model.pipeDelta) >= 1;
  const down = model.pipeDelta > 0;
  const showProgram =
    programTop != null && programBottom != null && programBottom > programTop;
  const showProgramLabel =
    showProgram && programY != null && Math.abs(programY - pillY) >= LABEL_GAP;

  const leftItems: { id: string; y: number }[] = [
    { id: "top", y: pillY + 4 },
    { id: "btm", y: pillBottomY + 4 },
  ];
  if (moving) {
    leftItems.push({ id: "motion", y: down ? pipeBottomY + 4 : pipeBottomY - 22 });
  }
  const leftY = spreadLabels(leftItems, PLOT_TOP + 10, tdY - 4);

  const showAnchorLabel =
    anchorY != null && farFrom(anchorY + 4, [pipeBottomY + 4], LABEL_GAP);

  const airBottomFt = dpAirBottomFt(model, state.pipeDepth);
  const airShown = airBottomFt > DP_AIR_MIN_FT;
  const airTrueY = yFor(airBottomFt);
  // Visual floor only: the band is at least DP_AIR_MIN_PX tall; fluid below starts under it on screen.
  const airVisY = airShown ? Math.max(airTrueY, PLOT_TOP + DP_AIR_MIN_PX) : PLOT_TOP;
  const airLabelY = airVisY - PLOT_TOP >= 14 ? PLOT_TOP + (airVisY - PLOT_TOP) / 2 + 3.5 : airVisY + 11;
  const showDpKmwLabel = model.pipeKmwInHole > 0.05 && pipeBottomY - pipeKmwY > 16;
  const showDpChaseLabel = model.pipeChaseInHole > 0.05 && pipeKmwY - pipeChaseY > 16;
  const pillBelowBit = pillBottomY - Math.max(pillY, pipeBottomY) > 28;
  const annulusVolY = pillBelowBit
    ? (Math.max(pillY, pipeBottomY) + pillBottomY) / 2 + 4
    : (Math.max(pillY, PLOT_TOP) + Math.min(pillBottomY, pipeBottomY)) / 2 + 4;
  const annulusVolX = pillBelowBit ? CX : annLabelX;
  const showAnnulusVol = pillBottomY - pillY > 22 && model.annularKmwVolume > 0.05;
  const showFillLabel = model.backfillVolume > 0.05 || model.tripTankGain > 0.05 || model.pipeFluidVolume > 0.05;
  const fillLabelY = Math.min(pillY - 12, (PLOT_TOP + Math.max(pillY, PLOT_TOP + 36)) / 2);
  const centerY = spreadLabels(
    [
      ...(showAnnulusVol ? [{ id: "annulus", y: annulusVolY }] : []),
      ...(showFillLabel ? [{ id: "fill", y: fillLabelY }] : []),
    ],
    PLOT_TOP + 16,
    tdY - 12,
  );

  return (
    <div className="relative">
      <svg
        viewBox={`0 0 ${VIEW_W} ${VIEW_H}`}
        className="wb-svg block h-auto w-full"
        role="img"
        aria-label="Wellbore schematic with pipe, pill, and backfill"
        onPointerMove={onPointer}
        onPointerLeave={() => {
          if (onProbeDepth) onProbeDepth(null);
          else setLocalHover(null);
        }}
      >
        <defs>
          <clipPath id={holeClip}>
            <rect x={HOLE_X} y={PLOT_TOP} width={HOLE_W} height={PLOT_HEIGHT} rx="3" />
          </clipPath>
          <pattern id={formPat} width="10" height="10" patternUnits="userSpaceOnUse">
            <rect width="10" height="10" className="wb-form-base" />
            <path d="M0 10 L10 0" className="wb-form-hatch" />
          </pattern>
          <linearGradient id={pipeGrad} x1="0" x2="1">
            <stop offset="0" className="wb-pipe-edge" />
            <stop offset="0.42" className="wb-pipe-hi" />
            <stop offset="1" className="wb-pipe-edge" />
          </linearGradient>
          <linearGradient id={pillGrad} x1="0" x2="1">
            <stop offset="0" className="wb-pill-edge" />
            <stop offset="0.5" className="wb-pill-hi" />
            <stop offset="1" className="wb-pill-edge" />
          </linearGradient>
          <linearGradient id={fillGrad} x1="0" x2="1">
            <stop offset="0" className="wb-fill-edge" />
            <stop offset="0.5" className="wb-fill-hi" />
            <stop offset="1" className="wb-fill-edge" />
          </linearGradient>
          <linearGradient id={fluidGrad} x1="0" x2="1">
            <stop offset="0" className="wb-fluid-edge" />
            <stop offset="0.5" className="wb-fluid-hi" />
            <stop offset="1" className="wb-fluid-edge" />
          </linearGradient>
          <marker id={arrow} markerWidth="8" markerHeight="8" refX="4" refY="4" orient="auto">
            <path d="M0,0 L8,4 L0,8 Z" className="wb-fg-fill" />
          </marker>
        </defs>

        <rect x="64" y={PLOT_TOP} width="60" height={PLOT_HEIGHT} fill={`url(#${formPat})`} />
        <rect x="300" y={PLOT_TOP} width="60" height={PLOT_HEIGHT} fill={`url(#${formPat})`} />

        <line x1="64" x2="360" y1={PLOT_TOP} y2={PLOT_TOP} className="wb-surface" />
        <text x="368" y={PLOT_TOP + 4} className="wb-muted-label">
          RKB
        </text>

        <g clipPath={`url(#${holeClip})`}>
          <rect
            x={HOLE_X}
            y={PLOT_TOP}
            width={HOLE_W}
            height={PLOT_HEIGHT}
            className="wb-empty"
          />
          {(() => {
            const fluidLeft = showCasing ? csgInnerL : HOLE_X;
            const fluidRight = showCasing ? csgInnerR : HOLE_X + HOLE_W;
            const layer = (y0: number, y1: number, fill: string, className?: string) => {
              const top = Math.max(y0, PLOT_TOP);
              const bot = Math.min(y1, tdY);
              if (bot <= top) return null;
              const split = pipeBottomY;
              const csgSplit = casingY ?? PLOT_TOP;
              const bands = (x0: number, x1: number, yA: number, yB: number) =>
                yB > yA && x1 > x0 ? (
                  <rect
                    x={x0}
                    y={yA}
                    width={x1 - x0}
                    height={yB - yA}
                    fill={fill}
                    className={className}
                  />
                ) : null;
              const leftPipe = outerLeft;
              const rightPipe = outerLeft + pipeOuter;
              return (
                <>
                  {bands(fluidLeft, leftPipe, top, Math.min(bot, split, csgSplit))}
                  {bands(rightPipe, fluidRight, top, Math.min(bot, split, csgSplit))}
                  {showCasing
                    ? (
                      <>
                        {bands(HOLE_X, leftPipe, Math.max(top, csgSplit), Math.min(bot, split))}
                        {bands(rightPipe, HOLE_X + HOLE_W, Math.max(top, csgSplit), Math.min(bot, split))}
                      </>
                    )
                    : null}
                  {bands(HOLE_X, HOLE_X + HOLE_W, Math.max(top, split), bot)}
                </>
              );
            };
            return (
              <>
                {layer(
                  state.autoBackfill ? PLOT_TOP : surfaceY,
                  tdY,
                  "var(--color-fluid)",
                )}
                {layer(pillY, pillBottomY, `url(#${pillGrad})`, "wb-pill-stroke")}
              </>
            );
          })()}
        </g>

        <rect
          x={HOLE_X}
          y={PLOT_TOP}
          width={HOLE_W}
          height={PLOT_HEIGHT}
          rx="3"
          className="wb-hole-wall"
        />

        {showCasing && casingY != null ? (
          <g>
            <rect
              x={csgOuterL}
              y={PLOT_TOP}
              width={CSG_CEMENT}
              height={Math.max(0, casingY - PLOT_TOP)}
              className="wb-cement"
            />
            <rect
              x={csgInnerR + CSG_WALL}
              y={PLOT_TOP}
              width={CSG_CEMENT}
              height={Math.max(0, casingY - PLOT_TOP)}
              className="wb-cement"
            />
            <rect
              x={csgInnerL - CSG_WALL}
              y={PLOT_TOP}
              width={CSG_WALL}
              height={Math.max(0, casingY - PLOT_TOP)}
              className="wb-casing"
            />
            <rect
              x={csgInnerR}
              y={PLOT_TOP}
              width={CSG_WALL}
              height={Math.max(0, casingY - PLOT_TOP)}
              className="wb-casing"
            />
            <path
              d={`M${csgInnerL - CSG_WALL} ${casingY} L${csgOuterL - 2} ${casingY + 10} L${csgInnerL} ${casingY + 10} L${csgInnerL} ${casingY} Z`}
              className="wb-casing-shoe"
            />
            <path
              d={`M${csgInnerR + CSG_WALL} ${casingY} L${csgOuterR + 2} ${casingY + 10} L${csgInnerR} ${casingY + 10} L${csgInnerR} ${casingY} Z`}
              className="wb-casing-shoe"
            />
          </g>
        ) : null}

        <g>
          <rect
            x={innerLeft}
            y={PLOT_TOP}
            width={pipeInner}
            height={pipeHeight}
            className="wb-bore-closed"
          />
          <rect
            x={innerLeft}
            y={PLOT_TOP}
            width={pipeInner}
            height={Math.max(0, airVisY - PLOT_TOP)}
            className="wb-bore-air"
            data-dp-air={airShown ? "true" : undefined}
          />
          {model.pipeChaseInHole > 0.05 ? (
            <rect
              x={innerLeft}
              y={Math.max(pipeChaseY, airVisY)}
              width={pipeInner}
              height={Math.max(0, pipeKmwY - Math.max(pipeChaseY, airVisY))}
              fill="var(--color-fluid)"
            />
          ) : null}
          {model.pipeKmwInHole > 0.05 ? (
            <>
              <rect
                x={innerLeft}
                y={Math.max(pipeKmwY, airVisY)}
                width={pipeInner}
                height={Math.max(0, pipeBottomY - Math.max(pipeKmwY, airVisY))}
                fill={`url(#${pillGrad})`}
                className="wb-pill-stroke"
              />
              <line
                x1={innerLeft}
                x2={innerLeft + pipeInner}
                y1={pipeKmwY}
                y2={pipeKmwY}
                className="wb-kmw-level"
              />
            </>
          ) : null}
          <rect
            x={outerLeft}
            y={PLOT_TOP}
            width={wall}
            height={pipeHeight}
            fill={`url(#${pipeGrad})`}
          />
          <rect
            x={outerLeft + pipeOuter - wall}
            y={PLOT_TOP}
            width={wall}
            height={pipeHeight}
            fill={`url(#${pipeGrad})`}
          />
          <path d={shoePath} fill={`url(#${pipeGrad})`} />
        </g>

        {showPlaceLine ? (
          <g>
            <line
              x1="72"
              x2="352"
              y1={placeY}
              y2={placeY}
              className="wb-place"
            />
            {showPlaceLabel ? (
              <text x="368" y={placeY - 6} className="wb-place-label">
                Place {ft(state.referencePipeDepth)}
              </text>
            ) : null}
          </g>
        ) : null}

        {showProgram ? (
          <g>
            <line
              x1={HOLE_X + HOLE_W}
              x2={HOLE_X + HOLE_W + 8}
              y1={yFor(programTop)}
              y2={yFor(programTop)}
              className="wb-program"
            />
            <line
              x1={HOLE_X + HOLE_W}
              x2={HOLE_X + HOLE_W + 8}
              y1={yFor(programBottom)}
              y2={yFor(programBottom)}
              className="wb-program"
            />
            <line
              x1={HOLE_X + HOLE_W + 8}
              x2={HOLE_X + HOLE_W + 8}
              y1={yFor(programTop)}
              y2={yFor(programBottom)}
              className="wb-program"
            />
            {showProgramLabel ? (
              <text
                x={HOLE_X + HOLE_W + 12}
                y={programY + 4}
                className="wb-program-label"
              >
                No-DP
              </text>
            ) : null}
          </g>
        ) : null}

        <line
          x1={HOLE_X - 10}
          x2={HOLE_X}
          y1={pillY}
          y2={pillY}
          className="wb-pill-tick"
        />
        <text x={HOLE_X - 14} y={leftY.top} textAnchor="end" className="wb-data">
          Top {ft(model.pillTop)}
        </text>
        <line
          x1={HOLE_X - 10}
          x2={HOLE_X}
          y1={pillBottomY}
          y2={pillBottomY}
          className="wb-pill-tick"
        />
        <text x={HOLE_X - 14} y={leftY.btm} textAnchor="end" className="wb-data">
          Btm {ft(model.pillBottom)}
        </text>

        {leftY.string != null ? (
          <>
            <line
              x1={HOLE_X - 10}
              x2={HOLE_X}
              y1={pipeKmwY}
              y2={pipeKmwY}
              className="wb-pill-tick"
            />
            <text x={HOLE_X - 14} y={leftY.string} textAnchor="end" className="wb-data">
              String {dBbl(model.pipeKmwInHole)} bbl
            </text>
          </>
        ) : null}

        {airShown ? (
          <text
            x={CX}
            y={airLabelY}
            textAnchor="middle"
            className="wb-muted-label"
            data-dp-air-label
          >
            Air 0–{dFt(airBottomFt)} ft
          </text>
        ) : null}

        {showDpChaseLabel ? (
          <text
            x={CX}
            y={(pipeChaseY + pipeKmwY) / 2 - 4}
            textAnchor="middle"
            className="wb-vol-kicker"
          >
            Inside DP
          </text>
        ) : null}
        {showDpChaseLabel ? (
          <text
            x={CX}
            y={(pipeChaseY + pipeKmwY) / 2 + 8}
            textAnchor="middle"
            className="wb-data"
          >
            Chase {dBbl(model.pipeChaseInHole)} bbl
          </text>
        ) : null}

        {showDpKmwLabel ? (
          <>
            {!showDpChaseLabel ? (
              <text
                x={CX}
                y={(pipeKmwY + pipeBottomY) / 2 - 4}
                textAnchor="middle"
                className="wb-vol-kicker"
              >
                Inside DP
              </text>
            ) : null}
            <text
              x={CX}
              y={(pipeKmwY + pipeBottomY) / 2 + (showDpChaseLabel ? 4 : 8)}
              textAnchor="middle"
              className="wb-data"
            >
              KMW {dBbl(model.pipeKmwInHole)} bbl
            </text>
          </>
        ) : null}

        {showAnnulusVol ? (
          <>
            <text
              x={annulusVolX}
              y={centerY.annulus - 6}
              textAnchor="middle"
              className="wb-vol-kicker"
            >
              Annulus
            </text>
            <text
              x={annulusVolX}
              y={centerY.annulus + 7}
              textAnchor="middle"
              className="wb-data"
            >
              KMW {dBbl(model.annularKmwVolume)} bbl
            </text>
          </>
        ) : null}

        {showFillLabel ? (
          <text
            x={annLabelX}
            y={centerY.fill}
            textAnchor="middle"
            className="wb-data"
          >
            {model.pipeDelta > 0
              ? `TT Gain ${dBbl(model.tripTankGain)} bbl`
              : `TT Fill ${dBbl(model.backfillVolume)} bbl`}
          </text>
        ) : null}

        <line
          x1={outerLeft + pipeOuter}
          x2="328"
          y1={pipeBottomY}
          y2={pipeBottomY}
          className="wb-grid"
        />
        <text x="332" y={pipeBottomY + 4} className="wb-data">
          Bit {ft(state.pipeDepth)}
        </text>

        {showCasing && casingY != null ? (
          <g>
            <line
              x1="72"
              x2="352"
              y1={casingY}
              y2={casingY}
              className="wb-casing-line"
            />
            {/* "Csg" keeps a five-digit depth inside the 440-unit viewBox on a phone. */}
            {farFrom(casingY + 4, [pipeBottomY + 4, ...(anchorY != null ? [anchorY + 4] : [])], LABEL_GAP) ? (
              <text x="332" y={casingY + 4} className="wb-casing-label">
                Csg {ft(casingMd ?? 0)}
              </text>
            ) : null}
          </g>
        ) : null}

        {showAnchor && anchorY != null ? (
          <g>
            <line
              x1="72"
              x2="352"
              y1={anchorY}
              y2={anchorY}
              className="wb-anchor"
            />
            {showAnchorLabel ? (
              <text x="332" y={anchorY + 4} className="wb-anchor-label">
                Anchor {ft(anchorMd ?? 0)}
              </text>
            ) : null}
          </g>
        ) : null}

        {moving ? (
          <g>
            <line
              x1="88"
              x2="88"
              y1={down ? pipeBottomY - 52 : pipeBottomY - 18}
              y2={down ? pipeBottomY - 18 : pipeBottomY - 52}
              className="wb-motion"
              markerEnd={`url(#${arrow})`}
            />
            <text x="64" y={leftY.motion} className="wb-muted-label">
              {down ? "Run in" : "POOH"}
            </text>
          </g>
        ) : null}

        {hoverY != null ? (
          <g>
            <line
              x1="64"
              x2="360"
              y1={hoverY}
              y2={hoverY}
              className="wb-hover"
            />
          </g>
        ) : null}

        <text x={CX} y={tdY + 22} textAnchor="middle" className="wb-muted-label">
          {ft(state.wellDepth)} MD
        </text>
      </svg>

      <div
        className={cn(
          "pointer-events-none absolute top-3 right-3 rounded-md border border-border bg-card/90 px-2.5 py-1.5 font-mono text-xs text-foreground opacity-0 transition-opacity duration-150",
          hoverY != null && "opacity-100",
        )}
      >
        {hoverDepth != null ? (
          <div className="space-y-0.5">
            <div>{ft(hoverDepth)}</div>
            <div className="text-muted-foreground">{hoverLayer?.name ?? "—"}</div>
            <div>{dPsi(hoverPsi)} psi · {ppg2(hoverEmw)}</div>
          </div>
        ) : null}
      </div>
    </div>
  );
}
