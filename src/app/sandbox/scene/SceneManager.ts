// Central scene manager — single Scene, single Renderer, all geometry
import * as THREE from "three";
import Delaunator from "delaunator";

export type Node3D = { id: string; x: number; z: number; invert: number; maxD: number; initD: number; ground: number; type: string };
export type Pipe3D = { id: string; from: string; to: string; diam: number; length: number; roughness: number; fromInv: number; toInv: number; shape: string; inOffset: number; outOffset: number; verts: [number, number][] };
export type SC3D = { id: string; pts: [number, number][]; imperv: number; area: number; outlet: string; width: number; slope: number };

const PIPE_COLOR = "#5f7a8a", PIPE_EMI = "#0a1118", NODE_COLOR = "#5a7282", OUTFALL_COLOR = "#b87050";

function scColor(imp: number) { return imp > 80 ? "#b08070" : imp > 40 ? "#a09580" : "#809870"; }

export class SceneManager {
  scene: THREE.Scene;
  camera: THREE.PerspectiveCamera;
  renderer: THREE.WebGLRenderer;
  groups: Record<string, THREE.Group> = {};
  nodeMap = new Map<string, { g: THREE.Group; iy: number; gy: number }>();
  pipeMap = new Map<string, { mesh: THREE.Mesh; curve: THREE.CatmullRomCurve3; hitTarget: THREE.Mesh }>();
  waterMap = new Map<string, THREE.Mesh>();
  terrainMesh: THREE.Mesh | null = null;
  clipPlane = new THREE.Plane(new THREE.Vector3(0, 1, 0.3), 0);
  clipEnabled = true;
  data: any = null;
  span = 300;
  ve = 8;
  minElev = 0;
  avgSurface = 0;

  constructor(container: HTMLDivElement) {
    const w = container.clientWidth, h = container.clientHeight;

    this.scene = new THREE.Scene();
    this.scene.background = new THREE.Color("#1c1c24");
    this.scene.fog = new THREE.Fog("#1c1c24", 150, 900);

    this.camera = new THREE.PerspectiveCamera(42, w / h, 0.3, 2500);

    this.renderer = new THREE.WebGLRenderer({ antialias: true });
    this.renderer.setSize(w, h);
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 1.1;
    this.renderer.localClippingEnabled = true;
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

    // Groups
    this.groups = {
      terrain: new THREE.Group(), sc: new THREE.Group(),
      pipes: new THREE.Group(), nodes: new THREE.Group(),
      markers: new THREE.Group(),
    };
    Object.values(this.groups).forEach(g => this.scene.add(g));

    // Resize
    window.addEventListener("resize", () => {
      const w2 = container.clientWidth, h2 = container.clientHeight;
      this.camera.aspect = w2 / h2; this.camera.updateProjectionMatrix();
      this.renderer.setSize(w2, h2);
    });
  }

  // ─── Elevation helper ───
  ey(e: number) { return (e - this.minElev) * this.ve; }

