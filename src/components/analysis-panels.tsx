import type { ReactNode } from "react";
import { bbl, ft, ppg, ppg2, psi } from "@/components/fmt";
import { emwAt, hydrostaticLayers, pressureAt, tvdFn } from "@/lib/pill/hydrostatic";
import { volumeBelowDepth, volumeBetweenMd } from "@/lib/pill/physics";
import { capBblFt } from "@/lib/utils";
import type { PillModel, WellState } from "@/lib/pill/types";

function Panel({
  title,
  children,
}: {
  title: string;
  children: ReactNode;
}) {
  return (
    <section className="rounded-lg border border-border bg-card p-4">
      <h2 className="mb-3 text-sm font-medium tracking-wide text-foreground">{title}</h2>
      {children}
    </section>
  );
}

function Row({
  label,
  detail,
  value,
}: {
  label: string;
  /** Geometry or basis behind the number, shown under the label. */
  detail?: string;
  value: string;
}) {
  return (
    <div className="flex items-baseline justify-between gap-3 border-b border-border py-2 last:border-b-0">
      <span className="min-w-0 text-xs text-muted-foreground">
        {label}
        {detail ? <span className="block text-[11px] text-muted-foreground/70">{detail}</span> : null}
      </span>
      <span className="shrink-0 font-mono text-xs tabular-nums text-foreground">{value}</span>
    </div>
  );
}

const inch = (d: number) => `${Number(d.toFixed(3))} in`;

export function AnalysisPanels({
  state,
  model,
  anchorMd = null,
}: {
  state: WellState;
  model: PillModel;
  anchorMd?: number | null;
}) {
  const layers = hydrostaticLayers(state, model);
  const toTvd = tvdFn(state);
  const volumeBelowPipe = volumeBelowDepth(state, state.pipeDepth, state.pipeDepth);
  // Casing annulus down to the shoe, open-hole annulus below it, to the bit.
  const annulusToPipe = volumeBetweenMd(state, 0, state.pipeDepth, state.pipeDepth);
  const openHoleId = state.openHoleId ?? 0;
  const hasOpenHole = openHoleId > 0 && (state.casingMd ?? 0) > 0;
  // Depth order, with the casing shoe (FIT check) and anchor (target) when they are entered.
  const points = [
    { label: "Surface", depth: 0 },
    { label: "Pill top", depth: model.pillTop },
    { label: "Pill bottom", depth: model.pillBottom },
    { label: "Bit", depth: state.pipeDepth },
    ...((state.casingMd ?? 0) > 0 && (state.casingMd ?? 0) < state.wellDepth
      ? [{ label: "Casing shoe", depth: state.casingMd ?? 0 }]
      : []),
    ...(anchorMd != null && anchorMd > 0 && anchorMd < state.wellDepth
      ? [{ label: "Anchor", depth: anchorMd }]
      : []),
    { label: "TD", depth: state.wellDepth },
  ].sort((a, b) => a.depth - b.depth);
  const tdEmw = emwAt(state.wellDepth, layers, toTvd, state.baseMw);

  return (
    <div className="grid gap-3 lg:grid-cols-2">
      <Panel title="Volume balance">
        <Row
          label="Annular capacity"
          detail={`${inch(state.holeId)} × ${inch(state.pipeOd)} pipe`}
          value={`${model.annularBblFt.toFixed(4)} bbl/ft`}
        />
        <Row
          label="Pipe displacement"
          detail={state.pipeEnd === "closed" ? "Closed end (float)" : "Open end, steel only"}
          value={`${model.pipeBblFt.toFixed(4)} bbl/ft`}
        />
        <Row
          label={hasOpenHole ? "Casing capacity" : "Hole capacity"}
          detail={`${inch(state.holeId)}, no pipe`}
          value={`${model.openHoleBblFt.toFixed(4)} bbl/ft`}
        />
        {hasOpenHole ? (
          <Row
            label="Open hole capacity"
            detail={`${inch(openHoleId)}, no pipe`}
            value={`${capBblFt(openHoleId).toFixed(4)} bbl/ft`}
          />
        ) : null}
        <Row label="Annulus, surface to bit" value={bbl(annulusToPipe)} />
        <Row label="Hole below bit" value={bbl(volumeBelowPipe)} />
        <Row label="Placed annular pill" value={bbl(model.annularKmwVolume)} />
        {model.kmwBackfillRequired > 0.5 ? (
          <Row
            label="KMW backfill POOH"
            value={`${bbl(model.kmwBackfillApplied)} of ${bbl(model.kmwBackfillRequired)}`}
          />
        ) : null}
        <Row label="KMW remaining in string" value={bbl(model.pipeKmwInHole)} />
        <Row
          label="Total KMW after pumping"
          value={bbl(state.pillVolume + model.pipeKmwInHole)}
        />
        <Row
          label={model.pipeDelta > 0 ? "Trip tank gain" : "Trip tank fill"}
          value={bbl(model.pipeDelta > 0 ? model.tripTankGain : model.backfillVolume)}
        />
        <Row label="Fill zone (contiguous)" value={bbl(model.fillZoneVolume)} />
        {state.pipeEnd === "open" ? (
          <Row label="Pipe-bore contribution" value={bbl(model.pipeFluidVolume)} />
        ) : null}
        <Row
          label="POOH 1,000 ft fill"
          value={bbl(model.pipeBblFt * 1000)}
        />
      </Panel>
      <Panel title="Hydrostatic snapshot">
        {points.map((point) => (
          <Row
            key={point.label}
            label={`${point.label} · ${ft(point.depth)}`}
            value={`${psi(pressureAt(point.depth, layers, toTvd, state.baseMw))} · ${ppg2(emwAt(point.depth, layers, toTvd, state.baseMw))}`}
          />
        ))}
        <Row label="Bottomhole EMW" value={ppg2(tdEmw)} />
        <div className="mt-3 grid gap-1.5">
          {layers.map((layer) => (
            <div
              key={`${layer.name}-${layer.top}`}
              className="flex items-baseline justify-between gap-3 text-xs"
            >
              <span className="text-muted-foreground">
                {ft(layer.top)}–{ft(layer.bottom)} · {layer.name}
              </span>
              <span className="font-mono tabular-nums text-muted-foreground">{ppg(layer.mw)}</span>
            </div>
          ))}
        </div>
      </Panel>
    </div>
  );
}
