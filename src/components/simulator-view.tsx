import { useEffect, useMemo, useState } from "react";
import { AnalysisPanels } from "@/components/analysis-panels";
import { EmwProfile } from "@/components/emw-profile";
import { SimPlacePanel, SimToolbar } from "@/components/sim-controls";
import { StatsStrip } from "@/components/stats-strip";
import { DP_AIR_MIN_FT, WellboreSchematic, dpAirBottomFt } from "@/components/wellbore-schematic";
import type { CalcResults, WellInputs } from "@/lib/calc/types";
import { simulate } from "@/lib/pill/simulate";
import { useSimulator, wellFromStores } from "@/lib/pill/store";
import { bbl, ft } from "@/components/fmt";
import { asNum, formatNumber, isNum } from "@/lib/utils";
import { dBbl } from "@/components/fmt";
import { DepthBlockPanel } from "@/components/depth-block";
import { Button } from "@/components/ui/button";
import { toast } from "sonner";
import { missingForSimulator } from "@/lib/calc/required";
import { PRESETS } from "@/lib/calc/examples";
import { presentPresets } from "@/lib/present-presets";
import { useAppStore } from "@/lib/store";

export function SimulatorView({
  inputs,
  results,
  onOpenInputs,
}: {
  inputs: WellInputs;
  results: CalcResults;
  /** Opens the inputs drawer on screens where the inputs panel is hidden. */
  onOpenInputs?: () => void;
}) {
  const sim = useSimulator();
  const state = wellFromStores(inputs, sim);
  const run = useMemo(
    () => simulate(inputs, results, [state.pipeDepth], state),
    [
      inputs,
      results,
      state.wellDepth,
      state.holeId,
      state.pipeOd,
      state.pipeId,
      state.pipeEnd,
      state.pipeDepth,
      state.referencePipeDepth,
      state.placedPillTop,
      state.placedPillBottom,
      state.pillVolume,
      state.pillMw,
      state.autoBackfill,
      state.baseMw,
      state.pipeKmwVolume,
      state.pipeChaseVolume,
      state.kmwBackfillRequired,
      state.stringDrainedOnPull,
      state.casingMd,
      state.openHoleId,
      state.survey,
    ],
  );
  const [probeDepth, setProbeDepth] = useState<number | null>(null);

  useEffect(() => {
    useSimulator.getState().syncFromCalc(inputs, results);
  }, [inputs, results]);

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      const target = event.target as HTMLElement | null;
      if (
        target &&
        (target.tagName === "INPUT" ||
          target.tagName === "TEXTAREA" ||
          target.tagName === "SELECT")
      ) {
        return;
      }
      if (event.key === "ArrowUp") {
        event.preventDefault();
        useSimulator.getState().bumpPipe(event.shiftKey ? -500 : -100, state);
      } else if (event.key === "ArrowDown") {
        event.preventDefault();
        useSimulator.getState().bumpPipe(event.shiftKey ? 500 : 100, state);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [state.wellDepth]);

  // Without these the simulator would draw a default well, so say what is missing instead.
  const missing = missingForSimulator(inputs);
  if (missing.length) {
    return <SimulatorEmpty missing={missing} onOpenInputs={onOpenInputs} />;
  }

  if (!run.ok) {
    return (
      <DepthBlockPanel
        fields={run.fields}
        title="Simulator is blocked — no numbers shown"
        note="simulate() refused: a depth is past TD or below the bit. Fix it on the inputs to run the simulator."
      />
    );
  }
  const model = run.models[0];

  const programTop = isNum(results.topOfPillNoDp) ? results.topOfPillNoDp : null;
  const programBottom = isNum(asNum(inputs.spotMd)) ? asNum(inputs.spotMd) : null;
  const fit = asNum(inputs.fit);
  const desiredEmw = asNum(inputs.desiredEmw);
  const casingMd = isNum(asNum(inputs.casingMd)) ? asNum(inputs.casingMd) : null;
  const anchorMd = isNum(asNum(inputs.anchorMd)) ? asNum(inputs.anchorMd) : null;
  const anchorTvd = isNum(asNum(inputs.anchorTvd)) ? asNum(inputs.anchorTvd) : null;

  return (
    <div className="grid gap-4">
      {isNum(results.bblBackfill) && results.bblBackfill > 0 ? (
        <div className="rounded-xl border border-destructive/40 bg-destructive/10 px-4 py-3 text-sm">
          <p className="font-semibold text-destructive">
            KMW backfill while POOH: {dBbl(results.bblBackfill)} bbl
            {model.kmwBackfillApplied > 0.05
              ? ` · applied ${dBbl(model.kmwBackfillApplied)} bbl`
              : ""}
          </p>
          <p className="mt-1 text-pretty text-muted-foreground">
            {dBbl(results.totalPillVol)} bbl of {isNum(desiredEmw) ? `${desiredEmw} ppge` : "target"} KMW
            is needed at the anchor. Only {dBbl(results.spottedKmwVol)} bbl fits with pipe in the hole.
            With Trip Tank On, the first {dBbl(results.bblBackfill)} bbl of hole fill while pulling is KMW
            (pill grows); then switch to active mud.
          </p>
        </div>
      ) : null}
      <StatsStrip state={state} model={model} equalized={sim.equalized} anchorMd={anchorMd} />
      <SimToolbar state={state} model={model} inputs={inputs} results={results} />
      <div className="grid min-w-0 items-start gap-4 sm:grid-cols-2">
        <div className="min-w-0 overflow-x-auto rounded-xl border border-border bg-card p-3 sm:p-4">
          <div className="mb-2 flex min-h-11 flex-wrap items-center justify-between gap-2">
            <h2 className="text-sm font-medium tracking-wide text-foreground">Wellbore</h2>
            <span className="text-xs text-muted-foreground">
              {state.pipeEnd === "closed" ? "Float · pump down only" : "Open-end pipe"}
            </span>
          </div>
          <WellboreSchematic
            state={state}
            model={model}
            probeDepth={probeDepth}
            onProbeDepth={setProbeDepth}
            programTop={programTop}
            programBottom={programBottom}
            anchorMd={anchorMd}
            casingMd={casingMd}
          />
          <div className="mt-3 flex flex-wrap justify-center gap-4 text-xs text-muted-foreground">
            <LegendSwatch className="bg-pill" label="KMW pill" />
            <LegendSwatch className="bg-pipe" label="Pipe" />
            {model.pipeChaseInHole > 0.05 ? (
              <LegendSwatch className="bg-fluid" label="Chase in DP" />
            ) : null}
            {dpAirBottomFt(model, state.pipeDepth) > DP_AIR_MIN_FT ? (
              <LegendSwatch className="bg-card" label="Air in DP" />
            ) : null}
            <LegendSwatch className="bg-backfill" label="Fill above pill" />
            <LegendSwatch className="bg-fluid" label="Base well fluid" />
            {casingMd != null ? <LegendSwatch className="bg-muted-foreground" label="Casing" /> : null}
            {anchorMd != null ? <LegendSwatch className="bg-primary" label="Anchor" /> : null}
          </div>
          <p className="mt-3 text-center text-xs text-pretty text-muted-foreground">
            {sim.equalized
              ? model.pipeChaseInHole > 0.05
                ? "Equalized: chase stays on the leftover KMW. Extra string KMW dumps around the bit until DP and annulus pressures match."
                : "After U-tube: leftover string KMW turns the bit and goes up the annulus. Air at 14.7 psi sits on the remaining KMW — nothing comes back into the DP."
              : model.pipeChaseInHole > 0.05
                ? "As pumped: chase of base fluid sits on the KMW in the drill string."
                : "As pumped: float holds leftover KMW in the pipe. The annular pill uses annular capacity, so its top matches the no-DP program top."}{" "}
            Not for operational decisions.
          </p>
        </div>
        <EmwProfile
          state={state}
          model={model}
          probeDepth={probeDepth}
          onProbeDepth={setProbeDepth}
          fit={isNum(fit) ? fit : null}
          desiredEmw={isNum(desiredEmw) ? desiredEmw : null}
          anchorMd={anchorMd}
          anchorTvd={anchorTvd}
          casingMd={casingMd}
        />
      </div>
      <div className="grid items-start gap-4 lg:grid-cols-[minmax(0,22rem)_1fr]">
        <SimPlacePanel state={state} />
        <AnalysisPanels state={state} model={model} anchorMd={anchorMd} />
      </div>
      {programTop != null ? (
        <p className="text-xs text-muted-foreground">
          Procedure top (no DP): {ft(programTop)} ·{" "}
          {sim.equalized ? "Equalized (air cap):" : "Annular top (as pumped):"}{" "}
          {ft(model.pillTop)} · Annulus {bbl(model.annularKmwVolume)} · String{" "}
          {bbl(model.pipeKmwInHole)}
          {isNum(results.totalPillVol) ? ` · Mixed ${bbl(results.totalPillVol)}` : ""}
        </p>
      ) : null}
      <p className="sr-only" aria-live="polite">
        Pipe at {ft(state.pipeDepth)}. Pill from {ft(model.pillTop)} to{" "}
        {ft(model.pillBottom)}.{" "}
        {model.pipeDelta > 0
          ? `Trip tank gain ${bbl(model.tripTankGain)}.`
          : `Trip tank fill ${bbl(model.backfillVolume)}.`}
      </p>
    </div>
  );
}

