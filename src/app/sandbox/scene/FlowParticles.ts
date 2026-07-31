// Flow particles along pipe TubeGeometry curves
import * as THREE from "three";

interface PipeFlow {
  mesh: THREE.Mesh;
  particles: THREE.Points | null;
  curve: THREE.CatmullRomCurve3;
  flowData: number[];
  velData: number[];
  capData: number[];
}

const PARTICLES_PER_PIPE = 20;
const PARTICLE_SIZE = 0.12;

export class FlowParticleSystem {
  private flows = new Map<string, PipeFlow>();
  private scene: THREE.Scene;

  constructor(scene: THREE.Scene) { this.scene = scene; }

  registerPipe(id: string, mesh: THREE.Mesh, curve: THREE.CatmullRomCurve3) {
    const geom = new THREE.BufferGeometry();
    const positions = new Float32Array(PARTICLES_PER_PIPE * 3);
    const colors = new Float32Array(PARTICLES_PER_PIPE * 3);

    for (let i = 0; i < PARTICLES_PER_PIPE; i++) {
      const t = i / PARTICLES_PER_PIPE;
      const pt = curve.getPointAt(t);
      positions[i * 3] = pt.x; positions[i * 3 + 1] = pt.y; positions[i * 3 + 2] = pt.z;
      colors[i * 3] = 0.3; colors[i * 3 + 1] = 0.6; colors[i * 3 + 2] = 1.0;
    }

    geom.setAttribute("position", new THREE.BufferAttribute(positions, 3));
    geom.setAttribute("color", new THREE.BufferAttribute(colors, 3));

    const mat = new THREE.PointsMaterial({
      size: PARTICLE_SIZE, vertexColors: true,
      blending: THREE.AdditiveBlending, depthWrite: false, transparent: true, opacity: 0.7,
    });

    const points = new THREE.Points(geom, mat);
    points.visible = false;
    this.scene.add(points);

    this.flows.set(id, {
      mesh, particles: points, curve,
      flowData: [], velData: [], capData: [],
    });
  }

  setData(id: string, flowData: number[], velData: number[], capData: number[]) {
    const f = this.flows.get(id);
    if (f) { f.flowData = flowData; f.velData = velData; f.capData = capData; }
  }

  update(step: number) {
    this.flows.forEach((f) => {
      if (!f.particles) return;
      const flow = f.flowData[step] ?? 0;
      const vel = f.velData[step] ?? 0;
      const cap = f.capData[step] ?? 0;
      const absFlow = Math.abs(flow);

      if (absFlow < 0.0005) {
        f.particles.visible = false; return;
      }

      f.particles.visible = true;
      const direction = flow >= 0 ? 1 : -1;
      const speed = Math.max(0.05, Math.min(3, absFlow * 3));

      // Update particle opacity based on capacity
      const mat = f.particles.material as THREE.PointsMaterial;
      mat.opacity = 0.3 + cap * 0.5;

      // Animate particles along curve
      const pos = f.particles.geometry.attributes.position.array as Float32Array;
      const col = f.particles.geometry.attributes.color as THREE.BufferAttribute;
      const colors = col.array as Float32Array;

      for (let i = 0; i < PARTICLES_PER_PIPE; i++) {
        const t0 = (i / PARTICLES_PER_PIPE);
        // Offset by time-based animation
        const t = ((t0 + direction * speed * 0.01 * (Date.now() % 10000) / 1000) % 1 + 1) % 1;
        const pt = f.curve.getPointAt(t);
        pos[i * 3] = pt.x; pos[i * 3 + 1] = pt.y; pos[i * 3 + 2] = pt.z;

        // Color: blue → cyan based on speed
        const ratio = Math.min(1, absFlow / 2);
        colors[i * 3] = 0.2 + ratio * 0.3;
        colors[i * 3 + 1] = 0.5 + ratio * 0.4;
        colors[i * 3 + 2] = 0.7 + ratio * 0.3;
      }

      f.particles.geometry.attributes.position.needsUpdate = true;
      col.needsUpdate = true;
    });
  }

  clear() {
    this.flows.forEach((f) => {
      if (f.particles) { this.scene.remove(f.particles); f.particles.geometry.dispose(); (f.particles.material as THREE.Material).dispose(); }
    });
    this.flows.clear();
  }

  getPipes() { return this.flows; }
}
