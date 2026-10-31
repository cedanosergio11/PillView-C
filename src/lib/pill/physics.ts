import { annularBblFt, capBblFt } from "@/lib/utils";
import type { PillInterval, PillModel, WellState } from "./types";

export function clamp(value: number, min: number, max: number) {
  return Math.max(min, Math.min(max, value));
}

export function steelBblPerFt(state: WellState) {
  return Math.max(0, annularBblFt(state.pipeOd, state.pipeId));
}

export function pipeBblPerFt(state: WellState) {
  return state.pipeEnd === "closed"
    ? capBblFt(state.pipeOd)
    : Math.max(0, annularBblFt(state.pipeOd, state.pipeId));
}

export function annularBblPerFt(state: WellState) {
  return Math.max(1e-9, annularBblFt(state.holeId, state.pipeOd));
}

export function holeDiameterAt(state: WellState, md: number) {
  const shoe = state.casingMd ?? 0;
  const oh = state.openHoleId ?? 0;
  if (shoe > 0 && oh > 0 && md > shoe) return oh;
  return state.holeId;
}

function capBblFtAt(state: WellState, md: number, pipeDepth: number) {
  const hole = holeDiameterAt(state, md);
  const full = capBblFt(hole);
  if (md >= pipeDepth - 1e-9) return Math.max(1e-12, full);
  return Math.max(1e-12, annularBblFt(hole, state.pipeOd));
}

export function volumeBetweenMd(
  state: WellState,
  fromMd: number,
  toMd: number,
  pipeDepth: number,
) {
  const a = clamp(fromMd, 0, state.wellDepth);
  const b = clamp(toMd, 0, state.wellDepth);
  if (b <= a) return 0;
  const shoe = (state.casingMd ?? 0) > 0 ? state.casingMd! : Number.NaN;
  const pipe = clamp(pipeDepth, 0, state.wellDepth);
  const cuts = [a, b];
  if (Number.isFinite(shoe) && shoe > a && shoe < b) cuts.push(shoe);
  if (pipe > a && pipe < b) cuts.push(pipe);
  cuts.sort((x, y) => x - y);
  let volume = 0;
  for (let i = 0; i < cuts.length - 1; i += 1) {
    const lo = cuts[i];
    const hi = cuts[i + 1];
    if (hi <= lo) continue;
    volume += capBblFtAt(state, (lo + hi) / 2, pipe) * (hi - lo);
  }
  return volume;
}

export function openHoleBblPerFt(state: WellState) {
  return capBblFt(state.holeId);
}

export function pipeBoreBblPerFt(state: WellState) {
  return capBblFt(state.pipeId);
}

/** Float: pump-down / gravity-down only. Pulling the pipe lets KMW, then chase, fall out the bit. */
export function floatDrainOnMove(
  prevDepth: number,
  nextDepth: number,
  pipeKmwVolume: number,
  boreBblFt: number,
  pipeChaseVolume = 0,
) {
  const kmw = Math.max(0, pipeKmwVolume || 0);
  const chase = Math.max(0, pipeChaseVolume || 0);
  if (!(boreBblFt > 0)) {
    return { pipeKmwVolume: kmw, pipeChaseVolume: chase, drained: 0, drainedChase: 0 };
  }
  if (nextDepth >= prevDepth) {
    return { pipeKmwVolume: kmw, pipeChaseVolume: chase, drained: 0, drainedChase: 0 };
  }
  const pulled = (prevDepth - nextDepth) * boreBblFt;
  const drained = Math.min(kmw, pulled);
  const drainedChase = Math.min(chase, Math.max(0, pulled - drained));
  return {
    pipeKmwVolume: Math.max(0, kmw - drained),
    pipeChaseVolume: Math.max(0, chase - drainedChase),
    drained,
    drainedChase,
  };
}

export function volumeBelowDepth(
  state: WellState,
  depth: number,
  pipeDepth: number,
) {
  return volumeBetweenMd(state, depth, state.wellDepth, pipeDepth);
}

