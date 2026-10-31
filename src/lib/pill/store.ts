import { create } from "zustand";
import { calculate } from "@/lib/calc/engine";
import { EMPTY_INPUTS } from "@/lib/calc/examples";
import type { CalcResults, WellInputs } from "@/lib/calc/types";
import { asNum, isNum } from "@/lib/utils";
import {
  composeWellState,
  geometryFromWell,
  pillFromProcedure,
  procedureSyncKey,
} from "./from-calc";
import { equalizeFloatAirCap } from "@/lib/calc/equalize";
import { tvdFn } from "./hydrostatic";
import {
  clamp,
  floatDrainOnMove,
  geometryError,
  pillIntervalError,
  pipeBoreBblPerFt,
  topFromVolume,
  volumeFromDepths,
} from "./physics";
import type { PipeEnd, WellState } from "./types";

export type SimControls = {
  pipeDepth: number;
  referencePipeDepth: number;
  pipeEnd: PipeEnd;
  autoBackfill: boolean;
  placedPillTop: number;
  placedPillBottom: number;
  pillVolume: number;
  pillMw: number;
  pipeKmwVolume: number;
  pipeChaseVolume: number;
  draftTop: number;
  draftBottom: number;
  draftVolume: number;
  draftMw: number;
  pillError: string;
  geometryErr: string;
  dirty: boolean;
  lastSyncKey: string;
  equalized: boolean;
  kmwBackfillRequired: number;
  /** KMW + chase drained out of the string through the float since the pill was placed, bbl. */
  stringDrainedOnPull: number;
};

type SimulatorStore = SimControls & {
  setPipeDepth: (depth: number, state: WellState) => void;
  bumpPipe: (delta: number, state: WellState) => void;
  setPipeEnd: (end: PipeEnd) => void;
  setAutoBackfill: (on: boolean) => void;
  setDraftTop: (top: number, state: WellState) => void;
  setDraftBottom: (bottom: number, state: WellState) => void;
  setDraftVolume: (volume: number, state: WellState) => void;
  setDraftMw: (mw: number) => void;
  placePill: (state: WellState) => boolean;
  placeFromProcedure: (inputs: WellInputs, results: CalcResults) => void;
  setEqualized: (on: boolean, inputs: WellInputs, results: CalcResults) => void;
  syncFromCalc: (inputs: WellInputs, results: CalcResults) => void;
  resetToProcedure: (inputs: WellInputs, results: CalcResults) => void;
};

const SEED_INPUTS = { ...EMPTY_INPUTS };
const SEED_RESULTS = calculate(SEED_INPUTS);
const INITIAL_PLACEMENT = pillFromProcedure(
  SEED_INPUTS,
  SEED_RESULTS,
  geometryFromWell(SEED_INPUTS),
);

function controlsFromPlacement(
  placement: ReturnType<typeof pillFromProcedure>,
  extras: Partial<SimControls> = {},
): Partial<SimControls> {
  return {
    ...placement,
    draftTop: placement.placedPillTop,
    draftBottom: placement.placedPillBottom,
    draftVolume: placement.pillVolume,
    draftMw: placement.pillMw,
    pillError: "",
    geometryErr: "",
    stringDrainedOnPull: 0,
    ...extras,
  };
}

function balanceAtBit(
  state: WellState,
  bitMd: number,
  kmw: number,
  pipeKmwVolume: number,
  pipeChaseVolume: number,
  pillVolume: number,
  pillTop: number,
  pillBottom: number,
) {
  const bore = pipeBoreBblPerFt({ ...state, pipeDepth: bitMd });
  const annularHeight = Math.max(0, pillBottom - pillTop);
  const annularBblFt = annularHeight > 0 ? pillVolume / annularHeight : Math.max(bore, 1e-9);
  const eq = equalizeFloatAirCap({
    bitMd,
    tvdOf: tvdFn(state),
    kmw,
    baseMw: state.baseMw,
    boreBblFt: bore,
    annularBblFt,
    pipeKmwVolume,
    pipeChaseVolume,
    annularHeightMd: annularHeight,
  });
  const extra = Math.max(0, pipeKmwVolume - eq.remainingPipeKmw);
  if (extra < 1e-4) {
    return { pipeKmwVolume, pipeChaseVolume, pillVolume, placedPillTop: pillTop };
  }
  const { top, volume } = topFromVolume(
    { ...state, pipeDepth: bitMd, pipeKmwVolume: eq.remainingPipeKmw, pipeChaseVolume },
    pillBottom,
    pillVolume + extra,
    bitMd,
  );
  const actualDump = Math.max(0, volume - pillVolume);
  return {
    pipeKmwVolume: Math.max(0, pipeKmwVolume - actualDump),
    pipeChaseVolume,
    pillVolume: volume,
    placedPillTop: top,
  };
}

