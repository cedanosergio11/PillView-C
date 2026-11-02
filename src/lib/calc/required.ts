import { asNum, isNum } from "@/lib/utils";
import type { WellInputs } from "./types";

export type RequiredInput = { key: keyof WellInputs; label: string };

/** Inputs the sheet needs before it can build a procedure. The Audit warning uses the same list. */
const SHEET_REQUIRED: readonly RequiredInput[] = [
  { key: "anchorTvd", label: "Anchor point TVD" },
  { key: "casingTvd", label: "Casing depth TVD" },
  { key: "spotMd", label: "Spot depth MD" },
  { key: "openHoleDia", label: "Open hole diameter" },
  { key: "desiredEmw", label: "Desired EMW" },
  { key: "currentMw", label: "Current MW" },
  { key: "kmw", label: "KMW" },
  { key: "idDp", label: "ID drill pipe" },
  { key: "odDp", label: "OD drill pipe" },
  { key: "idCasing", label: "ID casing" },
  { key: "pumpDisp", label: "Pump displacement" },
  { key: "desiredResolution", label: "Desired resolution" },
  { key: "initialFlowRate", label: "Initial flow rate" },
  { key: "safevisionNoSlug", label: "SafeVision AP ECD (no slug)" },
];

const SLUG_REQUIRED: RequiredInput = { key: "overbalanceSlug", label: "Overbalance pressure for slug" };

export function requiredInputs(inputs: WellInputs): RequiredInput[] {
  return inputs.pillMode === "withSlug" ? [...SHEET_REQUIRED, SLUG_REQUIRED] : [...SHEET_REQUIRED];
}

export function hasValue(inputs: WellInputs, key: keyof WellInputs): boolean {
  return isNum(asNum(inputs[key]));
}

/** Required inputs that are still blank, in sheet order. */
export function missingRequired(inputs: WellInputs): RequiredInput[] {
  return requiredInputs(inputs).filter(({ key }) => !hasValue(inputs, key));
}

/** True once any required value is entered, so a blank well is not flagged field by field. */
export function wellStarted(inputs: WellInputs): boolean {
  return requiredInputs(inputs).some(({ key }) => hasValue(inputs, key));
}

/**
 * What the simulator needs to draw this well instead of a default one: the pill
 * volume (anchor TVD, desired EMW, both mud weights), the spot depth, the string,
 * and a hole size.
 */
export function missingForSimulator(inputs: WellInputs): string[] {
  const missing: string[] = [];
  const need: [keyof WellInputs, string][] = [
    ["spotMd", "Spot depth MD"],
    ["anchorTvd", "Anchor point TVD"],
    ["desiredEmw", "Desired EMW"],
    ["currentMw", "Current MW"],
    ["kmw", "KMW"],
    ["odDp", "OD drill pipe"],
    ["idDp", "ID drill pipe"],
  ];
  for (const [key, label] of need) if (!hasValue(inputs, key)) missing.push(label);
  if (!hasValue(inputs, "idCasing") && !hasValue(inputs, "openHoleDia")) {
    missing.push("ID casing or open hole diameter");
  }
  return missing;
}
