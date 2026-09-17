// SVG view-only coordinates; never write these values into the campus model.
export type Bounds = [number, number, number, number];
export type Camera = { x: number; y: number; zoom: number };
export const MIN_ZOOM = 0.5;
export const MAX_ZOOM = 16;
export const INITIAL_CAMERA: Camera = { x: 0, y: 0, zoom: 1 };
const clamp = (n: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, n));

export function boundsOf(points: readonly (readonly number[])[]): Bounds {
  const b: Bounds = [Infinity, Infinity, -Infinity, -Infinity];
  for (const [x, y] of points) { b[0] = Math.min(b[0], x); b[1] = Math.min(b[1], y); b[2] = Math.max(b[2], x); b[3] = Math.max(b[3], y); }
  return points.length ? b : [0, 0, 1, 1];
}

export function paddedViewBox(b: Bounds): string {
  const pad = Math.max(12, Math.max(b[2] - b[0], b[3] - b[1]) * .06);
  return `${b[0] - pad} ${b[1] - pad} ${b[2] - b[0] + pad * 2} ${b[3] - b[1] + pad * 2}`;
}

export function zoomAround(camera: Camera, factor: number, anchor: { x: number; y: number }): Camera {
  const zoom = clamp(camera.zoom * factor, MIN_ZOOM, MAX_ZOOM);
  const ratio = zoom / camera.zoom;
  return { zoom, x: anchor.x - (anchor.x - camera.x) * ratio, y: anchor.y - (anchor.y - camera.y) * ratio };
}

export function fitCamera(target: Bounds, viewport: Bounds): Camera {
  const zoom = clamp(Math.min((viewport[2] - viewport[0]) / Math.max(1, target[2] - target[0]), (viewport[3] - viewport[1]) / Math.max(1, target[3] - target[1])) * .86, MIN_ZOOM, MAX_ZOOM);
  return { zoom, x: (viewport[0] + viewport[2] - zoom * (target[0] + target[2])) / 2, y: (viewport[1] + viewport[3] - zoom * (target[1] + target[3])) / 2 };
}

export function constrainCamera(camera: Camera, scene: Bounds, viewport: Bounds): Camera {
  const { zoom } = camera;
  // Retain a visible portion of the campus even after a long drag/key hold.
  const keepX = Math.min((viewport[2] - viewport[0]) * .2, (scene[2] - scene[0]) * zoom * .5);
  const keepY = Math.min((viewport[3] - viewport[1]) * .2, (scene[3] - scene[1]) * zoom * .5);
  return { zoom,
    x: clamp(camera.x, viewport[0] + keepX - scene[2] * zoom, viewport[2] - keepX - scene[0] * zoom),
    y: clamp(camera.y, viewport[1] + keepY - scene[3] * zoom, viewport[3] - keepY - scene[1] * zoom),
  };
}
