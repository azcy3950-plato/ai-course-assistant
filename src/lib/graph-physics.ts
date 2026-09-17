import type { KnowledgeEdge } from "../types";
import { hashString, type Placed } from "./graph-layout";

export type Point = { x: number; y: number };
export type Bounds = { left: number; right: number; top: number; bottom: number };
export type PhysicsBody = Point & {
  id: string; vx: number; vy: number; anchorX: number; anchorY: number;
  radius: number; offsetY: number;
};
export const nodeRadius = (depth: number) => depth === 0 ? 36 : depth === 1 ? 25 : 19;

// Shared with the renderer so the collision envelope includes every label line.
export function graphLabelLines(label: string): string[] {
  if (!label) return [""];
  if (label.length <= 8) return [label];
  const lines: string[] = [];
  while (label.length) {
    const size = label.length > 12 ? 5 : label.length > 9 ? 4 : label.length;
    lines.push(label.slice(0, size)); label = label.slice(size);
  }
  return lines.slice(0, 3);
}
const clamp = (value: number, min: number, max: number) => min > max ? (min + max) / 2 : Math.max(min, Math.min(max, value));

/** Fixed 60 Hz solver: springs, label-aware collision, drag inertia and soft walls. */
export class GraphPhysics {
  bodies = new Map<string, PhysicsBody>();
  visible = new Set<string>();
  links: { source: string; target: string; length: number }[] = [];
  bounds: Bounds = { left: 0, right: 1400, top: 0, bottom: 900 };
  dragged: string | null = null;
  private released: string | null = null;
  private dragBounds: Bounds | null = null;
  private frames = 0;
  private quietFrames = 0;
  private entering = new Set<string>();

  constructor(placed: Placed[], edges: Pick<KnowledgeEdge, "source" | "target">[]) {
    const chapters = [...new Set(placed.map(p => p.node.chapter).filter(Boolean))].sort();
    const density = Math.max(1, Math.sqrt(placed.length / 40));
    this.bounds = { left: 700 - 700 * density, right: 700 + 700 * density, top: 450 - 450 * density, bottom: 450 + 450 * density };
    placed.forEach(p => {
      const chapter = chapters.indexOf(p.node.chapter);
      const angle = chapter / Math.max(1, chapters.length) * Math.PI * 2 - Math.PI / 2;
      const clustered = chapters.length > 1 && chapter >= 0 && p.depth > 0;
      const x = 700 + (clustered ? Math.cos(angle) * 280 + (p.x - 700) * .43 : p.x - 700) * density;
      const y = 450 + (clustered ? Math.sin(angle) * 235 + (p.y - 450) * .43 : p.y - 450) * density;
      const r = nodeRadius(p.depth), font = p.depth === 0 ? 13 : p.depth === 2 ? 11 : 12;
      const lines = graphLabelLines(p.node.name), bottom = r + 21 + (lines.length - 1) * font * 1.2;
      const offsetY = (bottom - r) / 2;
      const halfWidth = Math.max(...lines.map(l => l.length)) * font / 2;
      // Enclose both the circle and the corners of its label, including glow/padding.
      const radius = Math.max(r + offsetY, Math.hypot(halfWidth, bottom - offsetY)) + 8;
      this.bodies.set(p.node.id, { id: p.node.id, x, y, anchorX: x, anchorY: y, vx: 0, vy: 0, radius, offsetY });
    });
    this.visible = new Set(this.bodies.keys());
    this.links = edges.filter(e => e.source !== e.target && this.bodies.has(e.source) && this.bodies.has(e.target)).map(e => {
      const a = this.bodies.get(e.source)!, b = this.bodies.get(e.target)!;
      return { source: e.source, target: e.target, length: Math.max(a.radius + b.radius + 12, Math.hypot(a.x - b.x, a.y - b.y)) };
    });
  }

  positions() { return new Map([...this.visible].map(id => { const b = this.bodies.get(id)!; return [id, { x: b.x, y: b.y }]; })); }
  wake() { this.frames = 0; this.quietFrames = 0; }
  show(ids: string[], origin?: string) {
    const next = new Set(ids.filter(id => this.bodies.has(id)));
    const anchor = origin ? this.bodies.get(origin) : undefined;
    for (const id of next) {
      if (this.visible.has(id) || !anchor || id === origin) continue;
      const b = this.bodies.get(id)!;
      const angle = Math.atan2(b.anchorY - anchor.y, b.anchorX - anchor.x);
      b.x = anchor.x + Math.cos(angle) * 30; b.y = anchor.y + Math.sin(angle) * 30;
      b.vx = Math.cos(angle) * 2; b.vy = Math.sin(angle) * 2;
      this.entering.add(id);
    }
    this.visible = next;
    if (this.dragged && !next.has(this.dragged)) this.release({ x: 0, y: 0 }, true);
    this.wake();
  }
  begin(id: string, bounds: Bounds) {
    if (!this.visible.has(id)) return;
    this.entering.delete(id); this.dragged = id; this.released = null; this.dragBounds = bounds; this.wake();
    const b = this.bodies.get(id)!; b.vx = b.vy = 0;
  }
  move(point: Point) {
    const b = this.dragged ? this.bodies.get(this.dragged) : undefined;
    if (!b || !this.dragBounds) return;
    const bounds = this.dragBounds;
    const soft = (value: number, min: number, max: number) => {
      if (max <= min) return (min + max) / 2;
      const zone = Math.min(28, (max - min) / 4);
      if (value < min + zone) return min + zone * Math.exp(Math.max(-30, (value - min - zone) / zone));
      if (value > max - zone) return max - zone * Math.exp(Math.max(-30, (max - zone - value) / zone));
      return value;
    };
    b.x = soft(point.x, bounds.left + b.radius, bounds.right - b.radius);
    b.y = soft(point.y, bounds.top + b.radius - b.offsetY, bounds.bottom - b.radius - b.offsetY);
    b.vx = b.vy = 0;
  }
  release(velocity: Point, reduced = false) {
    const b = this.dragged ? this.bodies.get(this.dragged) : undefined;
    this.dragged = null;
    if (!b) return;
    b.vx = reduced ? 0 : clamp(velocity.x, -12, 12); b.vy = reduced ? 0 : clamp(velocity.y, -12, 12);
    // Preserve free placement with a short glide, rather than returning to the old layout.
    b.anchorX = b.x + b.vx * 3; b.anchorY = b.y + b.vy * 3;
    this.released = b.id;
    this.links.forEach(l => {
      if (l.source !== b.id && l.target !== b.id) return;
      const a = this.bodies.get(l.source)!, t = this.bodies.get(l.target)!;
      l.length = Math.max(a.radius + t.radius + 12, Math.hypot(a.x - t.x, a.y - t.y));
    });
    this.wake();
  }
  stop() { for (const b of this.bodies.values()) b.vx = b.vy = 0; }
  settle() { for (let i = 0; i < 240; i++) this.step(); this.stop(); }

