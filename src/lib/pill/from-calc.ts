import { asNum, isNum } from "@/lib/utils";
import type { CalcResults, WellInputs } from "@/lib/calc/types";
import { equalizeFloatAirCap } from "@/lib/calc/equalize";
import { clamp, pipeBoreBblPerFt, topFromVolume } from "./physics";
import { tvdFn } from "./hydrostatic";
import type { PipeEnd, SurveyPoint, WellState } from "./types";
import { DEFAULT_STATE } from "./types";

export type SimGeometry = Pick<
  WellState,
  "wellDepth" | "holeId" | "casingMd" | "openHoleId" | "pipeOd" | "pipeId" | "baseMw" | "survey"
>;

function finite(value: number, fallback: number) {
  return isNum(value) && value > 0 ? value : fallback;
}

function surveyFromWell(inputs: WellInputs): SurveyPoint[] {
  const pts: SurveyPoint[] = [{ md: 0, tvd: 0 }];
  const add = (mdVal: unknown, tvdVal: unknown) => {
    const md = asNum(mdVal);
    const tvd = asNum(tvdVal);
    if (isNum(md) && md > 0 && isNum(tvd) && tvd > 0) {
      pts.push({ md, tvd: Math.min(md, tvd) });
    }
  };
  add(inputs.casingMd, inputs.casingTvd);
  add(inputs.spotMd, inputs.spotTvd);
  add(inputs.anchorMd, inputs.anchorTvd);
  pts.sort((a, b) => a.md - b.md);
  const out: SurveyPoint[] = [];
  for (const p of pts) {
    if (!out.length || p.md > out[out.length - 1].md + 0.5) out.push(p);
  }
  return out;
}

export function geometryFromWell(inputs: WellInputs): SimGeometry {
  const current = asNum(inputs.currentDepthMd);
  const td = asNum(inputs.tdDepth);
  const spot = asNum(inputs.spotMd);
  const casing = asNum(inputs.casingMd);
  const anchor = asNum(inputs.anchorMd);
  // Deepest depth entered. The demo depth is only a fallback for a blank well, so a
  // shallow well never gets hole below its real bottom.
  const entered = [current, td, spot, casing, anchor].filter((n) => isNum(n) && n > 0);
  const wellDepth = entered.length ? Math.max(...entered) : DEFAULT_STATE.wellDepth;

  const holeId = finite(
    asNum(inputs.idCasing),
    finite(asNum(inputs.openHoleDia), DEFAULT_STATE.holeId),
  );
  const openHoleId = finite(asNum(inputs.openHoleDia), 0);
  const casingMd = isNum(asNum(inputs.casingMd)) ? asNum(inputs.casingMd) : 0;
  const pipeOd = finite(asNum(inputs.odDp), DEFAULT_STATE.pipeOd);
  const pipeId = finite(asNum(inputs.idDp), DEFAULT_STATE.pipeId);
  const baseMw = finite(asNum(inputs.currentMw), DEFAULT_STATE.baseMw);

  return {
    wellDepth,
    holeId,
    casingMd,
    openHoleId: openHoleId > 0 && openHoleId !== holeId ? openHoleId : 0,
    pipeOd,
    pipeId,
    baseMw,
    survey: surveyFromWell(inputs),
  };
}

export function procedureSyncKey(inputs: WellInputs, results: CalcResults) {
  return [
    inputs.wellName,
    inputs.spotMd,
    inputs.currentDepthMd,
    inputs.tdDepth,
    inputs.idCasing,
    inputs.openHoleDia,
    inputs.odDp,
    inputs.idDp,
    inputs.currentMw,
    inputs.kmw,
    results.totalPillVol,
    results.correctedPillVol,
    results.finalKwm,
    results.heightPillNoDp,
    results.bblBackfill,
  ].join("|");
}

export function pillFromProcedure(
  inputs: WellInputs,
  results: CalcResults,
  geometry: SimGeometry,
  pipeEnd: PipeEnd = "closed",
  options: { equalized?: boolean } = {},
): Pick<
  WellState,
  | "pipeDepth"
  | "referencePipeDepth"
  | "placedPillTop"
  | "placedPillBottom"
  | "pillVolume"
  | "pillMw"
  | "pipeKmwVolume"
  | "pipeChaseVolume"