  // ─── Build all geometry ───
  build(data: { nodes: Node3D[]; pipes: Pipe3D[]; scs: SC3D[] }, ve: number) {
    this.data = data; this.ve = ve;
    this.nodeMap.clear(); this.pipeMap.clear(); this.waterMap.clear();

    // Clear old
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

    // ─── Scale params for screen visibility ───
    // At default camera dist (span*1.25=375m) with 42deg FOV on ~1400px width:
    // Visible width ≈ 2*dist*tan(21°) ≈ 288m. 1px ≈ 0.206m.
    // Min pipe 6px = 1.24m diameter = 0.62m radius
    // Min node 12px = 2.47m diameter = 1.24m radius → use 0.5m as compromise
    const NODE_R = Math.max(0.45, this.span * 0.0015);
    const OUTFALL_R = NODE_R * 1.5;
    const PIPE_MIN_R = Math.max(0.3, this.span * 0.001);
    const PIPE_MAX_R = this.span * 0.006;

    // ─── TIN Terrain ───
    this.terrainMesh = this.buildTINTerrain(data.nodes);
    this.groups.terrain.add(this.terrainMesh);

    // Terrain cross-section edge indicator
    const edgeMat = new THREE.MeshBasicMaterial({ color: "#6a5a4a", side: THREE.DoubleSide });
    // A thin strip showing the cut face — added as a vertical plane at clip edge
    const cutFaceGeom = new THREE.PlaneGeometry(this.span * 1.2, this.ey(maxElev - this.minElev + 2));
    const cutFace = new THREE.Mesh(cutFaceGeom, edgeMat);
    cutFace.position.set((mnX + mxX) / 2, this.ey(this.minElev - 0.5) + cutFaceGeom.parameters.height / 2, mnZ - this.span * 0.1);
    cutFace.rotation.y = 0;
    cutFace.name = "cutFace";
    cutFace.renderOrder = 5;
    this.groups.markers.add(cutFace);

    // ─── Subcatchments ───
    const gndY = this.ey(this.avgSurface);
    data.scs.forEach(sc => {
      if (sc.pts.length < 3) return;
      const sh = new THREE.Shape();
      sc.pts.forEach(([x, z], i) => i === 0 ? sh.moveTo(x, z) : sh.lineTo(x, z));
      const color = scColor(sc.imperv);
      const g = new THREE.ExtrudeGeometry(sh, { steps: 1, depth: 0.015, bevelEnabled: false });
      const f = new THREE.Mesh(g, new THREE.MeshStandardMaterial({ color, roughness: 0.75, transparent: true, opacity: 0.12, side: THREE.DoubleSide, depthWrite: false }));
      f.rotation.x = -Math.PI / 2; f.position.y = gndY + 0.03; f.renderOrder = 1;
      f.userData = { type: "subcatchment", data: { id: sc.id, area: sc.area, imperv: sc.imperv, outlet: sc.outlet, width: sc.width, slope: sc.slope, vertices: sc.pts.length } };
      this.groups.sc.add(f);
    });

    // ─── Nodes ───
    data.nodes.forEach(n => {
      const g = new THREE.Group();
      const iy = this.ey(n.invert), gy = this.ey(n.ground);
      const sh = Math.max(0.15, gy - iy);
      const isO = n.type === "outfall";
      const r = isO ? OUTFALL_R : NODE_R;

      // Shaft
      const sg = new THREE.CylinderGeometry(r, r, sh, 12);
      const sm = new THREE.Mesh(sg, new THREE.MeshStandardMaterial({ color: isO ? OUTFALL_COLOR : NODE_COLOR, roughness: 0.35, metalness: 0.08, emissive: isO ? "#1a0800" : "#060c10", emissiveIntensity: isO ? 0.15 : 0.05 }));
      sm.position.y = iy + sh / 2; sm.castShadow = true; sm.receiveShadow = true;
      sm.name = "shaft"; g.add(sm);

      // Top ring
      const tg = new THREE.TorusGeometry(r * 1.15, r * 0.22, 8, 10);
      const tm = new THREE.Mesh(tg, new THREE.MeshStandardMaterial({ color: isO ? "#c87858" : "#6a8898", emissive: isO ? "#1a0800" : "#060c10", emissiveIntensity: 0.2, roughness: 0.2 }));
      tm.position.y = gy; tm.rotation.x = Math.PI / 2; tm.name = "ring";
      g.add(tm);

      // Bottom disc
      const bg = new THREE.CylinderGeometry(r * 0.9, r * 0.9, 0.05, 12);
      const bm = new THREE.Mesh(bg, new THREE.MeshStandardMaterial({ color: "#3a4048", roughness: 0.6 }));
      bm.position.y = iy; bm.name = "bottom";
      g.add(bm);

      g.position.set(n.x, 0, n.z);
      g.userData = { type: "node", data: { id: n.id, type: n.type, invert: n.invert, ground: n.ground, maxDepth: n.maxD, initDepth: n.initD } };
      this.groups.nodes.add(g);
      this.nodeMap.set(n.id, { g, iy, gy });
    });

    // ─── Pipes with proper sizing ───
    data.pipes.forEach(p => {
      const fn = data.nodes.find(nn => nn.id === p.from), tn = data.nodes.find(nn => nn.id === p.to);
      if (!fn || !tn) return;
      const fy = this.ey(fn.invert + 0.05), ty = this.ey(tn.invert + 0.05);
      const vr = Math.max(PIPE_MIN_R, Math.min(PIPE_MAX_R, p.diam * 0.65));
      const path: THREE.Vector3[] = [new THREE.Vector3(fn.x, fy, fn.z)];
      p.verts.forEach(([vx, vz]) => path.push(new THREE.Vector3(vx, fy, vz)));
      path.push(new THREE.Vector3(tn.x, ty, tn.z));
      if (path.length < 2) return;

      const curve = new THREE.CatmullRomCurve3(path);
      const tg = new THREE.TubeGeometry(curve, Math.max(10, path.length * 4), vr, 12, false);
      const tm = new THREE.Mesh(tg, new THREE.MeshStandardMaterial({ color: PIPE_COLOR, roughness: 0.4, metalness: 0.1, emissive: PIPE_EMI, emissiveIntensity: 0.06 }));
      tm.castShadow = true; tm.receiveShadow = true;
      tm.userData = { type: "pipe", data: { id: p.id, from: p.from, to: p.to, diam: p.diam, length: p.length, roughness: p.roughness, shape: p.shape, inOffset: p.inOffset, outOffset: p.outOffset, vertCount: p.verts.length } };

      // Invisible wide hit target
      const ht = new THREE.Mesh(
        new THREE.TubeGeometry(curve, Math.max(6, path.length * 2), vr * 3, 8, false),
        new THREE.MeshBasicMaterial({ visible: false, depthTest: false }),
      );
      ht.userData = { type: "pipe", data: tm.userData.data }; ht.name = "hitTarget";
      tm.add(ht);

      this.groups.pipes.add(tm);
      this.pipeMap.set(p.id, { mesh: tm, curve, hitTarget: ht });
    });

    // Apply clipping
    this.updateClipping();
  }

