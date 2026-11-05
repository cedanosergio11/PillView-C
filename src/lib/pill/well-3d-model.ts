import type { ScheduleRow } from "@/lib/calc/types";
import { tvdAt } from "./hydrostatic";
import { depthForVolumeFromSurface, pipeBoreBblPerFt, volumeBetweenMd } from "./physics";
import type { PillModel, SurveyPoint, WellState } from "./types";

/*
 * Data behind the 3D well view: where the well goes, and which fluid sits at each
 * depth in the string and the annulus, either live (the simulator's current state)
 * or part way through pumping the pill (plug flow, no mixing at the interfaces).
 * No drawing code here, so it can be unit tested.
 */

export type Fluid = "base" | "kmw" | "chase" | "fill" | "air" | "empty";
export type Segment = { top: number; bottom: number; fluid: Fluid };
/** String contents from surface to the bit, annulus (and hole below the bit) from surface to TD. */
export type Columns = { bitMd: number; string: Segment[]; annulus: Segment[] };

// ---------------------------------------------------------------- well path

export type PathStation = { md: number; tvd: number; x: number };

/**
 * Vertical-section stations from the MD/TVD pairs: straight hole between pairs, the
 * same geometry tvdAt() uses for hydrostatics, so the picture matches the numbers.
 * x is horizontal displacement, sqrt(ΔMD² − ΔTVD²) per leg.
 */
export function wellPathStations(survey: SurveyPoint[], wellDepth: number): PathStation[] {
  const mds = new Set<number>([0, wellDepth]);
  for (const p of survey) if (Number.isFinite(p.md) && p.md > 0 && p.md < wellDepth) mds.add(p.md);
  const sorted = [...mds].sort((a, b) => a - b);
  const out: PathStation[] = [];
  let x = 0;
  for (let i = 0; i < sorted.length; i += 1) {
    const md = sorted[i];
    const tvd = tvdAt(survey, md);
    if (i > 0) {
      const prev = out[i - 1];
      const dMd = md - prev.md;
      const dTvd = tvd - prev.tvd;
      x += Math.sqrt(Math.max(0, dMd * dMd - dTvd * dTvd));
    }
    out.push({ md, tvd, x });
  }
  return out;
}

/**
 * A generic L-shaped well for the 3D view: vertical to the kick-off, a short
 * quarter-circle curve that lands at the anchor / BOC, then a horizontal lateral
 * to TD. Measured depths are real; the drawn TVD is schematic, not to scale.
 * Without a BOC above TD the well is drawn vertical.
 */
export function genericLPath(wellDepth: number, bocMd: number | null): PathStation[] {
  const td = Math.max(1, wellDepth);
  if (bocMd == null || !(bocMd > 0) || bocMd >= td - 1) {
    return [
      { md: 0, tvd: 0, x: 0 },
      { md: td, tvd: td, x: 0 },
    ];
  }
  // Tight corner: ~3% of TD, never longer than the hole above the BOC.
  const radius = Math.min(Math.max(td * 0.03, 150), 900, (bocMd * 2 * 0.9) / Math.PI);
  const kop = bocMd - (Math.PI / 2) * radius;
  const out: PathStation[] = [{ md: 0, tvd: 0, x: 0 }];
  if (kop > 0.5) out.push({ md: kop, tvd: kop, x: 0 });
  const steps = 24;
  for (let i = 1; i <= steps; i += 1) {
    const theta = (i / steps) * (Math.PI / 2);
    out.push({
      md: kop + radius * theta,
      tvd: kop + radius * Math.sin(theta),
      x: radius * (1 - Math.cos(theta)),
    });
  }
  out.push({ md: td, tvd: kop + radius, x: radius + (td - bocMd) });
  return out;
}

