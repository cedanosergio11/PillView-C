export type PipeEnd = "closed" | "open";

export type SurveyPoint = {
  md: number;
  tvd: number;
};

export type WellState = {
  wellDepth: number;
  holeId: number;
  /** Casing shoe MD; 0 / omitted = treat the hole ID as uniform. */
  casingMd?: number;
  /** Open-hole diameter below the shoe; 0 / omitted = same as holeId. */
  openHoleId?: number;
  pipeOd: number;
  pipeId: number;
  pipeEnd: PipeEnd;
  pipeDepth: number;
  referencePipeDepth: number;
  placedPillTop: number;
  placedPillBottom: number;
  pillVolume: number;
  pillMw: number;
  autoBackfill: boolean;
  baseMw: number;
  /** KMW trapped in the string by the float after pumping. */
  pipeKmwVolume: number;
  /** Base-fluid chase sitting on top of KMW in the string. */
  pipeChaseVolume: number;
  /** KMW still needed after spotting, backfilled while POOH. */
  kmwBackfillRequired?: number;
  /**
   * KMW + chase that left the string through the float while the pipe moved
   * away from the reference depth, bbl. It stays in the hole, so it offsets
   * trip tank fill. The U-tube at the placement depth is not counted here.
   */
  stringDrainedOnPull?: number;
  /** MD/TVD pairs for hydrostatic (pressure uses TVD). */
  survey: SurveyPoint[];
};

export type PillInterval = {
  top: number;
  bottom: number;
};

export type PillModel = {
  pipeDelta: number;
  topShift: number;
  bottomShift: number;
  pillTop: number;
  pillBottom: number;
  phase: string;
  backfillVolume: number;
  tripTankGain: number;
  fillZoneVolume: number;
  fillZoneDepth: number;
  pipeFluidVolume: number;
  fluidDrop: number;
  pipeBblFt: number;
  annularBblFt: number;
  openHoleBblFt: number;
  pipeBoreBblFt: number;
  pipeKmwTop: number;
  pipeKmwInHole: number;
  pipeChaseTop: number;
  pipeChaseInHole: number;
  kmwBackfillRequired: number;
  kmwBackfillApplied: number;
  annularKmwVolume: number;
};

export type HydroLayer = {
  top: number;
  bottom: number;
  mw: number;
  name: string;
};

export const DEFAULT_STATE: WellState = {
  wellDepth: 10000,
  holeId: 6.875,
  casingMd: 0,
  openHoleId: 0,
  pipeOd: 4.5,
  pipeId: 4.276,
  pipeEnd: "closed",
  pipeDepth: 9000,
  referencePipeDepth: 9000,
  placedPillTop: 0,
  placedPillBottom: 750,
  pillVolume: 19.7,
  pillMw: 16,
  autoBackfill: true,
  baseMw: 10.5,
  pipeKmwVolume: 0,
  pipeChaseVolume: 0,
  kmwBackfillRequired: 0,
  stringDrainedOnPull: 0,
  survey: [],
};

export const WELL_DEPTHS = [8000, 10000, 12000, 15000] as const;
