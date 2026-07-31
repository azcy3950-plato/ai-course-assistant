// TIN terrain surface from node ground elevations using Delaunay triangulation
import * as THREE from "three";
import Delaunator from "delaunator";

export function buildTINTerrain(
  nodes: { x: number; z: number; ground: number; invert: number }[],
  elevY: (e: number) => number,
  span: number,
  ve: number,
): THREE.Mesh {
  // Filter nodes with valid coordinates
  const pts = nodes.filter(n => isFinite(n.x) && isFinite(n.z) && isFinite(n.ground));

  // Build Delaunay triangulation in XZ plane
  const coords = new Float64Array(pts.length * 2);
  for (let i = 0; i < pts.length; i++) { coords[i * 2] = pts[i].x; coords[i * 2 + 1] = pts[i].z; }
  const delaunay = new Delaunator(coords);

  // Edge expansion: add border points to make terrain extend beyond node cloud
  const margin = span * 0.15;
  let mnX = Infinity, mxX = -Infinity, mnZ = Infinity, mxZ = -Infinity;
  pts.forEach(p => { if (p.x < mnX) mnX = p.x; if (p.x > mxX) mxX = p.x; if (p.z < mnZ) mnZ = p.z; if (p.z > mxZ) mxZ = p.z; });

  // Border points
  const borderPts: [number, number, number][] = [];
  const corners: [number, number][] = [
    [mnX - margin, mnZ - margin], [mxX + margin, mnZ - margin],
    [mxX + margin, mxZ + margin], [mnX - margin, mxZ + margin],
  ];
  // Edge midpoints
  const cx2 = (mnX + mxX) / 2, cz2 = (mnZ + mxZ) / 2;
  for (let i = 0; i < 8; i++) {
    const angle = (i / 8) * Math.PI * 2;
    const r = span * 0.6;
    borderPts.push([cx2 + Math.cos(angle) * r, cz2 + Math.sin(angle) * r, 0]);
  }

  // Build vertices: first pts, then border
  const allPts = pts.map(p => [p.x, p.z, elevY(p.ground)] as [number, number, number]);
  for (const [bx, bz] of borderPts) {
    // Nearest neighbor elevation
    let minD = Infinity, nearZ = 0;
    for (const p of pts) { const d = (p.x - bx) ** 2 + (p.z - bz) ** 2; if (d < minD) { minD = d; nearZ = elevY(p.ground); } }
    allPts.push([bx, bz, nearZ]);
  }

  // Build vertices array
  const verts: number[] = [];
  for (const [x, z, y] of allPts) { verts.push(x, y, z); }

  // Build triangles from Delaunay
  const indices: number[] = [];
  for (let i = 0; i < delaunay.triangles.length; i += 3) {
    const a = delaunay.triangles[i], b = delaunay.triangles[i + 1], c = delaunay.triangles[i + 2];
    // Only include if all three are node points (not border)
    if (a < pts.length && b < pts.length && c < pts.length) {
      indices.push(a, b, c);
    }
  }

  // Also add fan triangles from border to nearest edge nodes
  // Connect border points to nearest node points
  const nodeStart = pts.length;
  for (let bi = 0; bi < borderPts.length; bi++) {
    const bi2 = (bi + 1) % borderPts.length;
    const bx1 = borderPts[bi][0], bz1 = borderPts[bi][1];
    const bx2 = borderPts[bi2][0], bz2 = borderPts[bi2][1];
    // Find nearest node
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
    side: THREE.DoubleSide, flatShading: false,
  });
  const mesh = new THREE.Mesh(geom, mat);
  mesh.receiveShadow = true;
  mesh.castShadow = true;
  mesh.renderOrder = 0;
  mesh.name = "terrain";

  // Store original vertices for clipping
  (mesh as any).__terrainVerts = verts;

  return mesh;
}