  // ─── TIN Terrain via Delaunay triangulation ───
  buildTINTerrain(nodes: Node3D[]): THREE.Mesh {
    const pts = nodes.filter(n => isFinite(n.x) && isFinite(n.z) && isFinite(n.ground));
    const coords = new Float64Array(pts.length * 2);
    for (let i = 0; i < pts.length; i++) { coords[i * 2] = pts[i].x; coords[i * 2 + 1] = pts[i].z; }
    const del = new Delaunator(coords);

    const verts: number[] = [];
    for (const p of pts) { verts.push(p.x, this.ey(p.ground), p.z); }

    // Add border expansion
    const margin = this.span * 0.12;
    let mnX2 = Infinity, mxX2 = -Infinity, mnZ2 = Infinity, mxZ2 = -Infinity;
    pts.forEach(p => { if (p.x < mnX2) mnX2 = p.x; if (p.x > mxX2) mxX2 = p.x; if (p.z < mnZ2) mnZ2 = p.z; if (p.z > mxZ2) mxZ2 = p.z; });
    const borderPts: [number, number, number][] = [];
    const cx = (mnX2 + mxX2) / 2, cz = (mnZ2 + mxZ2) / 2;
    for (let i = 0; i < 16; i++) {
      const angle = (i / 16) * Math.PI * 2;
      const r = this.span * 0.55;
      const bx = cx + Math.cos(angle) * r, bz = cz + Math.sin(angle) * r;
      let minD = Infinity, nearY = 0;
      for (const p of pts) { const d = (p.x - bx) ** 2 + (p.z - bz) ** 2; if (d < minD) { minD = d; nearY = this.ey(p.ground); } }
      borderPts.push([bx, bz, nearY]);
    }

    const indices: number[] = [];
    for (let i = 0; i < del.triangles.length; i += 3) {
      const a = del.triangles[i], b = del.triangles[i + 1], c = del.triangles[i + 2];
      if (a < pts.length && b < pts.length && c < pts.length) {
        indices.push(a, b, c);
      }
    }

    // Add border fan
    const nodeStart = pts.length;
    for (const [bx, bz, by] of borderPts) verts.push(bx, by, bz);
    for (let bi = 0; bi < borderPts.length; bi++) {
      const bi2 = (bi + 1) % borderPts.length;
      const [bx1, bz1] = borderPts[bi];
      let bestD1 = Infinity, bestI1 = 0;
      for (let ni = 0; ni < pts.length; ni++) {
        const d = (pts[ni].x - bx1) ** 2 + (pts[ni].z - bz1) ** 2;
        if (d < bestD1) { bestD1 = d; bestI1 = ni; }
      }
      indices.push(nodeStart + bi, bestI1, nodeStart + bi2);
    }

    const geom = new THREE.BufferGeometry();
    geom.setAttribute("position", new THREE.Float32BufferAttribute(verts, 3));
    geom.setIndex(indices);
    geom.computeVertexNormals();

    const mat = new THREE.MeshStandardMaterial({
      color: "#4a4a4a", roughness: 0.9, metalness: 0.05,
      side: THREE.DoubleSide,
      clippingPlanes: this.clipEnabled ? [this.clipPlane] : [],
      clipShadows: true,
    });
    const mesh = new THREE.Mesh(geom, mat);
    mesh.receiveShadow = true; mesh.castShadow = true;
    mesh.renderOrder = 0;
    mesh.name = "terrain";
    return mesh;
  }