export function depthForVolumeBelow(
  state: WellState,
  volume: number,
  pipeDepth: number,
) {
  const total = volumeBelowDepth(state, 0, pipeDepth);
  if (volume <= 0) return state.wellDepth;
  if (volume >= total) return 0;
  let lo = 0;
  let hi = state.wellDepth;
  for (let i = 0; i < 48; i += 1) {
    const mid = (lo + hi) / 2;
    if (volumeBelowDepth(state, mid, pipeDepth) > volume) lo = mid;
    else hi = mid;
  }
  return (lo + hi) / 2;
}

export function volumeBetweenDepths(
  state: WellState,
  top: number,
  bottom: number,
  pipeDepth: number,
) {
  return Math.max(
    0,
    volumeBelowDepth(state, top, pipeDepth) -
      volumeBelowDepth(state, bottom, pipeDepth),
  );
}

export function depthForVolumeFromSurface(
  state: WellState,
  volume: number,
  pipeDepth: number,
) {
  const total = volumeBetweenMd(state, 0, state.wellDepth, pipeDepth);
  if (volume <= 0) return 0;
  if (volume >= total) return state.wellDepth;
  let lo = 0;
  let hi = state.wellDepth;
  for (let i = 0; i < 48; i += 1) {
    const mid = (lo + hi) / 2;
    if (volumeBetweenMd(state, 0, mid, pipeDepth) < volume) lo = mid;
    else hi = mid;
  }
  return (lo + hi) / 2;
}

function displacedInterfaceDepth(
  state: WellState,
  initialDepth: number,
  pipeDepth: number,
) {
  if (state.pipeEnd === "open") {
    const initialPipeDepth = state.referencePipeDepth;
    const annularRatio = pipeBblPerFt(state) / annularBblPerFt(state);
    const openHoleRatio = pipeBblPerFt(state) / openHoleBblPerFt(state);
    let depth: number;

    if (pipeDepth <= initialPipeDepth) {
      if (initialDepth >= initialPipeDepth) {
        depth = initialDepth + openHoleRatio * (initialPipeDepth - pipeDepth);
      } else {
        const crossingDepth =
          (initialDepth + annularRatio * initialPipeDepth) / (1 + annularRatio);
        depth =
          pipeDepth >= crossingDepth
            ? initialDepth + annularRatio * (initialPipeDepth - pipeDepth)
            : crossingDepth + openHoleRatio * (crossingDepth - pipeDepth);
      }
    } else if (initialDepth < initialPipeDepth) {
      depth = initialDepth - annularRatio * (pipeDepth - initialPipeDepth);
    } else {
      const crossingDepth =
        (initialDepth + openHoleRatio * initialPipeDepth) /
        (1 + openHoleRatio);
      depth =
        pipeDepth <= crossingDepth
          ? initialDepth - openHoleRatio * (pipeDepth - initialPipeDepth)
          : crossingDepth - annularRatio * (pipeDepth - crossingDepth);
    }

    return clamp(depth, 0, state.wellDepth);
  }

  const initialVolumeAbove = volumeBetweenDepths(
    state,
    0,
    initialDepth,
    state.referencePipeDepth,
  );
  const displacedVolume =
    (state.referencePipeDepth - pipeDepth) * pipeBblPerFt(state);
  return depthForVolumeFromSurface(
    state,
    Math.max(0, initialVolumeAbove + displacedVolume),
    pipeDepth,
  );
}

function movingPillAtPipeDepth(
  state: WellState,
  pipeDepth: number,
): PillInterval {
  const bottom = displacedInterfaceDepth(
    state,
    state.placedPillBottom,
    pipeDepth,
  );
  const bottomVolumeBelow = volumeBelowDepth(state, bottom, pipeDepth);
  const top = depthForVolumeBelow(
    state,
    bottomVolumeBelow + state.pillVolume,
    pipeDepth,
  );
  return { top, bottom };
}

export function pillPosition(state: WellState): PillInterval {
  const currentPipeDepth = state.pipeDepth;
  const initialPipeDepth = state.referencePipeDepth;
  const moving = movingPillAtPipeDepth(state, currentPipeDepth);

  if (currentPipeDepth >= initialPipeDepth || moving.top < currentPipeDepth) {
    return moving;
  }
  if (state.placedPillTop >= initialPipeDepth) {
    return { top: state.placedPillTop, bottom: state.placedPillBottom };
  }

  let shallowPipeDepth = currentPipeDepth;
  let deepPipeDepth = initialPipeDepth;
  for (let i = 0; i < 48; i++) {
    const midpoint = (shallowPipeDepth + deepPipeDepth) / 2;
    const midpointPill = movingPillAtPipeDepth(state, midpoint);
    if (midpointPill.top >= midpoint) shallowPipeDepth = midpoint;
    else deepPipeDepth = midpoint;
  }
  return movingPillAtPipeDepth(state, (shallowPipeDepth + deepPipeDepth) / 2);
}

