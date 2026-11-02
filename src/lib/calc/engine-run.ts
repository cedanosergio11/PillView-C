import {
  isNum,
  round,
  roundUp,
  safeDiv,
} from "@/lib/utils";
import type { CalcResults, CementResults, TaperedResults, WarningItem, WellInputs } from "./types";
import {
  calcCapacitiesAndRoom,
  calcCement,
  calcTripAndStatic,
  n,
} from "./engine";
import { calcEqualizeExtraPpg, calcNoDpPill, calcSlugAt200FtMin } from "./engine-nodp";
import { DEPTH_BEYOND_TD, depthBeyondFields, depthBlockMessage } from "./depth";
import { missingRequired } from "./required";

function nanRecord<T extends object>(keys: (keyof T)[]): T {
  const out = {} as T;
  for (const key of keys) out[key] = Number.NaN as T[keyof T];
  return out;
}

function blockedResults(inputs: WellInputs): CalcResults | null {
  const fields = depthBeyondFields(inputs);
  if (!fields.length) return null;
  const code = DEPTH_BEYOND_TD;
  const cement = nanRecord<CementResults>([
    "staticPressure",
    "annularCapacity",
    "openHoleCapacity",
    "casingStringCapacity",
    "openHoleToBoc",
    "bocToShoe",
    "requiredPillHeight",
    "requiredCementPillVol",
    "totalCasingStringVol",
    "chaseToTd",
    "chaseExitCasing",
    "chaseBocToShoe",
    "chaseBocShoePlusPill",
    "totalChase",
    "topOfPill",
  ]);
  const tapered = nanRecord<TaperedResults>([
    "lengthDp2",
    "openHoleLength",
    "linerLength",
    "totalPillVol",
    "pillNeededAnnulus",
    "dpVolume",
    "mudInAnnulusAfterPumping",
    "additionalChase",
    "mudInDp",
  ]);
  return {
    masp: Number.NaN,
    initialApl: Number.NaN,
    initialAplAnchor: Number.NaN,
    drillStringCap: Number.NaN,
    drillStringVolAtSpot: Number.NaN,
    casingCap: Number.NaN,
    casingVolAtSpot: Number.NaN,
    annularCap: Number.NaN,
    annularBelowShoe: Number.NaN,
    annularAtSpot: Number.NaN,
    openHoleCap: Number.NaN,
    heightPillNoDp: Number.NaN,
    totalPillVol: Number.NaN,
    drillStringOpenHole: Number.NaN,
    volumeBelowShoe: Number.NaN,
    requiredVolAnnulus: Number.NaN,
    correctedPillVol: Number.NaN,
    calculatedChase: Number.NaN,
    correctedChase: Number.NaN,
    finalKwm: Number.NaN,
    spottedKmwVol: Number.NaN,
    kmwRoomWithPipe: Number.NaN,
    minHeightPillWithDp: Number.NaN,
    minHeightWithDp: Number.NaN,
    balancedAdditionalPsi: Number.NaN,
    addPpgCsg: Number.NaN,
    addPpgTarget: Number.NaN,
    balancedEsdCasing: Number.NaN,
    esdCasingNoDp: Number.NaN,
    anchorPointEsd: Number.NaN,
    equalizeDumpBbl: Number.NaN,
    remainingKmwInDp: Number.NaN,
    airCapTopMd: Number.NaN,
    resolutionHeightGain: Number.NaN,
    resolutionPressureGain: Number.NaN,
    pressureDifferential: Number.NaN,
    pressureDifferentialSlug: Number.NaN,
    staticStrippingPressure: Number.NaN,
    maxDynamicSbp: Number.NaN,
    maxSwabPressure: Number.NaN,
    selectedTripTable: "other",
    tripPressures: [],
    slugPressure: Number.NaN,
    slugPillVol: Number.NaN,
    strokesToPumpSlug: Number.NaN,
    pillVolAtSpot: Number.NaN,
    slugFits: false,
    slugFallOut: Number.NaN,
    slugFallHeight: Number.NaN,
    chaseWithSlug: Number.NaN,
    slugPpgEquivalent: Number.NaN,
    slugPsiEquivalent: Number.NaN,
    slugApl: Number.NaN,
    correctedSlugPill: Number.NaN,
    totalPillVolAtSpotNoSlug: Number.NaN,
    totalPillVolAtSpotWithSlug: Number.NaN,
    topOfPillWithDp: Number.NaN,
    topOfPillNoDp: Number.NaN,
    drillStringPillHeight: Number.NaN,
    topOfPillInsideDp: Number.NaN,
    kwmPlusChase: Number.NaN,
    deltaSpotBackfill: Number.NaN,
    bblBackfill: Number.NaN,
    safevisionSlug: Number.NaN,
    cement,
    tapered,
    procedurePossible: false,
    errorReason: depthBlockMessage(fields),
    depthBlock: { code, fields },
  };
}

