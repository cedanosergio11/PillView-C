import { useEffect } from "react";
import { NumberField, PairField, Section, TextField } from "@/components/fields";
import { hasValue, requiredInputs, wellStarted } from "@/lib/calc/required";
import type { WellInputs } from "@/lib/calc/types";
import { ExcelPasteButton } from "@/components/excel-paste";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { Label } from "@/components/ui/label";
import { Field } from "@/components/fields";
import { Input } from "@/components/ui/input";
import { chicagoDate } from "@/lib/chicago-date";
import { useAppStore } from "@/lib/store";
import { calculate } from "@/lib/calc";
import { formatNumber, isNum } from "@/lib/utils";
import { TRIP_TABLES } from "@/lib/calc/tables";
import { dPsi } from "@/components/fmt";

const GEOMETRY_KEYS: (keyof WellInputs)[] = [
  "currentDepthMd",
  "anchorMd",
  "anchorTvd",
  "casingMd",
  "casingTvd",
  "spotMd",
  "spotTvd",
  "openHoleDia",
  "idCasing",
  "odDp",
  "idDp",
];
const FLUID_KEYS: (keyof WellInputs)[] = [
  "desiredEmw",
  "currentMw",
  "kmw",
  "pumpDisp",
  "sbpConnection",
  "fit",
  "maxFlowRate",
];
const OPERATIONAL_KEYS: (keyof WellInputs)[] = [
  "desiredResolution",
  "initialFlowRate",
  "overbalanceSlug",
  "safevisionNoSlug",
  "topSlugBbl",
];

