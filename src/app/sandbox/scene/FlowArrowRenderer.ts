// Flow arrows along pipe curves — object-pooled, direction-aware
import * as THREE from "three";

interface ArrowPipe {
  curve: THREE.CatmullRomCurve3;
  arrows: THREE.Mesh[];
  flowData: number[];
  velData: number[];
}

const ARROWS_PER_PIPE = 4;
const ARROW_SIZE = 0.35;

export class FlowArrowRenderer {
  private pipes = new Map<string, ArrowPipe>();
  private group: THREE.Group;
  private arrowGeom: THREE.ConeGeometry;

  constructor(parent: THREE.Scene) {
    this.group = new THREE.Group();
    parent.add(this.group);
    // Cone arrow pointing in +Z (tangent direction)
    this.arrowGeom = new THREE.ConeGeometry(ARROW_SIZE * 0.5, ARROW_SIZE, 6, 4);
  }

  registerPipe(id: string, curve: THREE.CatmullRomCurve3) {
    const arrows: THREE.Mesh[] = [];
    const mat = new THREE.MeshStandardMaterial({ color: "#3388cc", roughness: 0.3, metalness: 0.1, emissive: "#001122", emissiveIntensity: 0.2 });
    for (let i = 0; i < ARROWS_PER_PIPE; i++) {
      const arrow = new THREE.Mesh(this.arrowGeom, mat);
      arrow.visible = false;
      this.group.add(arrow);
      arrows.push(arrow);
    }
    this.pipes.set(id, { curve, arrows, flowData: [], velData: [] });
  }

  setData(id: string, flowData: number[], velData: number[]) {
    const p = this.pipes.get(id);
    if (p) { p.flowData = flowData; p.velData = velData; }
  }

  update(step: number, time: number) {
    this.pipes.forEach(p => {
      const flow = p.flowData[step] ?? 0;
      const vel = p.velData[step] ?? 0;
      const absFlow = Math.abs(flow);

      if (absFlow < 0.0005) {
        p.arrows.forEach(a => { a.visible = false; });
        return;
      }

      const dir = flow >= 0 ? 1 : -1;
      const speed = Math.max(0.1, Math.min(2.0, absFlow * 2));
      const offset = (time * 0.001 * speed * dir) % 1;

      for (let i = 0; i < ARROWS_PER_PIPE; i++) {
        const arrow = p.arrows[i];
        arrow.visible = true;
        const t = (((i / ARROWS_PER_PIPE) + offset) % 1 + 1) % 1;
        const pt = p.curve.getPointAt(t);
        const tangent = p.curve.getTangentAt(t).normalize();
        if (dir < 0) tangent.negate();

        arrow.position.copy(pt);
        // Orient cone along tangent (cone points in +Y by default)
        const up = new THREE.Vector3(0, 1, 0);
        const quat = new THREE.Quaternion().setFromUnitVectors(up, tangent);
        arrow.setRotationFromQuaternion(quat);

        // Slightly lift above pipe center
        arrow.position.y += ARROW_SIZE * 0.3;
      }
    });
  }

  clear() {
    this.pipes.forEach(p => {
      p.arrows.forEach(a => { this.group.remove(a); a.geometry?.dispose(); });
    });
    this.pipes.clear();
    this.group.parent?.remove(this.group);
  }
}
