import { useEffect, useMemo, useRef, useState } from "react";
import { Pause, Play, RotateCcw, Scan } from "lucide-react";
import { Button } from "@/components/ui/button";
import { ScheduleSbpChart } from "@/components/schedule-chart";
import type { Rgb, SceneColors, SceneLabel, SceneView, WellScene } from "@/components/well-3d-scene";
import { bbl, dPsi, ft } from "@/components/fmt";
import { buildSchedule } from "@/lib/calc/schedule";
import type { CalcResults, WellInputs } from "@/lib/calc/types";
import { niceTicks } from "@/lib/pill/hydrostatic";
import { placedState } from "@/lib/pill/simulate";
import type { PillModel, WellState } from "@/lib/pill/types";
import {
  PHASE_LABEL,
  flowAt,
  genericLPath,
  liveColumns,
  minutesAt,
  pumpPlan,
  pumpStatus,
  pumpingColumns,
  scheduleAt,
  type Columns,
  type Fluid,
  type Location,
} from "@/lib/pill/well-3d-model";
import { asNum, formatNumber, isNum } from "@/lib/utils";

const SPEEDS = [30, 60, 120, 240] as const;

function cssVar(name: string, fallback: string): string {
  if (typeof window === "undefined") return fallback;
  return getComputedStyle(document.documentElement).getPropertyValue(name).trim() || fallback;
}

/** Any CSS colour to sRGB bytes, via a 1×1 canvas. */
function toRgb(color: string): Rgb {
  const canvas = document.createElement("canvas");
  canvas.width = 1;
  canvas.height = 1;
  const ctx = canvas.getContext("2d", { willReadFrequently: true });
  if (!ctx) return [128, 128, 128];
  ctx.fillStyle = "#808080";
  ctx.fillStyle = color;
  ctx.fillRect(0, 0, 1, 1);
  const [r, g, b] = ctx.getImageData(0, 0, 1, 1).data;
  return [r, g, b];
}

function sceneColors(): SceneColors {
  const pill = cssVar("--color-pill", "#4aa3c4");
  const fluid = cssVar("--color-fluid", "#3d5270");
  return {
    background: cssVar("--color-background", "#0e1116"),
    grid: cssVar("--color-border", "#2a333c"),
    casing: cssVar("--color-muted-foreground", "#93a09a"),
    steel: "#9aa3ab",
    boc: cssVar("--color-primary", "#4d8f8a"),
    fluids: {
      kmw: toRgb(pill),
      base: toRgb(fluid),
      chase: toRgb(fluid),
      fill: toRgb(cssVar("--color-backfill", "#6aa882")),
      air: toRgb("#6b7684"),
      empty: toRgb("#1a2028"),
    },
  };
}

function where(loc: Location): string {
  if (!loc) return "back at surface";
  return `${ft(loc.md)} · ${loc.where === "string" ? "in string" : "annulus"}`;
}

function clock(minutes: number): string {
  const total = Math.max(0, Math.round(minutes));
  return `${Math.floor(total / 60)}:${String(total % 60).padStart(2, "0")} h:m`;
}

function present(columns: Columns): Set<Fluid> {
  return new Set([...columns.string, ...columns.annulus].map((s) => s.fluid));
}

/**
 * The simulator's well diagram in 3D, with a player for the pumping job: KMW down
 * the string, around the bit and up the annulus, then the chase. The end of the
 * playback is the simulator's live state, so Move pipe and Equalize show here too.
 */