function applyPipeMove(
  get: () => SimControls,
  set: (partial: Partial<SimControls>) => void,
  nextDepth: number,
  state: WellState,
) {
  const current = get();
  const closed = current.pipeEnd === "closed";
  let pipeKmwVolume = current.pipeKmwVolume;
  let pipeChaseVolume = current.pipeChaseVolume ?? 0;
  let pillVolume = current.pillVolume;
  let placedPillTop = current.placedPillTop;
  let equalized = current.equalized;
  let stringDrainedOnPull = current.stringDrainedOnPull ?? 0;
  const atPlacement = Math.abs(current.pipeDepth - current.referencePipeDepth) < 1;

  if (closed && !equalized) {
    const beforeKmw = pipeKmwVolume;
    const eq = balanceAtBit(
      state,
      current.pipeDepth,
      current.pillMw,
      pipeKmwVolume,
      pipeChaseVolume,
      pillVolume,
      placedPillTop,
      current.placedPillBottom,
    );
    pipeKmwVolume = eq.pipeKmwVolume;
    pipeChaseVolume = eq.pipeChaseVolume;
    pillVolume = eq.pillVolume;
    placedPillTop = eq.placedPillTop;
    equalized = true;
    // The U-tube at the placement depth happens before the trip starts, so it is not
    // counted against trip tank fill. Off placement it is part of the trip.
    if (!atPlacement) stringDrainedOnPull += Math.max(0, beforeKmw - eq.pipeKmwVolume);
  }

  const drainedMove = closed
    ? floatDrainOnMove(
        current.pipeDepth,
        nextDepth,
        pipeKmwVolume,
        pipeBoreBblPerFt(state),
        pipeChaseVolume,
      )
    : { pipeKmwVolume, pipeChaseVolume, drained: 0, drainedChase: 0 };
  pipeKmwVolume = drainedMove.pipeKmwVolume;
  pipeChaseVolume = drainedMove.pipeChaseVolume;
  stringDrainedOnPull += drainedMove.drained + drainedMove.drainedChase;
  if (drainedMove.drained > 0.0001) {
    pillVolume += drainedMove.drained;
    const { top } = topFromVolume(
      { ...state, pipeDepth: nextDepth, pipeKmwVolume, pipeChaseVolume },
      current.placedPillBottom,
      pillVolume,
      nextDepth,
    );
    placedPillTop = top;
  }

  if (closed) {
    const beforeKmw = pipeKmwVolume;
    const eq = balanceAtBit(
      state,
      nextDepth,
      current.pillMw,
      pipeKmwVolume,
      pipeChaseVolume,
      pillVolume,
      placedPillTop,
      current.placedPillBottom,
    );
    pipeKmwVolume = eq.pipeKmwVolume;
    pipeChaseVolume = eq.pipeChaseVolume;
    pillVolume = eq.pillVolume;
    placedPillTop = eq.placedPillTop;
    stringDrainedOnPull += Math.max(0, beforeKmw - eq.pipeKmwVolume);
  }

  set({
    pipeDepth: nextDepth,
    pipeKmwVolume,
    pipeChaseVolume,
    stringDrainedOnPull,
    pillVolume,
    placedPillTop,
    draftTop: placedPillTop,
    draftVolume: pillVolume,
    equalized,
    dirty: true,
  });
}

