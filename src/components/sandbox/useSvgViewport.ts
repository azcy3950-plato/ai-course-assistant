'use client';

import { useEffect, useRef, useState } from 'react';
import type { PointerEvent as ReactPointerEvent, MouseEvent as ReactMouseEvent } from 'react';
import { Bounds, Camera, INITIAL_CAMERA, constrainCamera, fitCamera, zoomAround } from '@/lib/sandbox/viewport';

export type ViewRequest = { sequence: number; zone: number | null };
const THRESHOLD = 5; // CSS pixels, independent of zoom and display density.
const FORM = 'input,textarea,select,button,a,[contenteditable]:not([contenteditable="false"]),[role="textbox"],[role="combobox"],[role="slider"]';
const MOVEMENT: Record<string, [number, number]> = {
  ArrowLeft: [-1, 0], KeyA: [-1, 0], ArrowRight: [1, 0], KeyD: [1, 0],
  ArrowUp: [0, -1], KeyW: [0, -1], ArrowDown: [0, 1], KeyS: [0, 1],
};
type Gesture = { id: number; x: number; y: number; camera: Camera; scale: number; allowed: boolean; space: boolean; moved: boolean };

export default function useSvgViewport({ bounds, targetBounds, request, disabled, onReset }: {
  bounds: Bounds; targetBounds: Bounds; request: ViewRequest; disabled: boolean; onReset?: () => void;
}) {
  const svg = useRef<SVGSVGElement>(null);
  const [camera, setCamera] = useState<Camera>({ ...INITIAL_CAMERA });
  const [dragging, setDragging] = useState(false);
  const [spaceDown, setSpaceDown] = useState(false);
  const current = useRef(camera), gesture = useRef<Gesture | null>(null), space = useRef(false);
  const suppressClick = useRef(false), keys = useRef(new Set<string>()), shift = useRef(false);
  const frame = useRef(0), lastTime = useRef(0);
  const config = useRef({ bounds, targetBounds, disabled, onReset });
  config.current = { bounds, targetBounds, disabled, onReset };

  function blocked() {
    return config.current.disabled || !!document.querySelector('[aria-modal="true"],dialog[open]');
  }
  function point(x: number, y: number) {
    const matrix = svg.current?.getScreenCTM();
    return matrix ? new DOMPoint(x, y).matrixTransform(matrix.inverse()) : null;
  }
  function viewport(): Bounds | null {
    const rect = svg.current?.getBoundingClientRect();
    if (!rect?.width || !rect.height) return null;
    const a = point(rect.left, rect.top), b = point(rect.right, rect.bottom);
    return a && b ? [a.x, a.y, b.x, b.y] : null;
  }
  function update(next: Camera) {
    const visible = viewport();
    current.current = visible ? constrainCamera(next, config.current.bounds, visible) : next;
    setCamera(current.current);
  }
  function focus() { if (!blocked()) svg.current?.focus({ preventScroll: true }); }
  function zoomBy(factor: number, anchor?: { x: number; y: number }) {
    if (blocked() || gesture.current) return;
    const visible = viewport();
    if (!visible) return;
    update(zoomAround(current.current, factor, anchor || { x: (visible[0] + visible[2]) / 2, y: (visible[1] + visible[3]) / 2 }));
  }
  function endGesture(cancel = false) {
    const g = gesture.current;
    gesture.current = null;
    if (g) {
      suppressClick.current = g.moved || g.space || cancel;
      if (svg.current?.hasPointerCapture(g.id)) svg.current.releasePointerCapture(g.id);
    }
    setDragging(false);
  }
  function stop() {
    keys.current.clear(); shift.current = false; space.current = false; setSpaceDown(false);
    cancelAnimationFrame(frame.current); frame.current = 0; lastTime.current = 0;
    endGesture(true);
  }
  function reset() {
    if (blocked()) return;
    stop(); config.current.onReset?.(); update({ ...INITIAL_CAMERA }); focus();
  }
  function onPointerDown(e: ReactPointerEvent<SVGSVGElement>) {
    if (blocked() || e.button !== 0 || !e.isPrimary || gesture.current) return;
    focus(); suppressClick.current = false;
    const hit = (e.target as Element).closest('[data-patch]');
    const matrix = e.currentTarget.getScreenCTM();
    if (!matrix) return;
    gesture.current = { id: e.pointerId, x: e.clientX, y: e.clientY, camera: current.current,
      scale: Math.hypot(matrix.a, matrix.b), allowed: !hit || space.current, space: space.current, moved: false };
    // Capture on the root only once dragging starts, preserving native object clicks.
    if (space.current) e.preventDefault();
  }
  function onPointerMove(e: ReactPointerEvent<SVGSVGElement>) {
    const g = gesture.current;
    if (!g || e.pointerId !== g.id) return;
    if (!(e.buttons & 1)) { endGesture(true); return; }
    const dx = e.clientX - g.x, dy = e.clientY - g.y;
    if (!g.moved && Math.hypot(dx, dy) < THRESHOLD) return;
    g.moved = true; suppressClick.current = true;
    if (!g.allowed || blocked()) return;
    e.preventDefault();
    if (!e.currentTarget.hasPointerCapture(g.id)) e.currentTarget.setPointerCapture(g.id);
    setDragging(true);
    update({ ...g.camera, x: g.camera.x + dx / g.scale, y: g.camera.y + dy / g.scale });
  }
  function onClickCapture(e: ReactMouseEvent<SVGSVGElement>) {
    if (blocked() || suppressClick.current || space.current) { e.preventDefault(); e.stopPropagation(); }
  }
  function canDrop() { return !blocked() && !gesture.current && !space.current; }

  useEffect(() => {
    const el = svg.current;
    if (!el) return;
    function wheel(e: WheelEvent) {
      if (blocked() || e.ctrlKey || e.metaKey || e.altKey) return;
      e.preventDefault(); // React's delegated wheel handler can be passive in Chromium.
      if (!e.deltaY) return;
      const anchor = point(e.clientX, e.clientY);
      const pixels = e.deltaY * (e.deltaMode === 1 ? 16 : e.deltaMode === 2 ? el!.clientHeight : 1);
      if (anchor) zoomBy(Math.exp(-Math.max(-160, Math.min(160, pixels)) * .002), anchor);
    }
    function animate(time: number) {
      if (blocked() || document.activeElement !== el || !keys.current.size) { stop(); return; }
      const dt = lastTime.current ? Math.min(40, time - lastTime.current) / 1000 : 1 / 60;
      lastTime.current = time;
      let dx = 0, dy = 0;
      for (const key of keys.current) { dx += MOVEMENT[key][0]; dy += MOVEMENT[key][1]; }
      const norm = Math.max(1, Math.hypot(dx, dy)), m = el!.getScreenCTM();
      if (m && !gesture.current) {
        const speed = 300 * (shift.current ? 3 : 1) * dt / Math.hypot(m.a, m.b);
        update({ ...current.current, x: current.current.x + dx / norm * speed, y: current.current.y + dy / norm * speed });
      }
      frame.current = requestAnimationFrame(animate);
    }
    function keydown(e: KeyboardEvent) {
      if (blocked() || document.activeElement !== el || (e.target as Element).closest(FORM) || e.isComposing) return;
      if (e.ctrlKey || e.metaKey || e.altKey) { stop(); return; }
      shift.current = e.shiftKey;
      if (e.code === 'Escape') { e.preventDefault(); stop(); return; }
      if (e.code === 'Space') { e.preventDefault(); space.current = true; setSpaceDown(true); return; }
      if (MOVEMENT[e.code]) {
        e.preventDefault(); keys.current.add(e.code);
        if (!frame.current) frame.current = requestAnimationFrame(animate);
      } else if (e.key === '+' || e.key === '=' || e.key === '-') {
        e.preventDefault(); zoomBy(e.key === '-' ? 1 / 1.2 : 1.2);
      } else if (e.code === 'KeyR') { e.preventDefault(); if (!e.repeat) reset(); }
    }
    function keyup(e: KeyboardEvent) {
      keys.current.delete(e.code); shift.current = e.shiftKey;
      if (e.code === 'Space') { space.current = false; setSpaceDown(false); if (gesture.current?.space) endGesture(true); }
      if (!keys.current.size) { cancelAnimationFrame(frame.current); frame.current = 0; lastTime.current = 0; }
    }
    function pointerup(e: PointerEvent) { if (gesture.current?.id === e.pointerId) endGesture(e.type === 'pointercancel'); }
    function visibility() { if (document.hidden) stop(); }
    el.addEventListener('wheel', wheel, { passive: false });
    el.addEventListener('keydown', keydown);
    el.addEventListener('blur', stop);
    window.addEventListener('keyup', keyup);
    window.addEventListener('pointerup', pointerup);
    window.addEventListener('pointercancel', pointerup);
    window.addEventListener('blur', stop);
    document.addEventListener('visibilitychange', visibility);
    return () => {
      stop(); el.removeEventListener('wheel', wheel); el.removeEventListener('keydown', keydown); el.removeEventListener('blur', stop);
      window.removeEventListener('keyup', keyup); window.removeEventListener('pointerup', pointerup); window.removeEventListener('pointercancel', pointerup);
      window.removeEventListener('blur', stop); document.removeEventListener('visibilitychange', visibility);
    };
  }, []);
  useEffect(() => { if (disabled) stop(); }, [disabled]);
  useEffect(() => {
    endGesture(true);
    const visible = viewport();
    if (request.zone !== null && visible) update(fitCamera(config.current.targetBounds, visible));
    else update({ ...INITIAL_CAMERA });
    // Only an explicit navigation request resets the camera; ordinary data/selection changes do not.
  }, [request.sequence]);

  return { svg, camera, dragging, spaceDown, focus, zoomBy, reset, canDrop,
    transform: `translate(${camera.x} ${camera.y}) scale(${camera.zoom})`,
    handlers: { onPointerDown, onPointerMove, onClickCapture, onLostPointerCapture: () => endGesture(true) },
  };
}