export function Well3DView({
  inputs,
  results,
  state,
  model,
  anchorMd,
  casingMd,
  onUnavailable,
}: {
  inputs: WellInputs;
  results: CalcResults;
  state: WellState;
  model: PillModel;
  anchorMd: number | null;
  casingMd: number | null;
  /** Called when WebGL is not available, so the caller can fall back to the 2D section. */
  onUnavailable?: () => void;
}) {
  const placed = useMemo(() => placedState(inputs, results), [inputs, results]);
  const plan = useMemo(() => pumpPlan(placed), [placed]);
  const rows = useMemo(() => buildSchedule(inputs, results).rows, [inputs, results]);
  // Generic L: vertical, a short curve that lands at the anchor / BOC, lateral to TD.
  const bocMd = anchorMd != null && anchorMd > 0 && anchorMd < state.wellDepth ? anchorMd : null;
  const stations = useMemo(() => genericLPath(state.wellDepth, bocMd), [state.wellDepth, bocMd]);
  const casingTvd = isNum(asNum(inputs.casingTvd)) ? asNum(inputs.casingTvd) : null;
  const anchorTvd = isNum(asNum(inputs.anchorTvd)) ? asNum(inputs.anchorTvd) : null;
  const fallbackGpm = isNum(asNum(inputs.initialFlowRate)) ? asNum(inputs.initialFlowRate) : 200;
  const pumpDisp = isNum(asNum(inputs.pumpDisp)) && asNum(inputs.pumpDisp) > 0 ? asNum(inputs.pumpDisp) : null;

  // Playback starts at the end, which is the live simulator state.
  const [pumped, setPumped] = useState(plan.totalBbl);
  const [playing, setPlaying] = useState(false);
  const [speed, setSpeed] = useState<(typeof SPEEDS)[number]>(60);
  const [follow, setFollow] = useState(false);
  const pumpedRef = useRef(pumped);
  pumpedRef.current = pumped;
  const atEnd = pumped >= plan.totalBbl - 1e-6;

  // A new well, or any Move pipe / Equalize action, shows the live state.
  const liveKey = [
    plan.totalBbl.toFixed(3),
    state.pipeDepth.toFixed(2),
    state.pipeEnd,
    state.autoBackfill,
    model.pipeKmwInHole.toFixed(2),
    model.pillTop.toFixed(1),
  ].join("|");
  const lastLive = useRef(liveKey);
  useEffect(() => {
    if (liveKey === lastLive.current) return;
    lastLive.current = liveKey;
    setPlaying(false);
    setPumped(plan.totalBbl);
  }, [liveKey, plan.totalBbl]);

  useEffect(() => {
    if (!playing) return;
    let raf = 0;
    let last = performance.now();
    const tick = (now: number) => {
      const dt = Math.min(0.1, (now - last) / 1000);
      last = now;
      const v = pumpedRef.current;
      const bblPerMin = flowAt(rows, v, fallbackGpm) / 42;
      const next = Math.min(plan.totalBbl, v + (bblPerMin * speed * dt) / 60);
      pumpedRef.current = next;
      setPumped(next);
      if (next >= plan.totalBbl - 1e-6) {
        setPlaying(false);
        return;
      }
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [playing, speed, rows, fallbackGpm, plan.totalBbl]);

  const columns = useMemo(
    () => (atEnd ? liveColumns(state, model) : pumpingColumns(placed, plan, pumped)),
    [atEnd, state, model, placed, plan, pumped],
  );
  const status = pumpStatus(placed, plan, pumped);
  const moved = Math.abs(state.pipeDepth - state.referencePipeDepth) >= 1;
  const phaseLabel = atEnd
    ? moved
      ? state.pipeDepth < state.referencePipeDepth
        ? `Pulled to ${ft(state.pipeDepth)}`
        : `Run in to ${ft(state.pipeDepth)}`
      : PHASE_LABEL.placed
    : PHASE_LABEL[status.phase];

  const annKmw = columns.annulus.find((s) => s.fluid === "kmw");
  const focusMd = atEnd
    ? annKmw
      ? (annKmw.top + annKmw.bottom) / 2
      : null
    : (status.front?.md ?? null);

  const labels = useMemo<SceneLabel[]>(() => {
    const out: SceneLabel[] = [{ id: "surface", md: 0, strong: "Surface", text: "", priority: 6 }];
    const marks = [casingMd, anchorMd, columns.bitMd, state.wellDepth].filter((m): m is number => m != null);
    // On the lateral, labels go under the hole so they clear the BOC label above it.
    const onLateral = (md: number) => bocMd != null && md > bocMd;
    for (const md of niceTicks(0, state.wellDepth, 6)) {
      if (md <= 0 || md >= state.wellDepth) continue;
      if (marks.some((m) => Math.abs(m - md) < state.wellDepth * 0.04)) continue;
      out.push({ id: `tick-${md}`, md, strong: "", text: ft(md), priority: 9, side: onLateral(md) ? -1 : 1 });
    }
    // The drawing is not to scale in TVD, so the real TVD goes in the label.
    const mdTvd = (md: number, tvd: number | null) => `${ft(md)} MD${tvd != null ? ` · ${ft(tvd)} TVD` : ""}`;
    if (casingMd != null && casingMd > 0 && casingMd < state.wellDepth) {
      out.push({ id: "shoe", md: casingMd, strong: "Casing shoe", text: mdTvd(casingMd, casingTvd), priority: 3 });
    }
    if (bocMd != null) {
      out.push({ id: "anchor", md: bocMd, strong: "Anchor / BOC", text: mdTvd(bocMd, anchorTvd), priority: 4 });
    }
    if (columns.bitMd > 0) {
      out.push({
        id: "bit",
        md: columns.bitMd,
        strong: "Bit",
        text: ft(columns.bitMd),
        priority: 2,
        side: onLateral(columns.bitMd) ? -1 : 1,
      });
    }
    out.push({
      id: "td",
      md: state.wellDepth,
      strong: "TD",
      text: `${ft(state.wellDepth)} MD`,
      priority: 5,
      // Under the toe and ending at it, so it stays inside the view.
      ...(bocMd != null ? { side: -1 as const, align: "end" as const } : {}),
    });
    if (focusMd != null) {
      out.push({
        id: "pill",
        md: focusMd,
        strong: "◀ KMW",
        text: atEnd ? `pill ${bbl(annKmw ? model.annularKmwVolume : 0)}` : "front",
        priority: 1,
        tone: "pill",
      });
    }
    return out;
  }, [
    casingMd,
    casingTvd,
    anchorMd,
    anchorTvd,
    bocMd,
    columns.bitMd,
    state.wellDepth,
    focusMd,
    atEnd,
    annKmw,
    model.annularKmwVolume,
  ]);

  const view = useMemo<SceneView>(
    () => ({
      stations,
      wellDepth: state.wellDepth,
      holeId: state.holeId,
      pipeOd: state.pipeOd,
      casingMd: casingMd != null && casingMd > 0 ? casingMd : null,
      bocMd,
      columns,
      labels,
      focusMd,
    }),
    [stations, state.wellDepth, state.holeId, state.pipeOd, casingMd, bocMd, columns, labels, focusMd],
  );

  const canvasRef = useRef<HTMLCanvasElement>(null);
  const labelsRef = useRef<HTMLDivElement>(null);
  const sceneRef = useRef<WellScene | null>(null);
  const [sceneState, setSceneState] = useState<"loading" | "ready" | "failed">("loading");
  useEffect(() => {
    let disposed = false;
    import("@/components/well-3d-scene")
      .then(({ createWellScene }) => {
        if (disposed || !canvasRef.current || !labelsRef.current) return;
        sceneRef.current = createWellScene(canvasRef.current, labelsRef.current, sceneColors());
        setSceneState("ready");
      })
      .catch(() => {
        if (!disposed) setSceneState("failed");
      });
    return () => {
      disposed = true;
      sceneRef.current?.dispose();
      sceneRef.current = null;
    };
  }, []);
  useEffect(() => {
    if (sceneState === "ready") sceneRef.current?.update(view);
  }, [sceneState, view]);
  useEffect(() => {
    if (sceneState === "ready") sceneRef.current?.setFollow(follow);
  }, [sceneState, follow]);
  useEffect(() => {
    if (sceneState === "failed") onUnavailable?.();
  }, [sceneState, onUnavailable]);

  const schedule = scheduleAt(rows, pumped);
  const strokes = pumpDisp ? pumped / pumpDisp : null;
  const fluids = present(columns);
  const sbpText = (sbp: number | "Open Choke" | undefined) =>
    sbp === "Open Choke" ? "open choke" : sbp != null ? `${dPsi(sbp)} psi` : "—";

  function togglePlay() {
    if (playing) {
      setPlaying(false);
      return;
    }
    if (atEnd) setPumped(0);
    setPlaying(true);
  }

  return (
    <div className="grid gap-3">
      <div
        data-well-3d
        className="relative h-[clamp(420px,62vh,720px)] overflow-hidden rounded-lg border border-border bg-background"
      >
        <canvas
          ref={canvasRef}
          className="block h-full w-full touch-none"
          aria-label="3D view of the well along its path, with the string, annulus and KMW pill"
        />
        <div ref={labelsRef} className="pointer-events-none absolute inset-0 overflow-hidden" aria-hidden="true" />
        <div className="pointer-events-none absolute left-3 top-3 flex max-w-[calc(100%-1.5rem)] flex-col items-start gap-1.5">
          <div className="inline-flex items-center gap-2 rounded border border-border bg-card/90 px-2.5 py-1 text-xs font-semibold uppercase tracking-[0.1em] sm:text-sm">
            <i
              className={atEnd ? "size-2.5 rounded-full bg-primary" : "size-2.5 animate-pulse rounded-full bg-pill"}
              aria-hidden="true"
            />
            <span>{phaseLabel}</span>
          </div>
          <div className="flex flex-wrap gap-x-3 gap-y-1 rounded border border-border bg-card/90 px-2.5 py-1 text-[11px] text-muted-foreground">
            <Swatch className="bg-pill" label="KMW" />
            <Swatch className="bg-fluid" label={fluids.has("chase") ? "Well fluid · chase" : "Well fluid"} />
            {fluids.has("fill") ? <Swatch className="bg-backfill" label="Fill" /> : null}
            {fluids.has("air") ? <Swatch className="bg-[#6b7684]" label="Air in DP" /> : null}
            {casingMd != null ? <Swatch className="bg-muted-foreground/60" label="Casing" /> : null}
          </div>
        </div>
        <p className="pointer-events-none absolute bottom-2 right-3 text-[11px] text-muted-foreground">
          Drag to orbit · scroll or pinch to zoom
        </p>
        {sceneState !== "ready" ? (
          <div className="absolute inset-0 grid place-items-center p-6 text-center text-sm text-muted-foreground">
            {sceneState === "loading" ? "Loading 3D view…" : "3D needs WebGL, which this browser has turned off. Showing the section view."}
          </div>
        ) : null}
        <p className="sr-only" aria-live="polite">
          {phaseLabel}
        </p>
      </div>
      <p className="-mt-1 text-[11px] text-pretty text-muted-foreground">
        {bocMd != null
          ? "Schematic L path: vertical, a short curve that lands at the anchor / BOC, then the lateral to TD. Labels show real MD and TVD; the drawing is not to TVD scale."
          : "Schematic vertical path. Enter the anchor / BOC MD to draw the curve and lateral."}
      </p>

      <div className="grid gap-2 rounded-lg border border-border bg-background/40 p-3">
        <div className="flex flex-wrap items-center gap-2">
          <Button size="sm" className="min-w-28" onClick={togglePlay} data-play>
            {playing ? <Pause className="size-4" /> : <Play className="size-4" />}
            {playing ? "Pause" : atEnd ? "Play procedure" : "Play"}
          </Button>
          <Button
            size="sm"
            variant="secondary"
            onClick={() => {
              setPlaying(false);
              setPumped(0);
            }}
          >
            <RotateCcw className="size-4" />
            Start
          </Button>
          <select
            value={speed}
            onChange={(e) => setSpeed(Number(e.target.value) as (typeof SPEEDS)[number])}
            aria-label="Playback speed"
            className="h-9 rounded-md border border-input bg-background px-2 text-sm"
          >
            {SPEEDS.map((s) => (
              <option key={s} value={s}>
                {s}× speed
              </option>
            ))}
          </select>
          <label className="inline-flex min-h-9 items-center gap-2 text-sm">
            <input
              type="checkbox"
              checked={follow}
              onChange={(e) => setFollow(e.target.checked)}
              className="size-4 accent-[var(--color-primary)]"
            />
            Follow pill
          </label>
          <Button size="sm" variant="ghost" className="ml-auto" onClick={() => sceneRef.current?.resetView()}>
            <Scan className="size-4" />
            Fit well
          </Button>
        </div>
        <input
          type="range"
          min={0}
          max={Math.max(plan.totalBbl, 0.5)}
          step={0.5}
          value={Math.min(pumped, plan.totalBbl)}
          onChange={(e) => {
            setPlaying(false);
            setPumped(Number(e.target.value));
          }}
          aria-label="Volume pumped"
          className="w-full accent-[var(--color-pill)]"
        />
        <div className="flex flex-wrap justify-between gap-x-4 font-mono text-xs text-muted-foreground tabular-nums">
          <span>
            {formatNumber(pumped, 1)} / {formatNumber(plan.totalBbl, 1)} bbl
          </span>
          {strokes != null ? <span>{formatNumber(strokes, 0)} stk</span> : null}
          <span>{clock(minutesAt(rows, pumped, fallbackGpm))}</span>
        </div>
      </div>

      <dl className="grid grid-cols-1 gap-x-4 gap-y-1.5 rounded-lg border border-border bg-background/40 p-3 text-xs sm:grid-cols-2">
        {atEnd ? (
          <>
            <Readout label="Annular pill" value={annKmw ? `${ft(annKmw.top)}–${ft(annKmw.bottom)}` : "—"} />
            <Readout label="KMW in string" value={bbl(model.pipeKmwInHole)} />
          </>
        ) : (
          <>
            <Readout label="KMW front" value={status.front ? where(status.front) : "—"} />
            <Readout
              label="KMW tail"
              value={pumped < plan.kmwBbl ? "still going in at surface" : where(status.tail)}
            />
          </>
        )}
        <Readout
          label="Schedule"
          value={
            schedule.held
              ? `Step ${schedule.held.step} · ${sbpText(schedule.held.sbp)} · ${formatNumber(schedule.held.flow, 0)} gpm`
              : "—"
          }
        />
        <Readout
          label="Next step"
          value={
            schedule.next
              ? `Step ${schedule.next.step} at ${formatNumber(schedule.next.volume, 0)} bbl → ${sbpText(schedule.next.sbp)}`
              : "End of schedule"
          }
        />
        {schedule.held?.activityNotes ? (
          <p className="text-muted-foreground sm:col-span-2">{schedule.held.activityNotes}</p>
        ) : null}
      </dl>

      {rows.length && strokes != null ? (
        <ScheduleSbpChart rows={rows} marker={strokes} bare title="Schedule · SBP vs pump strokes" />
      ) : null}
    </div>
  );
}

function Swatch({ className, label }: { className: string; label: string }) {
  return (
    <span className="inline-flex items-center gap-1.5">
      <i className={`size-2.5 rounded-sm ${className}`} aria-hidden="true" />
      {label}
    </span>
  );
}

function Readout({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-baseline justify-between gap-3">
      <dt className="text-muted-foreground">{label}</dt>
      <dd className="text-right font-mono tabular-nums text-foreground">{value}</dd>
    </div>
  );
}
