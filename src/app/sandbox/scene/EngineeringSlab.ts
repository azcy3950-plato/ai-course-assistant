// Engineering cutaway slab with solid cross-section faces
// A thick rectangular base with the front ~40% removed to reveal underground
import * as THREE from "three";

export function buildEngineeringSlab(
  mnX: number, mxX: number, mnZ: number, mxZ: number,
  surfaceY: number, thickness: number, margin: number,
): THREE.Group {
  const group = new THREE.Group();
  const cx = (mnX + mxX) / 2, cz = (mnZ + mxZ) / 2;
  const hw = (mxX - mnX) / 2 + margin; // half-width X
  const hd = (mxZ - mnZ) / 2 + margin; // half-depth Z
  const fullW = hw * 2, fullD = hd * 2;

  // Cutaway: remove front ~40% of the slab
  const cutRatio = 0.40;
  const cutZ = mnZ - margin + fullD * (1 - cutRatio); // Z where cutaway starts
  const frontZ = mnZ - margin;
  const backZ = mxZ + margin;
  const leftX = mnX - margin;
  const rightX = mxX + margin;
  const topY = surfaceY;
  const botY = surfaceY - thickness;

  // Materials
  const topMat = new THREE.MeshStandardMaterial({ color: "#5a5a52", roughness: 0.85, metalness: 0.05, side: THREE.DoubleSide });
  const sideMat = new THREE.MeshStandardMaterial({ color: "#4a4538", roughness: 0.9, metalness: 0.05, side: THREE.DoubleSide });
  const cutMat = new THREE.MeshStandardMaterial({ color: "#6b6050", roughness: 0.8, metalness: 0.05, side: THREE.DoubleSide }); // cross-section face
  const bottomMat = new THREE.MeshStandardMaterial({ color: "#3a3530", roughness: 0.95, metalness: 0.03, side: THREE.DoubleSide });

  function box(cx2: number, cy: number, cz2: number, w: number, h: number, d: number, mat: THREE.Material) {
    const g = new THREE.BoxGeometry(w, h, d);
    const m = new THREE.Mesh(g, mat);
    m.position.set(cx2, cy, cz2);
    m.castShadow = true; m.receiveShadow = true;
    return m;
  }

  const slabH = thickness;

  // Back portion (the part that stays) — from cutZ to backZ
  const backW = rightX - leftX;
  const backD = backZ - cutZ;
  if (backD > 0.01) {
    const backCX = (leftX + rightX) / 2;
    const backCZ = (cutZ + backZ) / 2;
    // Top surface
    const topG = new THREE.PlaneGeometry(backW, backD);
    topG.rotateX(-Math.PI / 2);
    const topM = new THREE.Mesh(topG, topMat);
    topM.position.set(backCX, topY, backCZ); topM.receiveShadow = true;
    group.add(topM);

    // Solid back block
    group.add(box(backCX, topY - slabH / 2, backCZ, backW, slabH, backD, sideMat));
  }

  // Left wall (from frontZ to backZ along left edge)
  const lwG = new THREE.PlaneGeometry(fullD, slabH);
  const lw = new THREE.Mesh(lwG, sideMat);
  lw.position.set(leftX, topY - slabH / 2, cz); lw.rotation.y = Math.PI / 2;
  group.add(lw);

  // Right wall
  const rw = new THREE.Mesh(lwG.clone(), sideMat);
  rw.position.set(rightX, topY - slabH / 2, cz); rw.rotation.y = -Math.PI / 2;
  group.add(rw);

  // Cross-section face at cutZ — the exposed cut
  const cutG = new THREE.PlaneGeometry(rightX - leftX, slabH);
  const cutM = new THREE.Mesh(cutG, cutMat);
  cutM.position.set(cx, topY - slabH / 2, cutZ);
  group.add(cutM);

  // Bottom face
  const botG = new THREE.PlaneGeometry(rightX - leftX, fullD);
  botG.rotateX(Math.PI / 2);
  const botM = new THREE.Mesh(botG, bottomMat);
  botM.position.set(cx, botY, cz);
  group.add(botM);

  return group;
}