  step(): boolean {
    const nodes = [...this.visible].map(id => this.bodies.get(id)!);
    const before = nodes.map(b => ({ x: b.x, y: b.y }));
    const heat = this.dragged ? 1 : Math.max(0, 1 - this.frames / 180);
    for (const b of nodes) {
      if (b.id === this.dragged) continue;
      const attraction = this.entering.has(b.id) ? .06 : .007;
      b.vx += (b.anchorX - b.x) * attraction * heat; b.vy += (b.anchorY - b.y) * attraction * heat;
    }
    for (const l of this.links) {
      if (!this.visible.has(l.source) || !this.visible.has(l.target)) continue;
      const a = this.bodies.get(l.source)!, b = this.bodies.get(l.target)!;
      const dx = b.x - a.x, dy = b.y - a.y, distance = Math.hypot(dx, dy) || 1;
      const force = clamp((distance - l.length) * .012, -2.5, 2.5) * heat;
      if (a.id !== this.dragged) { a.vx += dx / distance * force; a.vy += dy / distance * force; }
      if (b.id !== this.dragged) { b.vx -= dx / distance * force; b.vy -= dy / distance * force; }
    }
    for (const b of nodes) {
      if (b.id === this.dragged) continue;
      const speed = this.entering.has(b.id) ? 28 : 14;
      b.vx = clamp(b.vx * .8, -speed, speed); b.vy = clamp(b.vy * .8, -speed, speed);
      b.x += b.vx; b.y += b.vy;
    }
    // Several collision passes prevent penetration after a fast pointer movement.
    for (let pass = 0; pass < 4; pass++) {
      for (let i = 0; i < nodes.length; i++) for (let j = i + 1; j < nodes.length; j++) {
        const a = nodes[i], b = nodes[j];
        let dx = b.x - a.x, dy = b.y + b.offsetY - a.y - a.offsetY, distance = Math.hypot(dx, dy);
        if (distance >= a.radius + b.radius) continue;
        if (distance < .001) { const angle = hashString(a.id + b.id) % 360 * Math.PI / 180; dx = Math.cos(angle); dy = Math.sin(angle); distance = 1; }
        const nx = dx / distance, ny = dy / distance, overlap = a.radius + b.radius - distance + .01;
        const shareA = a.id === this.dragged ? 0 : b.id === this.dragged ? 1 : .5, shareB = 1 - shareA;
        a.x -= nx * overlap * shareA; a.y -= ny * overlap * shareA;
        b.x += nx * overlap * shareB; b.y += ny * overlap * shareB;
        const closing = (b.vx - a.vx) * nx + (b.vy - a.vy) * ny;
        if (closing < 0) { const impulse = -closing * .6; a.vx -= nx * impulse * shareA; a.vy -= ny * impulse * shareA; b.vx += nx * impulse * shareB; b.vy += ny * impulse * shareB; }
      }
      for (const b of nodes) {
        if (b.id === this.dragged) continue;
        // Zooming never squeezes all nodes: viewport walls affect only the dragged node.
        const limits = this.dragBounds && b.id === this.released ? this.dragBounds : this.bounds;
        const x = clamp(b.x, limits.left + b.radius, limits.right - b.radius);
        const y = clamp(b.y, limits.top + b.radius - b.offsetY, limits.bottom - b.radius - b.offsetY);
        if (x !== b.x) { b.x = x; b.vx *= -.2; b.anchorX = x; }
        if (y !== b.y) { b.y = y; b.vy *= -.2; b.anchorY = y; }
      }
    }
    const movement = nodes.reduce((max, b, i) => Math.max(max, Math.abs(b.x - before[i].x) + Math.abs(b.y - before[i].y)), 0);
    this.frames++;
    if (this.frames >= 240) this.entering.clear();
    this.quietFrames = movement < .06 ? this.quietFrames + 1 : 0;
    return Boolean(this.dragged) || (this.frames < 240 && (this.frames < 180 || this.quietFrames < 16));
  }
}