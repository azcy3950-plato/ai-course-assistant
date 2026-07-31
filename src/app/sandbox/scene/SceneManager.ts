// Scene manager — single Scene, single Renderer, engineering cutaway geometry
import * as THREE from "three";
import { buildEngineeringSlab } from "./EngineeringSlab";

export type Node3D = { id: string; x: number; z: number; invert: number; maxD: number; initD: number; ground: number; type: string };
export type Pipe3D = { id: string; from: string; to: string; diam: number; length: number; roughness: number; fromInv: number; toInv: number; shape: string; inOffset: number; outOffset: number; verts: [number,number][] };
export type SC3D = { id: string; pts: [number,number][]; imperv: number; area: number; outlet: string; width: number; slope: number };

const PIPE_COLOR = "#5a6e7a", PIPE_EMI = "#080e14", NODE_COLOR = "#556a78", OUTFALL_COLOR = "#b06848";

function scColor(imp: number) { return imp > 80 ? "#b08070" : imp > 40 ? "#a09580" : "#809870"; }

export class SceneManager {
  scene: THREE.Scene;
  camera: THREE.OrthographicCamera;
  renderer: THREE.WebGLRenderer;
  groups: Record<string, THREE.Group> = {};
  nodeMap = new Map<string, { g: THREE.Group; iy: number; gy: number }>();
  pipeMap = new Map<string, { mesh: THREE.Mesh; curve: THREE.CatmullRomCurve3 }>();
  waterMap = new Map<string, THREE.Mesh>();
  slabGroup: THREE.Group | null = null;
  data: any = null;
  span = 300; ve = 6; minElev = 0; avgSurface = 0;
  shiftY = 0; // underground shift for visibility
  frustumSize = 400;

  constructor(container: HTMLDivElement) {
    const w = container.clientWidth, h = container.clientHeight;
    this.scene = new THREE.Scene();
    this.scene.background = new THREE.Color("#1a1a22");
    this.scene.fog = new THREE.Fog("#1a1a22", 200, 1000);

    const aspect = w / h;
    this.frustumSize = 400;
    this.camera = new THREE.OrthographicCamera(
      -this.frustumSize * aspect / 2, this.frustumSize * aspect / 2,
      this.frustumSize / 2, -this.frustumSize / 2, 1, 3000,
    );

    this.renderer = new THREE.WebGLRenderer({ antialias: true });
    this.renderer.setSize(w, h);
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 1.0;
    container.appendChild(this.renderer.domElement);

    // Lighting
    this.scene.add(new THREE.AmbientLight("#556677", 0.5));
    const sun = new THREE.DirectionalLight("#fff8e8", 2.5);
    sun.position.set(200, 350, 80);
    sun.castShadow = true;
    sun.shadow.mapSize.set(2048, 2048);
    sun.shadow.camera.near = 5; sun.shadow.camera.far = 1200;
    sun.shadow.camera.left = -200; sun.shadow.camera.right = 200;
    sun.shadow.camera.top = 200; sun.shadow.camera.bottom = -200;
    sun.shadow.bias = -0.0005;
    this.scene.add(sun);
    this.scene.add(new THREE.HemisphereLight("#8899cc", "#334455", 0.5));

    this.groups = {
      slab: new THREE.Group(), sc: new THREE.Group(),
      pipes: new THREE.Group(), nodes: new THREE.Group(),
      arrows: new THREE.Group(),
    };
    Object.values(this.groups).forEach(g => this.scene.add(g));

    window.addEventListener("resize", () => {
      const w2 = container.clientWidth, h2 = container.clientHeight;
      const a2 = w2 / h2;
      this.camera.left = -this.frustumSize * a2 / 2;
      this.camera.right = this.frustumSize * a2 / 2;
      this.camera.top = this.frustumSize / 2;
      this.camera.bottom = -this.frustumSize / 2;
      this.camera.updateProjectionMatrix();
      this.renderer.setSize(w2, h2);
    });
  }

  ey(e: number) { return (e - this.minElev) * this.ve; }