  // ─── Clipping ───
  updateClipping() {
    const clipPlanes = this.clipEnabled ? [this.clipPlane] : [];
    this.renderer.clippingPlanes = clipPlanes;

    // Apply to terrain
    if (this.terrainMesh) {
      (this.terrainMesh.material as THREE.Material).clippingPlanes = clipPlanes;
      (this.terrainMesh.material as THREE.Material).needsUpdate = true;
    }

    // Apply to subcatchments
    this.groups.sc.children.forEach(c => {
      if (c instanceof THREE.Mesh && c.material) {
        (c.material as THREE.Material).clippingPlanes = clipPlanes;
        (c.material as THREE.Material).needsUpdate = true;
      }
    });

    this.renderer.render(this.scene, this.camera);
  }

  setClipOffset(offset: number) {
    this.clipPlane.constant = offset;
    this.updateClipping();
  }

  toggleClipping() {
    this.clipEnabled = !this.clipEnabled;
    this.updateClipping();
    return this.clipEnabled;
  }

  // ─── Camera ───
  defaultCamera() {
    const d = this.data; if (!d) return;
    let mnX2 = Infinity, mxX2 = -Infinity, mnZ2 = Infinity, mxZ2 = -Infinity;
    let minY = Infinity, maxY = -Infinity;
    d.nodes.forEach((n: Node3D) => {
      if (n.x < mnX2) mnX2 = n.x; if (n.x > mxX2) mxX2 = n.x;
      if (n.z < mnZ2) mnZ2 = n.z; if (n.z > mxZ2) mxZ2 = n.z;
      const gy = this.ey(n.ground), iy = this.ey(n.invert);
      if (iy < minY) minY = iy; if (gy > maxY) maxY = gy;
    });
    const cx2 = (mnX2 + mxX2) / 2, cz2 = (mnZ2 + mxZ2) / 2;
    const cy = (minY + maxY) / 2;
    const dist = this.span * 1.25;
    // Low angle: ~25° above horizon
    const phi = 1.1; // radians from vertical, ~63° i.e. ~27° above horizon
    const theta = 0.45;
    this.camera.position.set(
      cx2 + dist * Math.sin(phi) * Math.cos(theta),
      cy + dist * Math.cos(phi) * 0.6,
      cz2 + dist * Math.sin(phi) * Math.sin(theta),
    );
    this.camera.lookAt(cx2, cy, cz2);
  }

  animate(cb: () => void) {
    const loop = () => { requestAnimationFrame(loop); cb(); this.renderer.render(this.scene, this.camera); };
    loop();
  }

  dispose() {
    this.renderer.dispose();
    this.scene.clear();
  }
}
