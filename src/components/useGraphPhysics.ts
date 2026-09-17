"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import type { KnowledgeEdge } from "@/types";
import type { Placed } from "@/lib/graph-layout";
import { GraphPhysics, type Bounds, type Point } from "@/lib/graph-physics";

export function useGraphPhysics(placed: Placed[], edges: KnowledgeEdge[], ids: string[], origin: string | undefined, paused: boolean) {
  const solver = useRef<GraphPhysics | null>(null);
  const frame = useRef<number | null>(null);
  const reduced = useRef(false);
  const [reducedMotion, setReducedMotion] = useState(false);
  const [positions, setPositions] = useState<Map<string, Point>>(new Map());
  const positionRef = useRef(positions);
  const fitPositionRef = useRef(positions);
  const expanding = useRef(false);
  const current = useRef({ placed, edges, ids, origin, paused });
  current.current = { placed, edges, ids, origin, paused };
  // Progress/name refreshes must not restart motion or undo manual placement.
  const structure = JSON.stringify([placed.map(p => [p.node.id, p.node.chapter, p.node.name, p.depth]), edges.map(e => [e.source, e.target])]);
  const visibleKey = ids.join("\u0000");
  const publish = useCallback(() => {
    if (!solver.current) return;
    const next = solver.current.positions(); positionRef.current = next; if (!expanding.current) fitPositionRef.current = next; setPositions(next);
  }, []);
  const stop = useCallback(() => {
    if (frame.current !== null) cancelAnimationFrame(frame.current);
    frame.current = null; solver.current?.stop();
  }, []);
  const start = useCallback(() => {
    if (frame.current !== null) cancelAnimationFrame(frame.current);
    frame.current = null;
    const sim = solver.current; if (!sim) return;
    if (reduced.current) { if (sim.dragged) { for (let i = 0; i < 8; i++) sim.step(); sim.stop(); } else sim.settle(); publish(); return; }
    if (document.hidden) { sim.stop(); return; }
    let previous = performance.now(), accumulator = 0;
    const tick = (now: number) => {
      accumulator += Math.min(50, now - previous); previous = now;
      let active = true;
      while (accumulator >= 1000 / 60) { active = sim.step(); accumulator -= 1000 / 60; if (!active) break; }
      publish();
      if (active) frame.current = requestAnimationFrame(tick);
      else { sim.stop(); frame.current = null; expanding.current = false; fitPositionRef.current = positionRef.current; }
    };
    frame.current = requestAnimationFrame(tick);
  }, [publish]);

  useEffect(() => {
    const media = window.matchMedia("(prefers-reduced-motion: reduce)");
    const update = () => { reduced.current = media.matches; setReducedMotion(media.matches); if (media.matches) { stop(); solver.current?.settle(); publish(); } };
    update(); media.addEventListener("change", update);
    const visibility = () => { if (document.hidden) stop(); };
    document.addEventListener("visibilitychange", visibility);
    return () => { stop(); media.removeEventListener("change", update); document.removeEventListener("visibilitychange", visibility); };
  }, [stop, publish]);

  useEffect(() => {
    stop();
    const data = current.current, previous = solver.current;
    const sim = new GraphPhysics(data.placed, data.edges);
    sim.settle();
    fitPositionRef.current = sim.positions();
    for (const body of sim.bodies.values()) { body.anchorX = body.x; body.anchorY = body.y; }
    expanding.current = true;
    // Keep positions when graph expansion adds nodes; unrelated networks start cleanly.
    let retained = 0;
    for (const [id, body] of sim.bodies) {
      const old = previous?.bodies.get(id);
      if (old) { Object.assign(body, { x: old.x, y: old.y, anchorX: old.anchorX, anchorY: old.anchorY }); retained++; }
    }
    solver.current = sim;
    if (retained && previous) { sim.visible = new Set([...previous.visible].filter(id => sim.bodies.has(id))); sim.show(data.ids, data.origin || [...previous.visible][0]); }
    else { sim.settle(); sim.show(data.ids); }
    if (data.paused || !retained) { sim.settle(); expanding.current = false; publish(); } else start();
    return stop;
  }, [structure, start, stop, publish]);

  useEffect(() => {
    const data = current.current, sim = solver.current; if (!sim) return;
    const changed = data.ids.length !== sim.visible.size || data.ids.some(id => !sim.visible.has(id));
    if (!changed) return;
    fitPositionRef.current = new Map(data.ids.map(id => { const b = sim.bodies.get(id)!; return [id, { x: b.anchorX, y: b.anchorY }]; }));
    expanding.current = true;
    sim.show(data.ids, data.origin);
    if (data.paused && !data.origin) { sim.settle(); publish(); } else start();
  }, [visibleKey, publish, start]);
  useEffect(() => { if (paused) stop(); }, [paused, stop]);

  const begin = useCallback((id: string, bounds: Bounds) => { expanding.current = false; solver.current?.begin(id, bounds); start(); }, [start]);
  const move = useCallback((point: Point) => {
    solver.current?.move(point);
    if (reduced.current) { for (let i = 0; i < 8; i++) solver.current?.step(); solver.current?.stop(); }
    publish();
  }, [publish]);
  const release = useCallback((velocity: Point, cancelled = false) => {
    solver.current?.release(velocity, reduced.current || cancelled); start();
  }, [start]);
  const reset = useCallback(() => {
    stop(); expanding.current = false; const data = current.current; const sim = new GraphPhysics(data.placed, data.edges);
    solver.current = sim; sim.settle(); sim.show(data.ids); publish(); start();
  }, [start, stop, publish]);
  return { positions, positionRef, fitPositionRef, reducedMotion, begin, move, release, reset };
}