  build(data: { nodes: Node3D[]; pipes: Pipe3D[]; scs: SC3D[] }, ve: number) {
    this.data = data; this.ve = ve;
    this.nodeMap.clear(); this.pipeMap.clear(); this.waterMap.clear();
    Object.values(this.groups).forEach(g => { while (g.children.length > 0) g.remove(g.children[0]); });

    let mnX = Infinity, mxX = -Infinity, mnZ = Infinity, mxZ = -Infinity;
    this.minElev = Infinity; let maxElev = -Infinity;
    data.nodes.forEach(n => {
      if (n.x < mnX) mnX = n.x; if (n.x > mxX) mxX = n.x;
      if (n.z < mnZ) mnZ = n.z; if (n.z > mxZ) mxZ = n.z;
      if (n.invert < this.minElev) this.minElev = n.invert;
      if (n.ground > maxElev) maxElev = n.ground;
    });
    this.avgSurface = data.nodes.reduce((s, n) => s + n.ground, 0) / data.nodes.length;
    this.span = Math.max(mxX - mnX, mxZ - mnZ, 50);

    // Underground shift for visibility
    this.shiftY = -this.span * 0.06;

    // Scale parameters
    const NODE_R = Math.max(0.4, this.span * 0.0013);
    const OUTFALL_R = NODE_R * 1.4;
    const PIPE_MIN_R = Math.max(0.25, this.span * 0.0018);
    const PIPE_MAX_R = Math.max(PIPE_MIN_R + 0.1, this.span * 0.004);

    // ─── Engineering slab ───
    const surfaceY = this.ey(this.avgSurface);
    const thickness = this.span * 0.12;
    const margin = this.span * 0.06;
    this.slabGroup = buildEngineeringSlab(mnX, mxX, mnZ, mxZ, surfaceY, thickness, margin);
    this.groups.slab.add(this.slabGroup);

    // ─── Subcatchments (on slab surface, back half only) ───
    const midZ = (mnZ + mxZ) / 2;
    data.scs.forEach(sc => {
      if (sc.pts.length < 3) return;
      // Only show SC whose centroid is in the back half
      let scx = 0, scz = 0; sc.pts.forEach(([x, z]) => { scx += x; scz += z; });
      scx /= sc.pts.length; scz /= sc.pts.length;
      if (scz < midZ) return; // skip front-half SC (cut away)

      const sh = new THREE.Shape();
      sc.pts.forEach(([x, z], i) => i === 0 ? sh.moveTo(x, z) : sh.lineTo(x, z));
      const color = scColor(sc.imperv);
      const g = new THREE.ExtrudeGeometry(sh, { steps: 1, depth: 0.01, bevelEnabled: false });
      const f = new THREE.Mesh(g, new THREE.MeshStandardMaterial({ color, roughness: 0.75, transparent: true, opacity: 0.13, side: THREE.DoubleSide, depthWrite: false }));
      f.rotation.x = -Math.PI / 2; f.position.y = surfaceY + 0.03; f.renderOrder = 1;
      f.userData = { type: "subcatchment", data: { id: sc.id, area: sc.area, imperv: sc.imperv, outlet: sc.outlet, width: sc.width, slope: sc.slope, vertices: sc.pts.length } };
      this.groups.sc.add(f);
    });

    // ─── Nodes ───
    data.nodes.forEach(n => {
      const g = new THREE.Group();
      const iy = this.ey(n.invert) + this.shiftY;
      const gy = this.ey(n.ground);
      const sh = Math.max(0.15, gy - iy);
      if (sh < 0.05) return; // skip if shaft would be invisible
      const isO = n.type === "outfall";
      const r = isO ? OUTFALL_R : NODE_R;

      // Shaft
      const sg = new THREE.CylinderGeometry(r, r, sh, 12);
      const sm = new THREE.Mesh(sg, new THREE.MeshStandardMaterial({ color: isO ? OUTFALL_COLOR : NODE_COLOR, roughness: 0.35, metalness: 0.08, emissive: isO ? "#180800" : "#060c10", emissiveIntensity: 0.05 }));
      sm.position.y = iy + sh / 2; sm.castShadow = true; sm.receiveShadow = true;
      g.add(sm);

      // Top ring
      const tg = new THREE.TorusGeometry(r * 1.15, r * 0.2, 8, 10);
      const tm = new THREE.Mesh(tg, new THREE.MeshStandardMaterial({ color: isO ? "#c07050" : "#688090", roughness: 0.2, metalness: 0.05 }));
      tm.position.y = gy; tm.rotation.x = Math.PI / 2;
      g.add(tm);

      // Bottom disc
      const bg = new THREE.CylinderGeometry(r * 0.85, r * 0.85, 0.04, 12);
      const bm = new THREE.Mesh(bg, new THREE.MeshStandardMaterial({ color: "#3a4048", roughness: 0.6 }));
      bm.position.y = iy;
      g.add(bm);

      // Vertical connectors from shaft bottom to pipe level
      // (rendered as thin lines for now — the shaft itself covers most)

      g.position.set(n.x, 0, n.z);
      g.userData = { type: "node", data: { id: n.id, type: n.type, invert: n.invert, ground: n.ground, maxDepth: n.maxD, initDepth: n.initD } };
      this.groups.nodes.add(g);
      this.nodeMap.set(n.id, { g, iy, gy });
    });

    // ─── Pipes ───
    data.pipes.forEach(p => {
      const fn = data.nodes.find(nn => nn.id === p.from), tn = data.nodes.find(nn => nn.id === p.to);
      if (!fn || !tn) return;
      const fy = this.ey(fn.invert + 0.05) + this.shiftY;
      const ty = this.ey(tn.invert + 0.05) + this.shiftY;
      const vr = Math.max(PIPE_MIN_R, Math.min(PIPE_MAX_R, p.diam * 0.6));
      const path: THREE.Vector3[] = [new THREE.Vector3(fn.x, fy, fn.z)];
      p.verts.forEach(([vx, vz]) => path.push(new THREE.Vector3(vx, fy, vz)));
      path.push(new THREE.Vector3(tn.x, ty, tn.z));
      if (path.length < 2) return;

      const curve = new THREE.CatmullRomCurve3(path);
      const tg = new THREE.TubeGeometry(curve, Math.max(10, path.length * 4), vr, 12, false);
      const mat = new THREE.MeshStandardMaterial({ color: PIPE_COLOR, roughness: 0.4, metalness: 0.1, emissive: PIPE_EMI, emissiveIntensity: 0.05 });
      const tm = new THREE.Mesh(tg, mat);
      tm.castShadow = true; tm.receiveShadow = true;
      tm.userData = { type: "pipe", data: { id: p.id, from: p.from, to: p.to, diam: p.diam, length: p.length, roughness: p.roughness, shape: p.shape, inOffset: p.inOffset, outOffset: p.outOffset, vertCount: p.verts.length } };

      // Invisible hit target
      const ht = new THREE.Mesh(new THREE.TubeGeometry(curve, Math.max(6, path.length * 2), vr * 3, 8, false), new THREE.MeshBasicMaterial({ visible: false, depthTest: false }));
      ht.userData = { type: "pipe", data: tm.userData.data }; ht.name = "hitTarget";
      tm.add(ht);

      this.groups.pipes.add(tm);
      this.pipeMap.set(p.id, { mesh: tm, curve });
    });
  }

