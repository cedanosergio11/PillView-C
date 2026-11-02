import { bbl, ft, ppg2, psi, signedFt } from "@/components/fmt";
import { emwAt, hydrostaticLayers, pressureAt, tvdFn } from "@/lib/pill/hydrostatic";
import type { PillModel, WellState } from "@/lib/pill/types";

type Props = {
  state: WellState;
  model: PillModel;
  equalized?: boolean;
  anchorMd?: number | null;
};

function Stat({
  label,
  value,
  detail,
}: {
  label: string;
  value: string;
  detail: string;
}) {
  return (
    <div className="min-w-0 rounded-lg border border-border bg-card px-3 py-3 sm:px-4">
      <div className="text-xs font-medium tracking-wide text-muted-foreground">{label}</div>
      <div className="mt-1 font-mono text-lg font-medium tracking-tight text-foreground tabular-nums sm:text-xl">
        {value}
      </div>
      <div className="mt-1 line-clamp-2 text-xs text-pretty text-muted-foreground sm:truncate">{detail}</div>
    </div>
  );
}

export function StatsStrip({ state, model, equalized = false, anchorMd = null }: Props) {
  const tripDetail =
    model.pipeDelta > 0
      ? `Run in · trip tank gain ${model.tripTankGain.toFixed(1)} bbl`
      : model.pipeDelta < 0
        ? `Pulled · trip tank fill ${model.backfillVolume.toFixed(1)} bbl`
        : "At placement depth";

  const layers = hydrostaticLayers(state, model);
  const toTvd = tvdFn(state);
  const hasAnchor = anchorMd != null && Number.isFinite(anchorMd) && anchorMd > 0;
  const emwDepth = hasAnchor ? anchorMd : state.wellDepth;
  const anchorEmw = emwAt(emwDepth, layers, toTvd, state.baseMw);
  const anchorPsi = pressureAt(emwDepth, layers, toTvd, state.baseMw);

  return (
    <div className="grid grid-cols-2 gap-2 sm:gap-3 xl:grid-cols-4">
      <Stat
        label="Annular pill"
        value={bbl(model.annularKmwVolume)}
        detail={`${ft(model.pillTop).replace(" ft", "")}–${ft(model.pillBottom)}`}
      />
      <Stat
        label="KMW in string"
        value={bbl(model.pipeKmwInHole)}
        detail={
          model.pipeKmwInHole > 0.05
            ? model.pipeChaseInHole > 0.05
              ? `Chase ${bbl(model.pipeChaseInHole)} on KMW to bit`
              : model.pipeKmwTop > 80
                ? `Air to ${ft(model.pipeKmwTop)} · KMW to bit`
                : `Float holding from ${ft(model.pipeKmwTop)} to bit`
            : "String displaced / empty of KMW"
        }
      />
      <Stat
        label="Pipe movement"
        value={signedFt(model.pipeDelta)}
        detail={tripDetail}
      />
      <Stat
        label={hasAnchor ? "Anchor point EMW" : "TD EMW"}
        value={ppg2(anchorEmw)}
        detail={`${psi(anchorPsi)} at ${ft(emwDepth)}`}
      />
    </div>
  );
}
