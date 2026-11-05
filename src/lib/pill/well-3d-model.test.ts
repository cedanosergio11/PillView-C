import { describe, expect, it } from "vitest";
import { calculate } from "../calc/engine";
import { EXAMPLE_1 } from "../calc/examples";
import { buildSchedule } from "../calc/schedule";
import type { ScheduleRow } from "../calc/types";
import { computeModel } from "./physics";
import { placedState } from "./simulate";
import {
  flowAt,
  genericLPath,
  liveColumns,
  locate,
  minutesAt,
  pointAtMd,
  pumpPlan,
  pumpStatus,
  pumpingColumns,
  scheduleAt,
  wellPathStations,
  type Columns,
} from "./well-3d-model";

const fluidAt = (segments: Columns["string"], md: number) =>
  segments.find((s) => md >= s.top && md <= s.bottom)?.fluid;

describe("well path from MD/TVD pairs", () => {
  it("is vertical when no pairs are entered", () => {
    const stations = wellPathStations([], 10000);
    expect(pointAtMd(stations, 6000)).toEqual({ x: 0, tvd: 6000 });
  });

  it("uses straight legs between pairs: 10,000 ft MD to 8,000 ft TVD is 6,000 ft out", () => {
    const stations = wellPathStations([{ md: 10000, tvd: 8000 }], 10000);
    const end = pointAtMd(stations, 10000);
    expect(end.tvd).toBeCloseTo(8000, 6);
    expect(end.x).toBeCloseTo(6000, 6);
    expect(pointAtMd(stations, 5000).x).toBeCloseTo(3000, 6);
  });
});

describe("generic L path for the 3D view", () => {
  it("is vertical without a BOC above TD", () => {
    expect(genericLPath(10000, null)).toEqual([
      { md: 0, tvd: 0, x: 0 },
      { md: 10000, tvd: 10000, x: 0 },
    ]);
    expect(genericLPath(10000, 10000)).toHaveLength(2);
  });

  it("goes straight down, curves to the BOC and runs flat to TD", () => {
    const path = genericLPath(18359, 12675);
    const boc = pointAtMd(path, 12675);
    const heel = pointAtMd(path, 12675 + 1000);
    const td = pointAtMd(path, 18359);
    // Vertical above the curve.
    expect(pointAtMd(path, 8000)).toEqual({ x: 0, tvd: 8000 });
    // Flat from the BOC: same drawn TVD, displacement grows one for one with MD.
    expect(heel.tvd).toBeCloseTo(boc.tvd, 6);
    expect(td.tvd).toBeCloseTo(boc.tvd, 6);
    expect(td.x - boc.x).toBeCloseTo(18359 - 12675, 6);
    // The curve lands exactly at the BOC measured depth.
    expect(path.find((s) => Math.abs(s.md - 12675) < 1e-6)).toBeTruthy();
  });
});

describe("pumping playback (EXAMPLE 1)", () => {
  const results = calculate(EXAMPLE_1);
  const placed = placedState(EXAMPLE_1, results);
  const plan = pumpPlan(placed);

  it("pumps the procedure's KMW, then its chase, and fills the string exactly", () => {
    expect(plan.kmwBbl).toBeCloseTo(placed.pillVolume + (placed.pipeKmwVolume ?? 0), 6);
    expect(plan.chaseBbl).toBeCloseTo(placed.pipeChaseVolume ?? 0, 6);
    expect(plan.stringBbl).toBeCloseTo((placed.pipeKmwVolume ?? 0) + (placed.pipeChaseVolume ?? 0), 1);
  });

  it("starts with only well fluid in the hole", () => {
    const cols = pumpingColumns(placed, plan, 0);
    expect(cols.string).toEqual([{ top: 0, bottom: plan.bitMd, fluid: "base" }]);
    expect(cols.annulus).toEqual([{ top: 0, bottom: placed.wellDepth, fluid: "base" }]);
  });

  it("ends in the as-pumped state the simulator shows", () => {
    const end = pumpingColumns(placed, plan, plan.totalBbl);
    const live = liveColumns(placed, computeModel(placed));
    const kmwEnd = end.annulus.find((s) => s.fluid === "kmw");
    const kmwLive = live.annulus.find((s) => s.fluid === "kmw");
    expect(kmwEnd?.top).toBeCloseTo(kmwLive?.top ?? NaN, 0);
    expect(kmwEnd?.bottom).toBeCloseTo(kmwLive?.bottom ?? NaN, 0);
    // String: chase on top of KMW, same interface depth.
    const chaseEnd = end.string.find((s) => s.fluid === "chase");
    const chaseLive = live.string.find((s) => s.fluid === "chase");
    expect(chaseEnd?.bottom).toBeCloseTo(chaseLive?.bottom ?? NaN, 0);
    expect(fluidAt(end.string, plan.bitMd - 1)).toBe("kmw");
  });

  it("moves the KMW front down the string, then up the annulus", () => {
    const half = locate(placed, plan, plan.stringBbl / 2);
    expect(half?.where).toBe("string");
    expect(half?.md).toBeCloseTo(plan.bitMd / 2, 3);
    const above = locate(placed, plan, plan.stringBbl + 20);
    expect(above?.where).toBe("annulus");
    expect(above?.md).toBeLessThan(plan.bitMd);
    expect(pumpStatus(placed, plan, 10).phase).toBe("kmw-string");
    expect(pumpStatus(placed, plan, plan.totalBbl).phase).toBe("placed");
  });
});

describe("schedule during playback", () => {
  const rows = [
    { step: 1, volume: 166, flow: 220, sbp: 242 },
    { step: 2, volume: 170, flow: 220, sbp: 242 },
    { step: 3, volume: 190, flow: 200, sbp: 115 },
  ] as unknown as ScheduleRow[];

  it("holds step 1 while the string fills, then follows the steps reached", () => {
    expect(scheduleAt(rows, 50)).toMatchObject({ reached: null, held: { step: 1 }, next: { step: 1 } });
    expect(scheduleAt(rows, 180)).toMatchObject({ reached: { step: 2 }, held: { step: 2 }, next: { step: 3 } });
    expect(scheduleAt(rows, 190).held?.step).toBe(3);
    expect(scheduleAt(rows, 190).next).toBeNull();
  });

  it("times each leg at its step's rate", () => {
    expect(flowAt(rows, 180, 300)).toBe(200);
    // 166 bbl at 220 gpm + 4 at 220 + 20 at 200 = 170*42/220 + 20*42/200
    expect(minutesAt(rows, 190, 300)).toBeCloseTo((170 * 42) / 220 + (20 * 42) / 200, 6);
  });

  it("works on the real EXAMPLE 1 schedule", () => {
    const results = calculate(EXAMPLE_1);
    const schedule = buildSchedule(EXAMPLE_1, results);
    const last = schedule.rows[schedule.rows.length - 1];
    expect(scheduleAt(schedule.rows, last.volume).held?.step).toBe(last.step);
  });
});