export function computeModel(state: WellState): PillModel {
  const pipeDelta = state.pipeDepth - state.referencePipeDepth;
  const pill = pillPosition(state);
  let pillTop = pill.top;
  const pillBottom = pill.bottom;
  const topShift = pillTop - state.placedPillTop;
  const bottomShift = pillBottom - state.placedPillBottom;
  const pipeBoreBblFt = pipeBoreBblPerFt(state);
  const pipeKmwInHole = Math.min(
    Math.max(0, state.pipeKmwVolume),
    pipeBoreBblFt * Math.max(0, state.pipeDepth),
  );
  const pipeKmwTop =
    pipeBoreBblFt > 0
      ? Math.max(0, state.pipeDepth - pipeKmwInHole / pipeBoreBblFt)
      : state.pipeDepth;
  const pipeChaseInHole = Math.min(
    Math.max(0, state.pipeChaseVolume ?? 0),
    Math.max(0, pipeBoreBblFt * Math.max(0, pipeKmwTop)),
  );
  const pipeChaseTop =
    pipeBoreBblFt > 0
      ? Math.max(0, pipeKmwTop - pipeChaseInHole / pipeBoreBblFt)
      : pipeKmwTop;
  const atPlace = Math.abs(pipeDelta) < 1;
  const airCap = atPlace && state.pipeEnd === "closed" && pipeChaseTop > 80 && pipeChaseInHole < 0.05;
  const kmwBackfillRequired = Math.max(0, state.kmwBackfillRequired ?? 0);
  const pullFt = Math.max(0, -pipeDelta);
  const runFt = Math.max(0, pipeDelta);
  // Hole volume balance. Moving the pipe Δ ft changes the hole by Δ × pipeBblPerFt
  // (closed-end with a float, steel with open-end pipe). String fluid that drained
  // out through the float stays in the hole, so the trip tank only makes up the rest:
  //   fill = Δ × pipeBblPerFt − drained   (float holding, dry string: drained = 0)
  const drainedFromString =
    state.pipeEnd === "closed" ? Math.max(0, state.stringDrainedOnPull ?? 0) : 0;
  const holeMakeUp = pullFt * pipeBblPerFt(state) - drainedFromString;
  const backfillVolume = state.autoBackfill && pullFt > 0 ? Math.max(0, holeMakeUp) : 0;
  const kmwBackfillApplied =
    state.autoBackfill && pullFt > 0 ? Math.min(kmwBackfillRequired, backfillVolume) : 0;
  const mwFill = Math.max(0, backfillVolume - kmwBackfillApplied);
  const annularKmwVolume = state.pillVolume + kmwBackfillApplied;
  if (kmwBackfillApplied > 0.05) {
    const grown = topFromVolume(
      { ...state, pillVolume: annularKmwVolume },
      pillBottom,
      annularKmwVolume,
      state.pipeDepth,
    );
    pillTop = grown.top;
  }
  const phase = atPlace
    ? airCap
      ? "Equalized · air cap in DP, KMW turned the bit into the annulus"
      : pipeChaseInHole > 0.05
        ? "After pumping · chase on KMW in the string, float holding"
        : kmwBackfillRequired > 0.5
          ? `After pumping · ${kmwBackfillRequired.toFixed(0)} bbl KMW still needed — backfill while POOH`
          : "After pumping · KMW up the annulus, float holding KMW in the string"
    : pipeDelta < 0 && kmwBackfillRequired > 0.5 && kmwBackfillApplied < kmwBackfillRequired - 0.05
      ? `POOH · backfilling KMW (${kmwBackfillApplied.toFixed(1)} of ${kmwBackfillRequired.toFixed(0)} bbl)`
      : pipeDelta < 0 && kmwBackfillRequired > 0.5 && kmwBackfillApplied >= kmwBackfillRequired - 0.05
        ? "POOH · KMW backfill complete · continue with active mud"
        : pipeDelta < 0 && state.pipeEnd === "closed" && pipeKmwInHole > 0.05
          ? "POOH · KMW falling through the float into the well"
          : pipeDelta < 0 && state.pipeEnd === "closed"
            ? "POOH · string empty of KMW · float blocking backflow"
            : pipeDelta > 0 && state.pipeEnd === "closed"
              ? "RIH · float blocking influx into the string"
              : pillTop >= state.pipeDepth
                ? "Open hole · stationary below pipe end"
                : pillBottom > state.pipeDepth
                  ? state.pipeEnd === "open"
                    ? "Crossing pipe end · coherent pill front"
                    : "Crossing pipe end · conserving pill volume"
                  : state.pipeEnd === "closed"
                    ? "Annulus · float / closed-end displacement"
                    : "Annulus · open-end displacement";
  // Running back below placement: closed-end displacement comes back, plus anything
  // that drained out of the string on an earlier pull (it is still in the hole).
  const tripTankGain =
    state.autoBackfill && runFt > 0 ? runFt * pipeBblPerFt(state) + drainedFromString : 0;
  const fluidDrop = state.autoBackfill
    ? 0
    : depthForVolumeFromSurface(state, Math.max(0, holeMakeUp), state.pipeDepth);
  const fillZoneVolume = state.autoBackfill ? mwFill : 0;
  const fillZoneDepth = depthForVolumeFromSurface(
    state,
    fillZoneVolume,
    state.pipeDepth,
  );
  const pipeFluidVolume =
    state.pipeEnd === "open" ? Math.max(0, fillZoneVolume - mwFill) : 0;

  return {
    pipeDelta,
    topShift,
    bottomShift,
    pillTop,
    pillBottom,
    phase,
    backfillVolume,
    tripTankGain,
    fillZoneVolume,
    fillZoneDepth,
    pipeFluidVolume,
    fluidDrop,
    pipeBblFt: pipeBblPerFt(state),
    annularBblFt: annularBblPerFt(state),
    openHoleBblFt: openHoleBblPerFt(state),
    pipeBoreBblFt,
    pipeKmwTop,
    pipeKmwInHole,
    pipeChaseTop,
    pipeChaseInHole,
    kmwBackfillRequired,
    kmwBackfillApplied,
    annularKmwVolume,
  };
}

