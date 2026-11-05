import {
  Color,
  ConeGeometry,
  Curve,
  DataTexture,
  DirectionalLight,
  DoubleSide,
  GridHelper,
  HemisphereLight,
  LinearFilter,
  Mesh,
  MeshStandardMaterial,
  PerspectiveCamera,
  Quaternion,
  RGBAFormat,
  Scene,
  SphereGeometry,
  SRGBColorSpace,
  TorusGeometry,
  TubeGeometry,
  Vector3,
  WebGLRenderer,
  type BufferGeometry,
} from "three";
import { OrbitControls } from "three/examples/jsm/controls/OrbitControls.js";
import {
  directionAtMd,
  pointAtMd,
  type Columns,
  type Fluid,
  type PathStation,
  type Segment,
} from "@/lib/pill/well-3d-model";

/*
 * Three.js scene for the 3D well view, in the style of the Wellbore Pill Tracker
 * prototype: tubes along the well path for the string, the annulus and the casing,
 * a shoe ring and a bit, fluids painted along each tube by depth, and HTML labels
 * that follow the view. Radii are exaggerated against depth so the fluids show.
 */

const S = 1 / 100; // scene units per ft
const TEX = 1024; // texels along each tube

export type Rgb = [number, number, number];
export type SceneColors = {
  background: string;
  grid: string;
  casing: string;
  steel: string;
  /** Anchor / BOC marker. */
  boc: string;
  fluids: Record<Fluid, Rgb>;
};

export type SceneLabel = {
  id: string;
  md: number;
  strong: string;
  text: string;
  /** Lower draws first and wins when labels would overlap. */
  priority: number;
  tone?: "pill" | "muted";
  /** Which side of the hole: 1 is right of travel (above a lateral), -1 the other side. */
  side?: 1 | -1;
  /** "end" puts the text before the point instead of after it. */
  align?: "start" | "end";
};

export type SceneView = {
  stations: PathStation[];
  wellDepth: number;
  holeId: number;
  pipeOd: number;
  casingMd: number | null;
  /** Anchor / BOC: the point where the curve lands, marked with a dot. */
  bocMd: number | null;
  columns: Columns;
  labels: SceneLabel[];
  /** Depth the camera tracks when following the pill. */
  focusMd: number | null;
};

export type WellScene = {
  update(view: SceneView): void;
  resetView(): void;
  setFollow(on: boolean): void;
  dispose(): void;
};

/** Path between two measured depths, parametrised uniformly in MD so texture u is depth. */
class PathCurve extends Curve<Vector3> {
  constructor(
    private readonly stations: PathStation[],
    private readonly md0: number,
    private readonly md1: number,
  ) {
    super();
  }
  override getPoint(t: number, target = new Vector3()): Vector3 {
    const p = pointAtMd(this.stations, this.md0 + (this.md1 - this.md0) * t);
    return target.set(p.x * S, -p.tvd * S, 0);
  }
  override getPointAt(u: number, target?: Vector3): Vector3 {
    return this.getPoint(u, target);
  }
  override getTangentAt(u: number, target?: Vector3): Vector3 {
    return this.getTangent(u, target);
  }
}

function makeTexture(): DataTexture {
  const tex = new DataTexture(new Uint8Array(TEX * 4), TEX, 1, RGBAFormat);
  tex.magFilter = LinearFilter;
  tex.minFilter = LinearFilter;
  tex.colorSpace = SRGBColorSpace;
  tex.needsUpdate = true;
  return tex;
}

function paintTexture(tex: DataTexture, segments: Segment[], md0: number, md1: number, colors: SceneColors) {
  const data = tex.image.data as Uint8Array;
  let j = 0;
  for (let i = 0; i < TEX; i += 1) {
    const md = md0 + ((i + 0.5) / TEX) * (md1 - md0);
    while (j < segments.length - 1 && md > segments[j].bottom) j += 1;
    const [r, g, b] = colors.fluids[segments[j]?.fluid ?? "base"];
    data[i * 4] = r;
    data[i * 4 + 1] = g;
    data[i * 4 + 2] = b;
    data[i * 4 + 3] = 255;
  }
  tex.needsUpdate = true;
}

function pointVec(stations: PathStation[], md: number, target = new Vector3()) {
  const p = pointAtMd(stations, md);
  return target.set(p.x * S, -p.tvd * S, 0);
}

function downhole(stations: PathStation[], md: number) {
  const d = directionAtMd(stations, md);
  return new Vector3(d.dx, -d.dTvd, 0).normalize();
}