/** Position at a measured depth, interpolated along the straight legs. */
export function pointAtMd(stations: PathStation[], md: number): { x: number; tvd: number } {
  if (!stations.length) return { x: 0, tvd: md };
  if (md <= stations[0].md) return { x: stations[0].x, tvd: stations[0].tvd };
  for (let i = 1; i < stations.length; i += 1) {
    const a = stations[i - 1];
    const b = stations[i];
    if (md <= b.md) {
      const t = (md - a.md) / Math.max(1e-9, b.md - a.md);
      return { x: a.x + t * (b.x - a.x), tvd: a.tvd + t * (b.tvd - a.tvd) };
    }
  }
  const last = stations[stations.length - 1];
  return { x: last.x, tvd: last.tvd };
}

/** Unit direction of travel downhole at a measured depth, as (dx, dTvd). */
export function directionAtMd(stations: PathStation[], md: number): { dx: number; dTvd: number } {
  for (let i = 1; i < stations.length; i += 1) {
    const a = stations[i - 1];
    const b = stations[i];
    if (md <= b.md || i === stations.length - 1) {
      const dx = b.x - a.x;
      const dTvd = b.tvd - a.tvd;
      const len = Math.hypot(dx, dTvd);
      return len > 1e-9 ? { dx: dx / len, dTvd: dTvd / len } : { dx: 0, dTvd: 1 };
    }
  }
  return { dx: 0, dTvd: 1 };
}

// ---------------------------------------------------------------- live columns

function pushSegment(list: Segment[], top: number, bottom: number, fluid: Fluid) {
  if (!(bottom > top + 0.05)) return;
  const last = list[list.length - 1];
  if (last && last.fluid === fluid && Math.abs(last.bottom - top) < 0.05) last.bottom = bottom;
  else list.push({ top, bottom, fluid });
}

/** Fill a column from `start` to `end`, painting `painted` intervals over a base fluid. */
function paint(start: number, end: number, painted: Segment[], fill: Fluid = "base"): Segment[] {
  const cuts = new Set<number>([start, end]);
  for (const p of painted) {
    if (p.bottom > start && p.top < end) {
      cuts.add(Math.max(start, p.top));
      cuts.add(Math.min(end, p.bottom));
    }
  }
  const sorted = [...cuts].sort((a, b) => a - b);
  const out: Segment[] = [];
  for (let i = 0; i < sorted.length - 1; i += 1) {
    const top = sorted[i];
    const bottom = sorted[i + 1];
    const mid = (top + bottom) / 2;
    // Later entries win, matching the draw order of the 2D schematic.
    let fluid: Fluid = fill;
    for (const p of painted) if (mid > p.top && mid < p.bottom) fluid = p.fluid;
    pushSegment(out, top, bottom, fluid);
  }
  return out;
}

/** What the simulator holds right now, laid out as in the 2D schematic. */
export function liveColumns(state: WellState, model: PillModel): Columns {
  const bit = Math.max(0, Math.min(state.pipeDepth, state.wellDepth));
  // String: air on top once the float has let fluid out, then chase, then KMW to the bit.
  const airBottom =
    model.pipeChaseInHole > 0.05 ? model.pipeChaseTop : model.pipeKmwInHole > 0.05 ? model.pipeKmwTop : bit;
  const stringPaint: Segment[] = [];
  if (airBottom > 1) stringPaint.push({ top: 0, bottom: airBottom, fluid: "air" });
  if (model.pipeChaseInHole > 0.05) {
    stringPaint.push({ top: model.pipeChaseTop, bottom: model.pipeKmwTop, fluid: "chase" });
  }
  if (model.pipeKmwInHole > 0.05) stringPaint.push({ top: model.pipeKmwTop, bottom: bit, fluid: "kmw" });

  // Annulus: empty above the fluid level (trip tank off), fill on top, the KMW pill.
  const annPaint: Segment[] = [];
  const fluidTop = state.autoBackfill ? 0 : Math.max(0, model.fluidDrop);
  if (fluidTop > 0.05) annPaint.push({ top: 0, bottom: fluidTop, fluid: "empty" });
  if (model.fillZoneVolume > 0.02 && model.fillZoneDepth > fluidTop) {
    annPaint.push({ top: fluidTop, bottom: model.fillZoneDepth, fluid: "fill" });
  }
  if (model.pillBottom > model.pillTop) {
    annPaint.push({ top: model.pillTop, bottom: model.pillBottom, fluid: "kmw" });
  }
  return {
    bitMd: bit,
    string: paint(0, bit, stringPaint),
    annulus: paint(0, state.wellDepth, annPaint),
  };
}