export function geometryError(
  holeId: number,
  pipeOd: number,
  pipeId: number,
): string {
  if (![holeId, pipeOd, pipeId].every(Number.isFinite)) {
    return "Enter all three diameters.";
  }
  if (holeId <= 0 || pipeOd <= 0) {
    return "Hole ID and pipe OD must be greater than zero.";
  }
  if (holeId <= pipeOd) return "Hole ID must be greater than pipe OD.";
  if (pipeId < 0 || pipeId >= pipeOd) {
    return "Pipe ID must be zero or greater and less than pipe OD.";
  }
  return "";
}

export function pillIntervalError(
  top: number,
  bottom: number,
  wellDepth: number,
): string {
  if (![top, bottom].every(Number.isFinite)) return "Enter both pill depths.";
  if (top < 0 || bottom > wellDepth) {
    return "Pill depths must remain inside the well.";
  }
  if (top >= bottom) return "Top depth must be shallower than bottom depth.";
  return "";
}

export function volumeFromDepths(
  state: WellState,
  top: number,
  bottom: number,
  pipeDepth = state.pipeDepth,
) {
  return volumeBetweenDepths(state, top, bottom, pipeDepth);
}

export function topFromVolume(
  state: WellState,
  bottom: number,
  requestedVolume: number,
  pipeDepth = state.pipeDepth,
) {
  const bottomVolumeBelow = volumeBelowDepth(state, bottom, pipeDepth);
  const maximumVolume =
    volumeBelowDepth(state, 0, pipeDepth) - bottomVolumeBelow;
  const volume = Math.min(requestedVolume, maximumVolume);
  const top = depthForVolumeBelow(state, bottomVolumeBelow + volume, pipeDepth);
  return { top: Math.max(0, top), volume, maximumVolume };
}
