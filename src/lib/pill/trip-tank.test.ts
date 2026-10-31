import { describe, expect, it } from "vitest";
import { calculate } from "../calc/engine";
import { EMPTY_INPUTS, EXAMPLE_1 } from "../calc/examples";
import type { WellInputs } from "../calc/types";
import { composeWellState, geometryFromWell, pillFromProcedure } from "./from-calc";
import { computeModel } from "./physics";
import type { WellState } from "./types";

// EXAMPLE 1 string: 4.5 in OD × 3.826 in ID drill pipe in 6.875 in casing.
//   closed-end 4.5² / 1029.4             = 0.019672 bbl/ft → 19.67 bbl per 1,000 ft
//   steel     (4.5² − 3.826²) / 1029.4   = 0.005452 bbl/ft →  5.45 bbl per 1,000 ft
//   bore       3.826² / 1029.4           = 0.014220 bbl/ft → 14.22 bbl per 1,000 ft
//   annulus   (6.875² − 4.5²) / 1029.4   = 0.026244 bbl/ft
const BORE_PER_FT = 3.826 ** 2 / 1029.4;

describe("trip tank fill — hole volume balance", () => {
  const results = calculate(EXAMPLE_1);
  const placement = pillFromProcedure(EXAMPLE_1, results, geometryFromWell(EXAMPLE_1), "closed");

  const at = (deltaFt: number, extra: Partial<WellState> = {}) =>
    computeModel(
      composeWellState(EXAMPLE_1, {
        ...placement,
        pipeDepth: placement.pipeDepth + deltaFt,
        pipeEnd: "closed",
        autoBackfill: true,
        ...extra,
      }),
    );

  it("float holding, nothing drained: 1,000 ft pull fills closed-end displacement", () => {
    expect(at(-1000).backfillVolume).toBeCloseTo(19.67, 1);
  });

  it("KMW draining a full bore per foot: 1,000 ft pull fills steel only", () => {
    const model = at(-1000, { stringDrainedOnPull: 1000 * BORE_PER_FT });
    expect(model.backfillVolume).toBeCloseTo(5.45, 1);
  });

  it("open-end pipe still fills steel", () => {
    expect(at(-1000, { pipeEnd: "open" }).backfillVolume).toBeCloseTo(5.45, 1);
  });

  it("trip tank off: level drop is the same make-up volume over the annulus", () => {
    const model = at(-1000, { autoBackfill: false, stringDrainedOnPull: 1000 * BORE_PER_FT });
    expect(model.backfillVolume).toBe(0);
    // 5.45 bbl / 0.026244 bbl/ft = 207.7 ft
    expect(model.fluidDrop).toBeCloseTo(207.7, 0);
  });

  it("running back below placement returns closed-end plus what drained earlier", () => {
    // 500 × 0.019672 + 3 = 12.84 bbl
    expect(at(500, { stringDrainedOnPull: 3 }).tripTankGain).toBeCloseTo(12.84, 1);
  });
});

describe("simulator well depth", () => {
  it("never adds hole below the deepest entered depth", () => {
    const shallow: WellInputs = {
      ...EXAMPLE_1,
      tdDepth: "",
      currentDepthMd: 7800,
      anchorMd: 7600,
      anchorTvd: 7600,
      spotMd: 7000,
      spotTvd: 7000,
      casingMd: 6500,
      casingTvd: 6500,
    };
    expect(geometryFromWell(shallow).wellDepth).toBe(7800);
  });

  it("uses the 10,000 ft demo depth only when no depth is entered", () => {
    expect(geometryFromWell(EMPTY_INPUTS).wellDepth).toBe(10000);
  });
});