// ---------------------------------------------------------------- pumping playback

/** The pumping job that ends in the procedure's as-pumped placement. */
export type PumpPlan = {
  bitMd: number;
  /** KMW pumped: annular pill plus what stays in the string. */
  kmwBbl: number;
  chaseBbl: number;
  totalBbl: number;
  /** Bore volume from surface to the bit. */
  stringBbl: number;
  /** Annular volume from the bit to surface. */
  annulusBbl: number;
};

export function pumpPlan(placed: WellState): PumpPlan {
  const bitMd = Math.max(0, Math.min(placed.pipeDepth, placed.wellDepth));
  const kmwBbl = Math.max(0, placed.pillVolume) + Math.max(0, placed.pipeKmwVolume ?? 0);
  const chaseBbl = Math.max(0, placed.pipeChaseVolume ?? 0);
  return {
    bitMd,
    kmwBbl,
    chaseBbl,
    totalBbl: kmwBbl + chaseBbl,
    stringBbl: bitMd * pipeBoreBblPerFt(placed),
    annulusBbl: volumeBetweenMd(placed, 0, bitMd, bitMd),
  };
}

export type Location = { md: number; where: "string" | "annulus" } | null;

/**
 * Where a parcel sits once it is `s` bbl downstream of the pump: down the string to
 * the bit, then up the annulus. Null once it is back at surface.
 */
export function locate(placed: WellState, plan: PumpPlan, s: number): Location {
  if (s < 0) return null;
  if (s <= plan.stringBbl) {
    return { md: plan.stringBbl > 0 ? (s / plan.stringBbl) * plan.bitMd : 0, where: "string" };
  }
  const a = s - plan.stringBbl;
  if (a >= plan.annulusBbl) return null;
  const md = depthForVolumeFromSurface(placed, plan.annulusBbl - a, plan.bitMd);
  return { md: Math.min(md, plan.bitMd), where: "annulus" };
}

/** Annular depth where `a` bbl above the bit ends (a = 0 is the bit). */
function annulusMdAt(placed: WellState, plan: PumpPlan, a: number): number {
  if (a <= 0) return plan.bitMd;
  if (a >= plan.annulusBbl) return 0;
  return depthForVolumeFromSurface(placed, plan.annulusBbl - a, plan.bitMd);
}

/**
 * Columns after pumping `pumped` bbl: KMW first, then chase, pushing the well fluid
 * ahead of it down the string, around the bit and up the annulus.
 */
export function pumpingColumns(placed: WellState, plan: PumpPlan, pumped: number): Columns {
  const v = Math.max(0, Math.min(pumped, plan.totalBbl));
  // A parcel s bbl downstream entered the string when v − s had been pumped.
  // KMW: entered in [0, kmw) → s in (v − kmw, v]. Chase: entered in [kmw, v) → s in (0, v − kmw].
  const kmwFrom = Math.max(0, v - plan.kmwBbl);
  const kmwTo = v;
  const chaseTo = Math.max(0, v - plan.kmwBbl);
  const bore = plan.stringBbl > 0 ? plan.bitMd / plan.stringBbl : 0; // ft per bbl in the string

  const stringPaint: Segment[] = [];
  const annPaint: Segment[] = [];
  const addRange = (from: number, to: number, fluid: Fluid) => {
    if (!(to > from)) return;
    // String part.
    const s0 = Math.min(from, plan.stringBbl);
    const s1 = Math.min(to, plan.stringBbl);
    if (s1 > s0) stringPaint.push({ top: s0 * bore, bottom: s1 * bore, fluid });
    // Annulus part, measured up from the bit.
    const a0 = Math.max(0, from - plan.stringBbl);
    const a1 = Math.max(0, to - plan.stringBbl);
    if (a1 > a0) {
      annPaint.push({ top: annulusMdAt(placed, plan, a1), bottom: annulusMdAt(placed, plan, a0), fluid });
    }
  };
  addRange(0, chaseTo, "chase");
  addRange(kmwFrom, kmwTo, "kmw");
  return {
    bitMd: plan.bitMd,
    string: paint(0, plan.bitMd, stringPaint),
    annulus: paint(0, placed.wellDepth, annPaint),
  };
}