export function calculate(inputs: WellInputs): CalcResults {
  const blocked = blockedResults(inputs);
  if (blocked) return blocked;
  const pressures = calcTripAndStatic(inputs);
  const caps = calcCapacitiesAndRoom(inputs);
  const pill = calcNoDpPill(inputs, caps, pressures);
  const eqx = calcEqualizeExtraPpg(inputs, caps, pill, pressures);
  const {
    desiredEmw,
    desiredResolution,
    currentMw,
    safevisionNoSlug,
    anchorTvd,
  } = pressures;
  const resolutionHeightGain = safeDiv(desiredResolution, caps.annularCap);
  const resolutionPressureGain = (pressures.kmw - currentMw) * resolutionHeightGain * 0.052;
  const pressureDifferential = (desiredEmw - safevisionNoSlug) * 0.052 * anchorTvd;

  const slug = calcSlugAt200FtMin(caps, pill, pressures);

  const pillHeightPosition =
    eqx.minHeightWithDp < caps.spotMd && caps.spotMd > pill.heightPillNoDp
      ? eqx.minHeightWithDp - caps.spotMd
      : 0;
  const correctedTotalPillAtSpot = pill.totalPillVol - round(pillHeightPosition * caps.annularCap, 0);
  const totalPillVolAtSpotNoSlug =
    caps.spotMd > eqx.minHeightWithDp ? pill.totalPillVol : correctedTotalPillAtSpot;
  const totalPillVolAtSpotWithSlug =
    slug.pillVolAtSpot < caps.annularAtSpot ? pill.totalPillVol : correctedTotalPillAtSpot;

  const topOfPillWithDp: number | "Surface" =
    isNum(caps.spotMd) && isNum(eqx.minHeightWithDp)
      ? caps.spotMd > eqx.minHeightWithDp
        ? caps.spotMd - eqx.minHeightWithDp
        : "Surface"
      : Number.NaN;
  const topOfPillNoDp = caps.spotMd - pill.heightPillNoDp;
  const drillStringPillHeight = safeDiv(pill.finalKwm, caps.drillStringCap);
  const topOfPillInsideDp =
    isNum(caps.spotMd) && isNum(drillStringPillHeight)
      ? Math.max(0, caps.spotMd - drillStringPillHeight)
      : Number.NaN;
  const kwmPlusChase = roundUp(
    pill.bblBackfill > 0
      ? pill.spottedKmwVol + (isNum(pill.correctedChase) ? pill.correctedChase : 0)
      : pill.totalPillVol + (isNum(pill.correctedChase) ? pill.correctedChase : 0),
    0,
  );

  const deltaSpotBackfill =
    eqx.minHeightWithDp < caps.spotMd && caps.spotMd > pill.heightPillNoDp
      ? eqx.minHeightWithDp - caps.spotMd
      : 0;

  const procedurePossible = !(isNum(pill.heightPillNoDp) && isNum(caps.spotMd) && pill.heightPillNoDp > caps.spotMd);
  const errorReason = !procedurePossible
    ? "ERROR — PROCEDURE NOT POSSIBLE. Pill height without drill pipe exceeds spot depth. Increase spot depth or change parameters."
    : null;

  const correctedSlugPill =
    slug.pillVolAtSpot < caps.annularAtSpot ? slug.pillVolAtSpot : slug.pillVolAtSpot - pill.bblBackfill;

  return {
    masp: pressures.masp,
    initialApl: pressures.initialApl,
    initialAplAnchor: pressures.initialAplAnchor,
    drillStringCap: caps.drillStringCap,
    drillStringVolAtSpot: caps.drillStringVolAtSpot,
    casingCap: caps.casingCap,
    casingVolAtSpot: caps.casingVolAtSpot,
    annularCap: caps.annularCap,
    annularBelowShoe: caps.annularBelowShoe,
    annularAtSpot: caps.annularAtSpot,
    openHoleCap: caps.openHoleCap,
    heightPillNoDp: pill.heightPillNoDp,
    totalPillVol: pill.totalPillVol,
    drillStringOpenHole: caps.drillStringOpenHole,
    volumeBelowShoe: caps.volumeBelowShoe,
    requiredVolAnnulus: pill.requiredVolAnnulus,
    correctedPillVol: pill.pumpedAnnulus,
    calculatedChase: pill.calculatedChase,
    correctedChase: pill.correctedChase,
    finalKwm: pill.finalKwm,
    spottedKmwVol: pill.spottedKmwVol,
    kmwRoomWithPipe: caps.kmwRoomWithPipe,
    minHeightPillWithDp: pill.minHeightPillWithDp,
    minHeightWithDp: eqx.minHeightWithDp,
    balancedAdditionalPsi: eqx.balancedAdditionalPsi,
    addPpgCsg: eqx.addPpgCsg,
    addPpgTarget: eqx.addPpgTarget,
    balancedEsdCasing: eqx.balancedEsdCasing,
    esdCasingNoDp: eqx.esdCasingNoDp,
    anchorPointEsd: eqx.anchorPointEsd,
    equalizeDumpBbl: eqx.dumpBbl,
    remainingKmwInDp: eqx.remainingPipeKmw,
    airCapTopMd: eqx.airCapMd,
    resolutionHeightGain,
    resolutionPressureGain,
    pressureDifferential,
    pressureDifferentialSlug: slug.pressureDifferentialSlug,
    staticStrippingPressure: pressures.staticStrippingPressure,
    maxDynamicSbp: pressures.maxDynamicSbp,
    maxSwabPressure: pressures.maxSwabPressure,
    selectedTripTable: pressures.selectedTripTable,
    tripPressures: pressures.tripPressures,
    slugPressure: slug.slugPressure,
    slugPillVol: slug.slugPillVol,
    strokesToPumpSlug: slug.strokesToPumpSlug,
    pillVolAtSpot: slug.pillVolAtSpot,
    slugFits: slug.slugFits,
    slugFallOut: slug.slugFallOut,
    slugFallHeight: slug.slugFallHeight,
    chaseWithSlug: slug.chaseWithSlug,
    slugPpgEquivalent: slug.slugPpgEquivalent,
    slugPsiEquivalent: slug.slugPsiEquivalent,
    slugApl: slug.slugApl,
    correctedSlugPill,
    totalPillVolAtSpotNoSlug,
    totalPillVolAtSpotWithSlug,
    topOfPillWithDp,
    topOfPillNoDp,
    drillStringPillHeight,
    topOfPillInsideDp,
    kwmPlusChase,
    deltaSpotBackfill,
    bblBackfill: pill.bblBackfill,
    safevisionSlug: slug.safevisionSlug,
    cement: calcCement(inputs),
    tapered: pill.tapered,
    procedurePossible,
    errorReason,
    depthBlock: null,
  };
}