  // Camera presets
  defaultView() {
    const d = this.data; if (!d) return;
    let cx = 0, cz = 0;
    d.nodes.forEach((n: Node3D) => { cx += n.x; cz += n.z; });
    cx /= d.nodes.length; cz /= d.nodes.length;
    const cy = this.ey(this.minElev + (this.avgSurface - this.minElev) * 0.3) + this.shiftY;
    // Oblique view: ~40° horizontal, ~25° above horizon
    const dist = this.span * 0.55;
    this.camera.position.set(cx + dist * 0.75, cy + dist * 0.45, cz + dist * 0.85);
    this.camera.lookAt(cx, cy, cz);
  }

  topView() {
    const d = this.data; if (!d) return;
    let cx = 0, cz = 0, cy = 0;
    d.nodes.forEach((n: Node3D) => { cx += n.x; cz += n.z; cy += this.ey(n.ground); });
    cx /= d.nodes.length; cz /= d.nodes.length; cy /= d.nodes.length;
    this.camera.position.set(cx, cy + this.span * 0.7, cz + 2);
    this.camera.lookAt(cx, cy, cz);
  }

  undergroundView() {
    const d = this.data; if (!d) return;
    let cx = 0, cz = 0, minY = Infinity;
    d.nodes.forEach((n: Node3D) => { cx += n.x; cz += n.z; const iy = this.ey(n.invert) + this.shiftY; if (iy < minY) minY = iy; });
    cx /= d.nodes.length; cz /= d.nodes.length;
    this.groups.slab.visible = false;
    this.groups.sc.visible = false;
    this.camera.position.set(cx + this.span * 0.3, minY + this.span * 0.2, cz + this.span * 0.3);
    this.camera.lookAt(cx, minY, cz);
  }

  restoreSurface() { this.groups.slab.visible = true; this.groups.sc.visible = true; }

  focusObject(obj: any) {
    let tx = 0, tz = 0, ty = 0;
    if (obj.type === "node") {
      const n = this.data.nodes.find((nn: Node3D) => nn.id === obj.data.id);
      if (n) { tx = n.x; tz = n.z; ty = this.ey(n.invert + (n.ground - n.invert) * 0.5) + this.shiftY; }
    } else if (obj.type === "pipe") {
      const fn = this.data.nodes.find((nn: Node3D) => nn.id === obj.data.from);
      const tn = this.data.nodes.find((nn: Node3D) => nn.id === obj.data.to);
      if (fn && tn) { tx = (fn.x + tn.x) / 2; tz = (fn.z + tn.z) / 2; ty = this.ey(fn.invert) + this.shiftY; }
    }
    const dist = this.span * 0.2;
    this.camera.position.set(tx + dist * 0.6, ty + dist * 0.5, tz + dist * 0.7);
    this.camera.lookAt(tx, ty, tz);
  }

  animate(cb: () => void) {
    const loop = () => { requestAnimationFrame(loop); cb(); this.renderer.render(this.scene, this.camera); };
    loop();
  }

  dispose() { this.renderer.dispose(); this.scene.clear(); }
}