export type PumpPhase = "ready" | "kmw-string" | "kmw-bit" | "chase-string" | "chase-annulus" | "placed";

export const PHASE_LABEL: Record<PumpPhase, string> = {
  ready: "Ready to pump",
  "kmw-string": "Pumping KMW",
  "kmw-bit": "KMW rounding the bit",
  "chase-string": "Chasing KMW down",
  "chase-annulus": "Placing pill",
  placed: "Pill placed",
};

export type PumpStatus = {
  phase: PumpPhase;
  /** KMW leading edge, and trailing edge (null while KMW is still going in at surface). */
  front: Location;
  tail: Location;
};

export function pumpStatus(placed: WellState, plan: PumpPlan, pumped: number): PumpStatus {
  const v = Math.max(0, Math.min(pumped, plan.totalBbl));
  const front = v > 0 ? locate(placed, plan, v) : null;
  const tail = v > plan.kmwBbl ? locate(placed, plan, v - plan.kmwBbl) : null;
  let phase: PumpPhase;
  if (v <= 0) phase = "ready";
  else if (v >= plan.totalBbl - 1e-6) phase = "placed";
  else if (v < plan.kmwBbl) phase = v < plan.stringBbl ? "kmw-string" : "kmw-bit";
  else phase = v < plan.stringBbl ? "chase-string" : "chase-annulus";
  return { phase, front, tail };
}

// ---------------------------------------------------------------- schedule

export type ScheduleAt = {
  /** Last step whose volume has been pumped; null before step 1. */
  reached: ScheduleRow | null;
  /** Step whose SBP applies now: step 1's while the string fills, then the last step reached. */
  held: ScheduleRow | null;
  /** Next step to reach. */
  next: ScheduleRow | null;
};

export function scheduleAt(rows: ScheduleRow[], pumped: number): ScheduleAt {
  if (!rows.length) return { reached: null, held: null, next: null };
  let idx = -1;
  for (let i = 0; i < rows.length; i += 1) if (rows[i].volume <= pumped + 1e-6) idx = i;
  const reached = idx >= 0 ? rows[idx] : null;
  return {
    reached,
    held: reached ?? rows[0],
    next: idx + 1 < rows.length ? rows[idx + 1] : null,
  };
}

/** Pump rate while pumping toward the next step, gpm. */
export function flowAt(rows: ScheduleRow[], pumped: number, fallbackGpm: number): number {
  const row = rows.find((r) => r.volume > pumped + 1e-6) ?? rows[rows.length - 1];
  const gpm = row?.flow;
  return Number.isFinite(gpm) && (gpm as number) > 0 ? (gpm as number) : fallbackGpm;
}

/** Minutes of pumping to reach `pumped` bbl at each step's rate. */
export function minutesAt(rows: ScheduleRow[], pumped: number, fallbackGpm: number): number {
  let minutes = 0;
  let from = 0;
  for (const row of rows) {
    if (from >= pumped) break;
    const to = Math.min(pumped, row.volume);
    if (to > from) minutes += ((to - from) * 42) / flowAt(rows, from, fallbackGpm);
    from = Math.max(from, row.volume);
  }
  if (pumped > from) minutes += ((pumped - from) * 42) / flowAt(rows, from, fallbackGpm);
  return minutes;
}