export function collectWarnings(inputs: WellInputs, results: CalcResults): WarningItem[] {
  if (results.depthBlock) {
    return [
      {
        level: "error",
        text: results.errorReason ?? "A depth is past TD or the pill or anchor is past the bit.",
      },
    ];
  }
  const warnings: WarningItem[] = [];
  const missing = missingRequired(inputs).map(({ label }) => label);
  if (missing.length) {
    warnings.push({ level: "error", text: `Missing required values: ${missing.join(", ")}.` });
  }
  if (isNum(n(inputs, "kmw")) && isNum(n(inputs, "currentMw")) && n(inputs, "kmw") <= n(inputs, "currentMw")) {
    warnings.push({ level: "error", text: "KMW must be greater than current MW." });
  }
  if (!results.procedurePossible && results.errorReason) {
    warnings.push({ level: "error", text: results.errorReason });
  }
  if (isNum(results.pressureDifferential) && isNum(results.masp) && results.pressureDifferential > results.masp) {
    warnings.push({ level: "error", text: "Initial pressure differential exceeds MASP." });
  }
  if (isNum(n(inputs, "desiredEmw")) && isNum(n(inputs, "fit")) && n(inputs, "desiredEmw") > n(inputs, "fit")) {
    warnings.push({
      level: "warn",
      text: `Desired EMW (${n(inputs, "desiredEmw")} ppge) is above FIT (${n(inputs, "fit")} ppge).`,
    });
  }
  if (isNum(results.maxDynamicSbp) && isNum(results.masp) && results.maxDynamicSbp > results.masp) {
    warnings.push({
      level: "warn",
      text: `Max dynamic SBP (${round(results.maxDynamicSbp, 0)} psi) is above MASP (${round(results.masp, 0)} psi).`,
    });
  }
  if (
    inputs.pillMode === "withSlug" &&
    isNum(results.slugPillVol) &&
    isNum(results.totalPillVol) &&
    results.slugPillVol >= results.totalPillVol
  ) {
    warnings.push({
      level: "error",
      text: "Slug volume is greater than or equal to total pill volume. Reduce overbalance or increase EMW window.",
    });
  }
  if (inputs.pillMode === "withSlug" && results.slugFits === false && isNum(results.slugFallOut)) {
    warnings.push({
      level: "warn",
      text: `Slug exceeds drill-string volume at spot depth; ${round(results.slugFallOut, 1)} bbl of fallout compensation is applied.`,
    });
  }
  if (isNum(results.bblBackfill) && results.bblBackfill > 0) {
    warnings.push({
      level: "warn",
      text: `Only ${round(results.spottedKmwVol, 0)} bbl of KMW fits with pipe in the hole; ${round(results.totalPillVol, 0)} bbl is needed for the anchor EMW. Backfill ${round(results.bblBackfill, 0)} bbl of KMW while tripping out.`,
    });
  }
  if (results.selectedTripTable === "other") {
    warnings.push({
      level: "info",
      text: "Open-hole size is not 6.75 / 7.875 / 8.5 in. Using the custom swab table — verify values in SafeVision.",
    });
  }
  if (isNum(n(inputs, "initialFlowRate")) && isNum(n(inputs, "maxFlowRate")) && n(inputs, "initialFlowRate") > n(inputs, "maxFlowRate")) {
    warnings.push({
      level: "warn",
      text: "Initial flow rate exceeds the stated max flow rate.",
    });
  }
  if (isNum(n(inputs, "fit")) && isNum(n(inputs, "desiredEmw")) && n(inputs, "fit") - n(inputs, "desiredEmw") < 0.6) {
    warnings.push({
      level: "warn",
      text: "FIT − target EMW window is under 0.6 ppge. Steel-displacement automations are not valid — model surge in SafeVision.",
    });
  }
  if (inputs.taperedOn) {
    warnings.push({
      level: "info",
      text: "Tapered casing/string trigger is ON. Confirm the pill is spotted at the liner shoe and pill height exceeds liner length.",
    });
  }
  if (!warnings.some((w) => w.level === "error")) {
    warnings.unshift({
      level: "ok",
      text: "Primary calculations are complete. Trust the sheet — then verify the spotting schedule in SafeVision.",
    });
  }
  return warnings;
}

export function atSurface(results: CalcResults): boolean {
  return results.topOfPillWithDp === "Surface";
}

export function esdCasingWithDp(results: CalcResults): number {
  return atSurface(results) ? results.esdCasingNoDp : results.balancedEsdCasing;
}

export function esdTargetWithDp(results: CalcResults, desiredEmw: number): number {
  return atSurface(results) ? desiredEmw : results.anchorPointEsd;
}

export function pillHeightWithDp(results: CalcResults): number {
  return atSurface(results) ? results.heightPillNoDp : results.minHeightWithDp;
}