> {
  const spot = finite(asNum(inputs.spotMd), geometry.wellDepth * 0.9);
  const pipeDepth = clamp(spot, 100, geometry.wellDepth);
  const bottom = clamp(spot, 1, geometry.wellDepth);
  const pillMw = finite(asNum(inputs.kmw), DEFAULT_STATE.pillMw);
  const proto: WellState = {
    ...DEFAULT_STATE,
    ...geometry,
    pipeEnd,
    pipeDepth,
    referencePipeDepth: pipeDepth,
    placedPillBottom: bottom,
    placedPillTop: 0,
    pillVolume: 0,
    pillMw,
    autoBackfill: true,
    pipeKmwVolume: 0,
    pipeChaseVolume: 0,
  };

  if (options.equalized) {
    const asPumped = pillFromProcedure(inputs, results, geometry, pipeEnd, {});
    const state: WellState = {
      ...proto,
      ...asPumped,
      autoBackfill: true,
    };
    const bore = pipeBoreBblPerFt(state);
    const annularBblFt = Math.max(
      1e-9,
      asPumped.placedPillBottom > asPumped.placedPillTop
        ? asPumped.pillVolume / (asPumped.placedPillBottom - asPumped.placedPillTop)
        : bore,
    );
    const eq = equalizeFloatAirCap({
      bitMd: pipeDepth,
      tvdOf: tvdFn(state),
      kmw: pillMw,
      baseMw: state.baseMw,
      boreBblFt: bore,
      annularBblFt,
      pipeKmwVolume: asPumped.pipeKmwVolume,
      pipeChaseVolume: asPumped.pipeChaseVolume,
      annularHeightMd: Math.max(0, asPumped.placedPillBottom - asPumped.placedPillTop),
    });
    const bottom = asPumped.placedPillBottom;
    const { top, volume } = topFromVolume(
      state,
      bottom,
      asPumped.pillVolume + eq.dumpBbl,
      pipeDepth,
    );
    return {
      pipeDepth,
      referencePipeDepth: pipeDepth,
      placedPillTop: top,
      placedPillBottom: bottom,
      pillVolume: volume,
      pillMw,
      pipeKmwVolume: eq.remainingPipeKmw,
      pipeChaseVolume: asPumped.pipeChaseVolume,
    };
  }

  const annularRequested =
    isNum(results.correctedPillVol) && results.correctedPillVol > 0
      ? results.correctedPillVol
      : isNum(results.requiredVolAnnulus) && results.requiredVolAnnulus > 0
        ? results.requiredVolAnnulus
        : DEFAULT_STATE.pillVolume;
  const pipeKmwVolume =
    isNum(results.finalKwm) && results.finalKwm > 0 ? results.finalKwm : 0;
  const pipeChaseVolume =
    isNum(results.correctedChase) && results.correctedChase > 0 ? results.correctedChase : 0;
  const { top, volume } = topFromVolume(proto, bottom, annularRequested, pipeDepth);
  return {
    pipeDepth,
    referencePipeDepth: pipeDepth,
    placedPillTop: top,
    placedPillBottom: bottom,
    pillVolume: volume,
    pillMw,
    pipeKmwVolume,
    pipeChaseVolume,
  };
}

export function composeWellState(
  inputs: WellInputs,
  sim: Omit<WellState, keyof SimGeometry>,
): WellState {
  const geometry = geometryFromWell(inputs);
  const wellDepth = geometry.wellDepth;
  const pipeDepth = clamp(sim.pipeDepth, 0, wellDepth);
  const referencePipeDepth = clamp(sim.referencePipeDepth, 0, wellDepth);
  const placedPillBottom = clamp(sim.placedPillBottom, 1, wellDepth);
  const placedPillTop = clamp(sim.placedPillTop, 0, Math.max(0, placedPillBottom - 1));
  return {
    ...geometry,
    pipeEnd: sim.pipeEnd,
    pipeDepth,
    referencePipeDepth,
    placedPillTop,
    placedPillBottom,
    pillVolume: sim.pillVolume,
    pillMw: sim.pillMw,
    autoBackfill: sim.autoBackfill,
    baseMw: geometry.baseMw,
    pipeKmwVolume: Math.max(0, sim.pipeKmwVolume),
    pipeChaseVolume: Math.max(0, sim.pipeChaseVolume ?? 0),
    kmwBackfillRequired: Math.max(0, sim.kmwBackfillRequired ?? 0),
    stringDrainedOnPull: Math.max(0, sim.stringDrainedOnPull ?? 0),
    survey: geometry.survey,
  };
}