export function InputPanel() {
  const inputs = useAppStore((s) => s.inputs);
  const setField = useAppStore((s) => s.setField);
  const results = calculate(inputs);

  // Required inputs get a marker. Blank ones are outlined only after the well has
  // some values, so a new well is not covered in warnings.
  const requiredKeys = new Set(requiredInputs(inputs).map((r) => r.key));
  const started = wellStarted(inputs);
  const isMissing = (key: keyof WellInputs) =>
    started && requiredKeys.has(key) && !hasValue(inputs, key);
  const req = (key: keyof WellInputs) => ({
    required: requiredKeys.has(key),
    missing: isMissing(key),
  });
  const missingIn = (keys: (keyof WellInputs)[]) => keys.filter(isMissing).length;

  // First paint stays date="" so prerendered HTML matches hydration.
  // The Chicago day is written only after persist rehydration, and only when the field is empty.
  useEffect(() => {
    const stampChicagoDate = () => {
      if (useAppStore.getState().inputs.date) return;
      useAppStore.getState().setField("date", chicagoDate());
    };
    const unsubscribe = useAppStore.persist.onFinishHydration(stampChicagoDate);
    if (useAppStore.persist.hasHydrated()) stampChicagoDate();
    return unsubscribe;
  }, []);

  return (
    <div className="flex flex-col">
      <div className="border-b border-border px-4 py-3">
        <ExcelPasteButton />
      </div>
      <Section title="Well information">
        <TextField label="Well name" value={inputs.wellName} onChange={(v) => setField("wellName", v)} />
        <TextField label="Client" value={inputs.client} onChange={(v) => setField("client", v)} />
        <TextField label="Date" type="date" value={inputs.date} onChange={(v) => setField("date", v)} />
        <TextField label="Produced by" value={inputs.producedBy} onChange={(v) => setField("producedBy", v)} />
        <Field label="Section type">
          <Select
            value={inputs.sectionType}
            onValueChange={(v) => setField("sectionType", v as "Production" | "Intermediate")}
          >
            <SelectTrigger>
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="Production">Production (step down flow)</SelectItem>
              <SelectItem value="Intermediate">Intermediate (hold flow)</SelectItem>
            </SelectContent>
          </Select>
        </Field>
      </Section>

      <Section title="Geometry" missingCount={missingIn(GEOMETRY_KEYS)}>
        <NumberField label="Current well depth" unit="ft MD" value={inputs.currentDepthMd} onChange={(v) => setField("currentDepthMd", v)} {...req("currentDepthMd")} />
        <PairField
          label="Anchor / BOC"
          left={{ unit: "ft MD", value: inputs.anchorMd, onChange: (v) => setField("anchorMd", v), ...req("anchorMd") }}
          right={{ unit: "ft TVD", value: inputs.anchorTvd, onChange: (v) => setField("anchorTvd", v), ...req("anchorTvd") }}
        />
        <PairField
          label="Casing depth"
          left={{ unit: "ft MD", value: inputs.casingMd, onChange: (v) => setField("casingMd", v), ...req("casingMd") }}
          right={{ unit: "ft TVD", value: inputs.casingTvd, onChange: (v) => setField("casingTvd", v), ...req("casingTvd") }}
        />
        <PairField
          label="Spot depth"
          left={{ unit: "ft MD", value: inputs.spotMd, onChange: (v) => setField("spotMd", v), ...req("spotMd") }}
          right={{ unit: "ft TVD", value: inputs.spotTvd, onChange: (v) => setField("spotTvd", v), ...req("spotTvd") }}
        />
        <NumberField label="Open hole diameter" unit="in" value={inputs.openHoleDia} onChange={(v) => setField("openHoleDia", v)} {...req("openHoleDia")} />
        <NumberField label="ID casing" unit="in" value={inputs.idCasing} onChange={(v) => setField("idCasing", v)} {...req("idCasing")} />
        <PairField
          label="Drill pipe"
          left={{ unit: "OD in", value: inputs.odDp, onChange: (v) => setField("odDp", v), ...req("odDp") }}
          right={{ unit: "ID in", value: inputs.idDp, onChange: (v) => setField("idDp", v), ...req("idDp") }}
        />
      </Section>

      <Section title="Fluid & pressure" missingCount={missingIn(FLUID_KEYS)}>
        <NumberField label="Desired EMW @ anchor" unit="ppge" value={inputs.desiredEmw} onChange={(v) => setField("desiredEmw", v)} {...req("desiredEmw")} />
        <NumberField label="Current MW" unit="ppg" value={inputs.currentMw} onChange={(v) => setField("currentMw", v)} {...req("currentMw")} />
        <NumberField label="KMW" unit="ppg" value={inputs.kmw} onChange={(v) => setField("kmw", v)} {...req("kmw")} />
        <NumberField label="Pump displacement" unit="bbl/stk" value={inputs.pumpDisp} onChange={(v) => setField("pumpDisp", v)} step="0.0001" {...req("pumpDisp")} />
        <NumberField label="SBP on connection" unit="psi" value={inputs.sbpConnection} onChange={(v) => setField("sbpConnection", v)} />
        <NumberField label="FIT" unit="ppge" value={inputs.fit} onChange={(v) => setField("fit", v)} />
        <NumberField label="Max flow rate" unit="gpm" value={inputs.maxFlowRate} onChange={(v) => setField("maxFlowRate", v)} />
      </Section>

      <Section title="Operational settings" missingCount={missingIn(OPERATIONAL_KEYS)}>
        <NumberField
          label="Desired resolution"
          unit="bbl"
          value={inputs.desiredResolution}
          onChange={(v) => setField("desiredResolution", v)}
          hint="20 bbl for 6.75 in hole, 30 bbl for 8.5 in. Use multiples of 5 or 10."
          {...req("desiredResolution")}
        />
        <NumberField label="Initial flow rate" unit="gpm" value={inputs.initialFlowRate} onChange={(v) => setField("initialFlowRate", v)} {...req("initialFlowRate")} />
        <NumberField
          label="Static stripping pressure"
          unit="psi"
          value={isNum(results.staticStrippingPressure) ? Math.round(results.staticStrippingPressure) : ""}
          onChange={() => {}}
          disabled
        />
        <NumberField
          label="Max dynamic SBP"
          unit="psi"
          value={isNum(results.maxDynamicSbp) ? Math.round(results.maxDynamicSbp) : ""}
          onChange={() => {}}
          disabled
        />
        <NumberField
          label="Overbalance for slug"
          unit="psi"
          value={inputs.overbalanceSlug}
          onChange={(v) => setField("overbalanceSlug", v)}
          hint="Typically 200–300 psi. Leave 0 for a no-slug procedure."
          {...req("overbalanceSlug")}
        />
        <NumberField
          label="SafeVision AP ECD (no slug)"
          unit="ppge"
          value={inputs.safevisionNoSlug}
          onChange={(v) => setField("safevisionNoSlug", v)}
          hint="ECD at initial flow with RCD installed, bit at spot depth."
          {...req("safevisionNoSlug")}
        />
        <NumberField
          label="SafeVision AP ECD (w/ slug)"
          unit="ppge"
          value={isNum(results.safevisionSlug) ? Number(results.safevisionSlug.toFixed(3)) : ""}
          onChange={() => {}}
          disabled
          hint="Auto: no-slug ECD plus slug-fallout equivalent."
        />
        <NumberField
          label="Top slug (manual)"
          unit="bbl"
          value={inputs.topSlugBbl}
          onChange={(v) => setField("topSlugBbl", v)}
          hint="Not included in pill volume. Only possible when chase exists. Edit last chase rows on the schedule."
        />
      </Section>

      <Section title="Tapered casing / string" defaultOpen={false}>
        <div className="flex items-center justify-between gap-3 rounded-lg border border-border bg-muted/40 px-3 py-2">
          <div>
            <Label className="text-foreground">Tapered trigger</Label>
            <p className="mt-1 text-[11px] text-muted-foreground">
              ON only if tapered casing or DP, pill spotted at liner shoe, and pill height exceeds liner length.
            </p>
          </div>
          <Switch checked={inputs.taperedOn} onCheckedChange={(v) => setField("taperedOn", v)} />
        </div>
        <NumberField label="Casing ID (larger)" unit="in" value={inputs.casingIdLarger} onChange={(v) => setField("casingIdLarger", v)} />
        <NumberField label="Casing shoe MD (larger)" unit="ft" value={inputs.casingShoeMdLarger} onChange={(v) => setField("casingShoeMdLarger", v)} />
        <NumberField label="Liner ID" unit="in" value={inputs.linerId} onChange={(v) => setField("linerId", v)} />
        <NumberField label="Liner hanger top MD" unit="ft" value={inputs.linerHangerMd} onChange={(v) => setField("linerHangerMd", v)} />
        <NumberField label="Liner shoe MD" unit="ft" value={inputs.linerShoeMd} onChange={(v) => setField("linerShoeMd", v)} />
        <NumberField label="OD DP 1 (smaller)" unit="in" value={inputs.odDp1} onChange={(v) => setField("odDp1", v)} />
        <NumberField label="ID DP 1 (smaller)" unit="in" value={inputs.idDp1} onChange={(v) => setField("idDp1", v)} />
        <NumberField label="Length DP 1" unit="ft" value={inputs.lengthDp1} onChange={(v) => setField("lengthDp1", v)} />
        <NumberField label="OD DP 2 (larger)" unit="in" value={inputs.odDp2} onChange={(v) => setField("odDp2", v)} />
        <NumberField label="ID DP 2 (larger)" unit="in" value={inputs.idDp2} onChange={(v) => setField("idDp2", v)} />
      </Section>

      <Section title="Offline cement pill" defaultOpen={false}>
        <NumberField label="Desired ESD" unit="ppge" value={inputs.cementDesiredEsd} onChange={(v) => setField("cementDesiredEsd", v)} />
        <NumberField label="New casing OD" unit="in" value={inputs.newCasingOd} onChange={(v) => setField("newCasingOd", v)} />
        <NumberField label="New casing ID" unit="in" value={inputs.newCasingId} onChange={(v) => setField("newCasingId", v)} />
        <NumberField label="MW" unit="ppg" value={inputs.cementMw} onChange={(v) => setField("cementMw", v)} />
        <NumberField label="TD depth" unit="ft" value={inputs.tdDepth} onChange={(v) => setField("tdDepth", v)} />
      </Section>

      <Section title="Custom swab table" defaultOpen={false}>
        <p className="text-[11px] text-muted-foreground">
          Used when hole size is not 6.75, 7.875, or 8.5 in. Speeds: {TRIP_TABLES.other.map((r) => r[0]).join(" / ")} ft/min.
        </p>
        {TRIP_TABLES.other.map(([speed], i) => (
          <Field key={speed} label={`${speed} ft/min`} unit="ppge">
            <Input
              type="number"
              step="0.01"
              value={inputs.customSwab[i] ?? ""}
              onChange={(e) => {
                const next = [...inputs.customSwab];
                next[i] = Number(e.target.value);
                setField("customSwab", next);
              }}
            />
          </Field>
        ))}
      </Section>

      <div className="px-4 py-3 text-[11px] text-muted-foreground">
        MASP {dPsi(results.masp)} psi · APL {dPsi(results.initialAplAnchor)} psi
      </div>
    </div>
  );
}