export const useSimulator = create<SimulatorStore>((set, get) => ({
  pipeDepth: INITIAL_PLACEMENT.pipeDepth,
  referencePipeDepth: INITIAL_PLACEMENT.referencePipeDepth,
  pipeEnd: "closed",
  autoBackfill: true,
  placedPillTop: INITIAL_PLACEMENT.placedPillTop,
  placedPillBottom: INITIAL_PLACEMENT.placedPillBottom,
  pillVolume: INITIAL_PLACEMENT.pillVolume,
  pillMw: INITIAL_PLACEMENT.pillMw,
  pipeKmwVolume: INITIAL_PLACEMENT.pipeKmwVolume,
  pipeChaseVolume: INITIAL_PLACEMENT.pipeChaseVolume ?? 0,
  draftTop: INITIAL_PLACEMENT.placedPillTop,
  draftBottom: INITIAL_PLACEMENT.placedPillBottom,
  draftVolume: INITIAL_PLACEMENT.pillVolume,
  draftMw: INITIAL_PLACEMENT.pillMw,
  pillError: "",
  geometryErr: "",
  dirty: false,
  lastSyncKey: procedureSyncKey(SEED_INPUTS, SEED_RESULTS),
  equalized: false,
  kmwBackfillRequired: 0,
  stringDrainedOnPull: 0,

  setPipeDepth: (depth, state) => {
    applyPipeMove(get, set, clamp(depth, 0, state.wellDepth), state);
  },

  bumpPipe: (delta, state) => {
    const { pipeDepth } = get();
    applyPipeMove(get, set, clamp(pipeDepth + delta, 0, state.wellDepth), state);
  },

  setPipeEnd: (pipeEnd) => set({ pipeEnd, dirty: true }),

  setAutoBackfill: (autoBackfill) => set({ autoBackfill }),

  setDraftTop: (top, state) => {
    const err = pillIntervalError(top, get().draftBottom, state.wellDepth);
    if (err) {
      set({ draftTop: top, pillError: err });
      return;
    }
    const volume = volumeFromDepths(state, top, get().draftBottom, state.pipeDepth);
    set({ draftTop: top, draftVolume: volume, pillError: "" });
  },

  setDraftBottom: (bottom, state) => {
    const err = pillIntervalError(get().draftTop, bottom, state.wellDepth);
    if (err) {
      set({ draftBottom: bottom, pillError: err });
      return;
    }
    const volume = volumeFromDepths(state, get().draftTop, bottom, state.pipeDepth);
    set({ draftBottom: bottom, draftVolume: volume, pillError: "" });
  },

  setDraftVolume: (requested, state) => {
    if (!Number.isFinite(get().draftBottom) || get().draftBottom <= 0) {
      set({ pillError: "Enter a valid bottom depth first." });
      return;
    }
    if (!Number.isFinite(requested) || requested <= 0) {
      set({ draftVolume: requested, pillError: "Pill volume must be greater than zero." });
      return;
    }
    const { top, volume } = topFromVolume(state, get().draftBottom, requested, state.pipeDepth);
    set({ draftTop: top, draftVolume: volume, pillError: "" });
  },

  setDraftMw: (draftMw) => set({ draftMw: clamp(draftMw, 8, 22) }),

  placePill: (state) => {
    const current = get();
    const err = pillIntervalError(current.draftTop, current.draftBottom, state.wellDepth);
    if (err) {
      set({ pillError: err });
      return false;
    }
    const geoErr = geometryError(state.holeId, state.pipeOd, state.pipeId);
    if (geoErr) {
      set({ geometryErr: geoErr });
      return false;
    }
    const volume = volumeFromDepths(
      state,
      current.draftTop,
      current.draftBottom,
      state.pipeDepth,
    );
    set({
      placedPillTop: current.draftTop,
      placedPillBottom: current.draftBottom,
      pillVolume: volume,
      pillMw: current.draftMw,
      draftVolume: volume,
      referencePipeDepth: state.pipeDepth,
      stringDrainedOnPull: 0,
      pillError: "",
      geometryErr: "",
      dirty: true,
    });
    return true;
  },

  placeFromProcedure: (inputs, results) => {
    const geometry = geometryFromWell(inputs);
    const placement = pillFromProcedure(inputs, results, geometry, get().pipeEnd, {
      equalized: get().equalized,
    });
    set({
      ...controlsFromPlacement(placement),
      dirty: false,
      lastSyncKey: procedureSyncKey(inputs, results),
      kmwBackfillRequired: isNum(results.bblBackfill) ? Math.max(0, results.bblBackfill) : 0,
    });
  },

  setEqualized: (equalized, inputs, results) => {
    const geometry = geometryFromWell(inputs);
    const placement = pillFromProcedure(inputs, results, geometry, get().pipeEnd, {
      equalized,
    });
    set({
      ...controlsFromPlacement(placement),
      equalized,
      dirty: false,
      lastSyncKey: procedureSyncKey(inputs, results),
      kmwBackfillRequired: isNum(results.bblBackfill) ? Math.max(0, results.bblBackfill) : 0,
    });
  },

  syncFromCalc: (inputs, results) => {
    const key = procedureSyncKey(inputs, results);
    const current = get();
    if (current.lastSyncKey === key) return;
    if (current.dirty && current.lastSyncKey) {
      const previousWell = current.lastSyncKey.split("|")[0];
      if (previousWell === String(inputs.wellName ?? "")) {
        set({ lastSyncKey: key });
        return;
      }
    }
    const geometry = geometryFromWell(inputs);
    const placement = pillFromProcedure(inputs, results, geometry, current.pipeEnd, {
      equalized: current.equalized,
    });
    set({
      ...controlsFromPlacement(placement),
      dirty: false,
      lastSyncKey: key,
      kmwBackfillRequired: isNum(results.bblBackfill) ? Math.max(0, results.bblBackfill) : 0,
    });
  },

  resetToProcedure: (inputs, results) => {
    get().placeFromProcedure(inputs, results);
  },
}));

export function wellFromStores(inputs: WellInputs, sim: SimControls): WellState {
  return composeWellState(inputs, {
    pipeEnd: sim.pipeEnd,
    pipeDepth: sim.pipeDepth,
    referencePipeDepth: sim.referencePipeDepth,
    placedPillTop: sim.placedPillTop,
    placedPillBottom: sim.placedPillBottom,
    pillVolume: sim.pillVolume,
    pillMw: isNum(asNum(inputs.kmw)) && !sim.dirty ? asNum(inputs.kmw) : sim.pillMw,
    autoBackfill: sim.autoBackfill,
    pipeKmwVolume: sim.pipeKmwVolume,
    pipeChaseVolume: sim.pipeChaseVolume ?? 0,
    kmwBackfillRequired: sim.kmwBackfillRequired ?? 0,
    stringDrainedOnPull: sim.stringDrainedOnPull ?? 0,
  });
}