export function createWellScene(
  canvas: HTMLCanvasElement,
  labelLayer: HTMLElement,
  colors: SceneColors,
): WellScene {
  const renderer = new WebGLRenderer({ canvas, antialias: true });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
  renderer.outputColorSpace = SRGBColorSpace;

  const scene = new Scene();
  scene.background = new Color().setStyle(colors.background);
  const camera = new PerspectiveCamera(38, 1, 0.1, 5000);
  const controls = new OrbitControls(camera, canvas);
  controls.enableDamping = true;
  controls.dampingFactor = 0.08;

  scene.add(new HemisphereLight(0xffffff, 0x445566, 0.9));
  const sun = new DirectionalLight(0xffffff, 1.4);
  sun.position.set(40, 30, 60);
  scene.add(sun);

  const texAnn = makeTexture();
  const texStr = makeTexture();
  const annMat = new MeshStandardMaterial({
    map: texAnn,
    roughness: 0.45,
    transparent: true,
    opacity: 0.45,
    depthWrite: false,
    side: DoubleSide,
  });
  const strMat = new MeshStandardMaterial({ map: texStr, roughness: 0.55, metalness: 0.1 });
  const csgMat = new MeshStandardMaterial({
    color: new Color().setStyle(colors.casing),
    roughness: 0.3,
    metalness: 0.4,
    transparent: true,
    opacity: 0.22,
    depthWrite: false,
    side: DoubleSide,
  });
  const steelMat = new MeshStandardMaterial({
    color: new Color().setStyle(colors.steel),
    metalness: 0.6,
    roughness: 0.35,
  });

  const bocMat = new MeshStandardMaterial({
    color: new Color().setStyle(colors.boc),
    emissive: new Color().setStyle(colors.boc),
    emissiveIntensity: 0.35,
    roughness: 0.4,
  });

  const annMesh = new Mesh(undefined, annMat);
  const strMesh = new Mesh(undefined, strMat);
  const csgMesh = new Mesh(undefined, csgMat);
  const shoeMesh = new Mesh(undefined, steelMat);
  const bitMesh = new Mesh(undefined, steelMat);
  const bocMesh = new Mesh(undefined, bocMat);
  strMesh.renderOrder = 0;
  csgMesh.renderOrder = 1;
  annMesh.renderOrder = 2;
  bocMesh.renderOrder = 3;
  scene.add(strMesh, csgMesh, annMesh, shoeMesh, bitMesh, bocMesh);
  let grid: GridHelper | null = null;

  let view: SceneView | null = null;
  let wellKey = "";
  let stringKey = "";
  let rHole = 1;
  let rPipe = 0.45;
  let rCsg = 1.2;
  const center = new Vector3();
  let fitDistance = 100;
  let follow = false;
  let needsRender = true;
  let frame = 0;

  const labelEls = new Map<string, HTMLElement>();
  const labelSize = new Map<string, { w: number; h: number }>();

  function setGeometry(mesh: Mesh, geometry: BufferGeometry | null) {
    const old = mesh.geometry as BufferGeometry | undefined;
    if (geometry) mesh.geometry = geometry;
    mesh.visible = Boolean(geometry);
    if (old && old !== geometry) old.dispose();
  }

  function buildWell(v: SceneView) {
    const maxTvd = Math.max(...v.stations.map((s) => s.tvd), 1);
    const maxX = Math.max(...v.stations.map((s) => s.x), 0);
    const extent = Math.max(maxTvd, maxX, 2000);
    // ~1.2% of the well's extent: exaggerated so the fluids read at full-well zoom.
    rHole = extent * S * 0.012;
    rPipe = rHole * Math.min(0.6, Math.max(0.3, (v.pipeOd / Math.max(v.holeId, 0.1)) * 0.8));
    rCsg = rHole * 1.2;

    const segments = Math.min(1600, Math.max(400, Math.round(v.wellDepth / 25)));
    setGeometry(annMesh, new TubeGeometry(new PathCurve(v.stations, 0, v.wellDepth), segments, rHole, 32, false));

    const shoe = v.casingMd != null && v.casingMd > 0 ? Math.min(v.casingMd, v.wellDepth) : null;
    if (shoe != null) {
      const csgSeg = Math.max(120, Math.round((segments * shoe) / v.wellDepth));
      setGeometry(csgMesh, new TubeGeometry(new PathCurve(v.stations, 0, shoe), csgSeg, rCsg, 32, false));
      setGeometry(shoeMesh, new TorusGeometry(rCsg, rCsg * 0.1, 10, 40));
      pointVec(v.stations, shoe, shoeMesh.position);
      // Torus lies in its XY plane; turn its axis to run along the hole.
      shoeMesh.quaternion.copy(new Quaternion().setFromUnitVectors(new Vector3(0, 0, 1), downhole(v.stations, shoe)));
    } else {
      setGeometry(csgMesh, null);
      setGeometry(shoeMesh, null);
    }

    if (v.bocMd != null && v.bocMd > 0 && v.bocMd < v.wellDepth) {
      setGeometry(bocMesh, new SphereGeometry(rHole * 0.7, 20, 14));
      pointVec(v.stations, v.bocMd, bocMesh.position);
    } else {
      setGeometry(bocMesh, null);
    }

    if (grid) {
      scene.remove(grid);
      grid.geometry.dispose();
      (Array.isArray(grid.material) ? grid.material : [grid.material]).forEach((m) => m.dispose());
    }
    const gridSize = Math.max(maxTvd * 0.5, maxX * 1.3, 4000) * S;
    grid = new GridHelper(gridSize, 14, new Color().setStyle(colors.grid), new Color().setStyle(colors.grid));
    grid.position.set((maxX * S) / 2, 0, 0);
    const gm = Array.isArray(grid.material) ? grid.material : [grid.material];
    gm.forEach((m) => {
      m.transparent = true;
      m.opacity = 0.7;
    });
    scene.add(grid);

    // Aim a little below the middle so the lateral and its labels have room at the bottom.
    center.set((maxX * S) / 2, -maxTvd * S * 0.54, 0);
    fitCamera(maxTvd * S, maxX * S);
    stringKey = "";
  }

  function buildString(v: SceneView) {
    const bit = v.columns.bitMd;
    if (bit < 1) {
      setGeometry(strMesh, null);
      setGeometry(bitMesh, null);
      return;
    }
    const segments = Math.min(1200, Math.max(200, Math.round(bit / 30)));
    setGeometry(strMesh, new TubeGeometry(new PathCurve(v.stations, 0, bit), segments, rPipe, 20, false));
    const len = rPipe * 3.2;
    setGeometry(bitMesh, new ConeGeometry(rPipe * 1.5, len, 18));
    const dir = downhole(v.stations, bit);
    // Cone points along +Y; turn the apex downhole and sit it just past the string.
    bitMesh.quaternion.copy(new Quaternion().setFromUnitVectors(new Vector3(0, -1, 0), dir));
    pointVec(v.stations, bit, bitMesh.position).addScaledVector(dir, len / 2);
  }

  function fitCamera(height: number, width: number) {
    const rect = canvas.getBoundingClientRect();
    const aspect = rect.width > 0 && rect.height > 0 ? rect.width / rect.height : 1;
    const f = Math.tan((camera.fov * Math.PI) / 360);
    fitDistance = Math.max(height / 2 / f, width / 2 / (f * aspect), 10) * 1.22;
    camera.near = fitDistance / 200;
    camera.far = fitDistance * 20;
    camera.updateProjectionMatrix();
    controls.target.copy(center);
    // Nearly square-on, so the L reads as a right angle; a slight turn keeps the depth cue.
    camera.position.set(center.x + fitDistance * 0.14, center.y + fitDistance * 0.06, fitDistance * 0.99);
    controls.update();
    needsRender = true;
  }

  function syncLabels(labels: SceneLabel[]) {
    const keep = new Set(labels.map((l) => l.id));
    for (const [id, el] of labelEls) {
      if (!keep.has(id)) {
        el.remove();
        labelEls.delete(id);
        labelSize.delete(id);
      }
    }
    for (const l of labels) {
      let el = labelEls.get(l.id);
      if (!el) {
        el = document.createElement("div");
        el.className = "w3-lbl";
        el.append(document.createElement("b"), document.createTextNode(""));
        labelLayer.append(el);
        labelEls.set(l.id, el);
      }
      const strong = el.firstChild as HTMLElement;
      const rest = el.lastChild as Text;
      if (strong.textContent !== l.strong || rest.textContent !== (l.text ? ` ${l.text}` : "")) {
        strong.textContent = l.strong;
        rest.textContent = l.text ? ` ${l.text}` : "";
        labelSize.delete(l.id);
      }
      el.dataset.tone = l.tone ?? "";
    }
  }

  const tmp = new Vector3();
  function placeLabels() {
    if (!view) return;
    const w = canvas.clientWidth;
    const h = canvas.clientHeight;
    const placed: { x: number; y: number; w: number; h: number }[] = [];
    const sorted = [...view.labels].sort((a, b) => a.priority - b.priority);
    for (const l of sorted) {
      const el = labelEls.get(l.id);
      if (!el) continue;
      const dir = downhole(view.stations, l.md);
      // Beside the casing: right of travel by default, the other side when asked.
      const side = l.side ?? 1;
      pointVec(view.stations, l.md, tmp).add(
        new Vector3(-dir.y, dir.x, 0).multiplyScalar(side * (rCsg + rHole * 0.5)),
      );
      tmp.project(camera);
      if (tmp.z > 1 || tmp.z < -1) {
        el.hidden = true;
        continue;
      }
      const sx = ((tmp.x + 1) / 2) * w;
      const y = ((1 - tmp.y) / 2) * h;
      let size = labelSize.get(l.id);
      if (!size) {
        el.hidden = false;
        size = { w: el.offsetWidth, h: el.offsetHeight };
        labelSize.set(l.id, size);
      }
      const x = l.align === "end" ? sx - 6 - size.w : sx + 6;
      const box = { x, y: y - size.h / 2, w: size.w, h: size.h };
      // Near the right edge, put the label on the other side of the hole instead of clipping it.
      if (box.x + box.w > w - 4) box.x = Math.max(4, x - 12 - size.w - (rCsg / Math.max(fitDistance, 1)) * w);
      if (box.x < 4) box.x = 4;
      const off = box.x > w || box.y > h || box.x + box.w < 0 || box.y + box.h < 0;
      const hit = placed.some(
        (p) => box.x < p.x + p.w + 4 && box.x + box.w + 4 > p.x && box.y < p.y + p.h && box.y + box.h > p.y,
      );
      if (off || hit) {
        el.hidden = true;
        continue;
      }
      placed.push(box);
      el.hidden = false;
      el.style.transform = `translate(${Math.round(box.x)}px, ${Math.round(box.y)}px)`;
    }
  }

  function resize() {
    const w = canvas.clientWidth;
    const h = canvas.clientHeight;
    if (!w || !h) return;
    renderer.setSize(w, h, false);
    camera.aspect = w / h;
    camera.updateProjectionMatrix();
    needsRender = true;
  }
  const observer = new ResizeObserver(resize);
  observer.observe(canvas);
  resize();

  controls.addEventListener("change", () => {
    needsRender = true;
  });

  function resetView() {
    if (!view) return;
    const maxTvd = Math.max(...view.stations.map((s) => s.tvd), 1);
    const maxX = Math.max(...view.stations.map((s) => s.x), 0);
    center.set((maxX * S) / 2, -maxTvd * S * 0.54, 0);
    fitCamera(maxTvd * S, maxX * S);
  }

  const focus = new Vector3();
  function loop() {
    frame = requestAnimationFrame(loop);
    if (follow && view?.focusMd != null) {
      pointVec(view.stations, view.focusMd, focus);
      const step = focus.sub(controls.target).multiplyScalar(0.08);
      if (step.lengthSq() > 1e-8) {
        controls.target.add(step);
        camera.position.add(step);
        needsRender = true;
      }
    }
    controls.update();
    if (needsRender) {
      renderer.render(scene, camera);
      placeLabels();
      needsRender = false;
    }
  }
  frame = requestAnimationFrame(loop);

  return {
    update(v) {
      const nextWellKey = [
        v.wellDepth,
        v.holeId,
        v.pipeOd,
        v.casingMd ?? "",
        v.bocMd ?? "",
        v.stations.map((s) => `${s.md}:${s.tvd}`).join(","),
      ].join("|");
      if (nextWellKey !== wellKey) {
        wellKey = nextWellKey;
        buildWell(v);
      }
      const nextStringKey = `${v.columns.bitMd.toFixed(2)}|${rPipe}`;
      if (nextStringKey !== stringKey) {
        stringKey = nextStringKey;
        buildString(v);
      }
      paintTexture(texAnn, v.columns.annulus, 0, v.wellDepth, colors);
      paintTexture(texStr, v.columns.string, 0, Math.max(1, v.columns.bitMd), colors);
      view = v;
      syncLabels(v.labels);
      needsRender = true;
    },
    resetView,
    setFollow(on) {
      const was = follow;
      follow = on;
      if (on && !was && view?.focusMd != null) {
        // Close in on the pill, keeping the current viewing angle.
        const offset = camera.position.clone().sub(controls.target).setLength(fitDistance * 0.22);
        pointVec(view.stations, view.focusMd, controls.target);
        camera.position.copy(controls.target).add(offset);
      } else if (!on && was) {
        resetView();
      }
      needsRender = true;
    },
    dispose() {
      cancelAnimationFrame(frame);
      observer.disconnect();
      controls.dispose();
      for (const mesh of [annMesh, strMesh, csgMesh, shoeMesh, bitMesh, bocMesh]) {
        (mesh.geometry as BufferGeometry)?.dispose();
      }
      for (const m of [annMat, strMat, csgMat, steelMat, bocMat]) m.dispose();
      texAnn.dispose();
      texStr.dispose();
      if (grid) grid.geometry.dispose();
      renderer.dispose();
      for (const el of labelEls.values()) el.remove();
      labelEls.clear();
    },
  };
}
