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

export function SimulatorView({
  inputs,
  results,
}: {
  inputs: WellInputs;
  results: CalcResults;
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
        <AnalysisPanels state={state} model={model} />
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