const EXAMPLE_PRESET = presentPresets(PRESETS).find((p) => p.id === "example-1");

function SimulatorEmpty({
  missing,
  onOpenInputs,
}: {
  missing: string[];
  onOpenInputs?: () => void;
}) {
  return (
    <section
      data-simulator-empty
      className="grid items-center gap-6 rounded-xl border border-border bg-card p-5 sm:grid-cols-[auto_minmax(0,1fr)] sm:p-8"
    >
      <EmptyWellGlyph className="mx-auto hidden h-44 w-28 sm:block" />
      <div className="min-w-0">
        <h2 className="text-lg font-semibold tracking-tight text-balance">No well to simulate yet</h2>
        <p className="mt-1 max-w-prose text-sm text-pretty text-muted-foreground">
          The simulator places the pill from your inputs. Enter these values, paste them from
          the Excel sheet, or load a workbook example.
        </p>
        <ul className="mt-4 flex flex-wrap gap-1.5" aria-label="Missing inputs">
          {missing.map((label) => (
            <li
              key={label}
              className="rounded-full border border-warn/40 bg-warn/10 px-2.5 py-1 text-xs text-warn"
            >
              {label}
            </li>
          ))}
        </ul>
        <div className="mt-5 flex flex-wrap gap-2">
          {EXAMPLE_PRESET ? (
            <Button
              onClick={() => {
                useAppStore.getState().loadPreset(EXAMPLE_PRESET.inputs);
                toast.success(`Loaded ${EXAMPLE_PRESET.label}`);
              }}
            >
              Load EXAMPLE 1
            </Button>
          ) : null}
          {onOpenInputs ? (
            <Button variant="secondary" className="lg:hidden" onClick={onOpenInputs}>
              Open inputs
            </Button>
          ) : null}
        </div>
        <p className="mt-3 text-xs text-muted-foreground">
          The other workbook examples are under Load well.
        </p>
      </div>
    </section>
  );
}

/** An empty hole with the pipe pulled: formation on both sides, no fluid column drawn. */
function EmptyWellGlyph({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 112 176" className={className} aria-hidden="true">
      <rect x="0" y="12" width="30" height="164" className="fill-formation" />
      <rect x="82" y="12" width="30" height="164" className="fill-formation" />
      <rect x="30" y="12" width="52" height="164" className="fill-fluid/25" />
      <rect x="30" y="12" width="4" height="96" className="fill-muted-foreground/50" />
      <rect x="78" y="12" width="4" height="96" className="fill-muted-foreground/50" />
      <line x1="0" x2="112" y1="12" y2="12" className="stroke-foreground" strokeWidth="2" />
      <path
        d="M47 30 v86 M65 30 v86"
        className="stroke-pipe/60"
        strokeWidth="2"
        strokeDasharray="4 5"
        fill="none"
      />
    </svg>
  );
}

function LegendSwatch({
  className,
  label,
}: {
  className: string;
  label: string;
}) {
  return (
    <span className="inline-flex items-center gap-2">
      <span className={`size-2.5 rounded-sm ${className}`} />
      {label}
    </span>
  );
}
