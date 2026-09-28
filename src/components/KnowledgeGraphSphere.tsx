"use client";

import { forwardRef, useEffect, useImperativeHandle, useRef, useState } from "react";
import * as THREE from "three";
import type { OrbitControls } from "three/examples/jsm/controls/OrbitControls.js";
import type { ForceGraph3DInstance, LinkObject } from "3d-force-graph";
import type { KnowledgeEdge, KnowledgeGraph, KnowledgeNode } from "@/types";
import { sphereLayout, type SphereNode } from "@/lib/graph-sphere";

type Link = LinkObject<SphereNode> & { edge: KnowledgeEdge };
export type SphereHandle = { fit(ids?: string[]): void; reset(): void };
type Props = {
  graph: KnowledgeGraph; visibleIds: string[]; edges: KnowledgeEdge[];
  selectedId?: string; focusIds?: string[]; rotating: boolean; labels: boolean;
  color(node: KnowledgeNode): string;
  onSelect(node: KnowledgeNode): void; onExpand(node: KnowledgeNode): void;
  onHover(node: KnowledgeNode | null): void; onRelation(edge: KnowledgeEdge): void;
};

export default forwardRef<SphereHandle, Props>(function KnowledgeGraphSphere(props, ref) {
  const host = useRef<HTMLDivElement>(null);
  const engine = useRef<ForceGraph3DInstance<SphereNode, Link> | null>(null);
  const latest = useRef(props); latest.current = props;
  const refresh = useRef<() => void>(() => {});
  const fit = useRef<(ids?: string[]) => void>(() => {});
  const rebuild = useRef<() => void>(() => {});
  const previousVisible = useRef("");
  const [failure, setFailure] = useState(false);
  const structure = JSON.stringify([props.graph.nodes.map(n => [n.id, n.chapter]), props.graph.edges.map(e => [e.id, e.source, e.target])]);

  useImperativeHandle(ref, () => ({ fit: ids => fit.current(ids), reset: () => rebuild.current() }), []);

  useEffect(() => {
    const element = host.current!;
    let cancelled = false, cleanup = () => {};
    Promise.all([import("3d-force-graph"), import("three-spritetext"), import("d3-force-3d")]).then(([{ default: ForceGraph }, { default: SpriteText }, forces]) => {
      if (cancelled) return;
      const graph = new ForceGraph(element, { controlType: "orbit", rendererConfig: { antialias: true, alpha: true, preserveDrawingBuffer: true } }) as unknown as ForceGraph3DInstance<SphereNode, Link>;
      engine.current = graph;
      let nodes = sphereLayout(latest.current.graph);
      let hovered: string | null = null, interacting = false, suspendedUntil = 0, dragging: string | null = null;
      let clickTimer: ReturnType<typeof setTimeout> | undefined;
      let frame = 0, lastClick = "";
      const labels = new Map<string, InstanceType<typeof SpriteText>>();
      const meshes = new Map<string, THREE.Mesh<THREE.SphereGeometry, THREE.MeshStandardMaterial>>();
      const relationLabels = new Set<InstanceType<typeof SpriteText>>();
      const geometry = new THREE.SphereGeometry(1, 16, 12);
      const disposables: Array<THREE.Material | THREE.Texture> = [];
      const media = window.matchMedia("(prefers-reduced-motion: reduce)");
      const controls = graph.controls() as OrbitControls;
      controls.enableDamping = true; controls.dampingFactor = .12;
      controls.autoRotateSpeed = .65; controls.minDistance = 80; controls.maxDistance = 2600;
      const startInteraction = () => { interacting = true; };
      const endInteraction = () => { interacting = false; suspendedUntil = performance.now() + 250; };
      controls.addEventListener("start", startInteraction); controls.addEventListener("end", endInteraction);
      // The graph library emits a pointerId=0 release after dragging. OrbitControls
      // r185 needs the real pointer-up, which follows it with the correct ID.
      const ignoreSyntheticRelease = (event: PointerEvent) => {
        if (!event.isTrusted && event.pointerId === 0 && event.pointerType === "touch" && event.target === document) event.stopImmediatePropagation();
      };
      document.addEventListener("pointerup", ignoreSyntheticRelease, true);
      const shell = new THREE.Group();
      const shellRadius = Math.max(100, ...nodes.map(n => Math.hypot(n.ax, n.ay, n.az))) * 1.06;
      const shellMaterial = new THREE.LineBasicMaterial({ color: "#9ab9dc", transparent: true, opacity: .16, depthWrite: false });
      const shellGeometries: THREE.BufferGeometry[] = [];
      for (let ring = 0; ring < 3; ring++) {
        const points = Array.from({ length: 160 }, (_, i) => {
          const angle = i / 160 * Math.PI * 2;
          return new THREE.Vector3(Math.cos(angle) * shellRadius, Math.sin(angle) * shellRadius, 0);
        });
        const ringGeometry = new THREE.BufferGeometry().setFromPoints(points);
        shellGeometries.push(ringGeometry);
        const line = new THREE.LineLoop(ringGeometry, shellMaterial);
        if (ring === 1) line.rotation.y = Math.PI / 2;
        if (ring === 2) line.rotation.x = Math.PI / 2;
        line.raycast = () => {};
        shell.add(line);
      }
      shell.rotation.set(.18, 0, .24);
      graph.scene().add(shell);
      graph.backgroundColor("#f8fbff").showNavInfo(false).nodeLabel(() => "").linkLabel(() => "")
        .nodeThreeObject(node => {
          const group = new THREE.Group();
          const material = new THREE.MeshStandardMaterial({ color: latest.current.color(node.node), roughness: .3, metalness: .12 });
          disposables.push(material);
          const sphere = new THREE.Mesh(geometry, material);
          const size = node.depth === 0 ? 9 : node.depth === 1 ? 5.5 : 3.2;
          sphere.scale.setScalar(size); group.add(sphere); meshes.set(node.id, sphere);
          const label = new SpriteText(node.node.name, node.depth === 0 ? 12 : 10, "#30415f");
          label.fontFace = "Microsoft YaHei, sans-serif"; label.fontWeight = node.depth === 0 ? "700" : "500";
          label.backgroundColor = "rgba(248,251,255,0.9)"; label.padding = [1, .5]; label.borderRadius = 2;
          label.position.y = -size - 8; label.material.depthWrite = false; label.material.depthTest = false;
          label.raycast = () => {};
          labels.set(node.id, label); group.add(label);
          if (label.material.map) disposables.push(label.material.map); disposables.push(label.material);
          return group;
        })
        .linkColor(link => {
          const source = typeof link.source === "object" ? link.source : nodes.find(n => n.id === link.source);
          return source ? new THREE.Color(latest.current.color(source.node)).lerp(new THREE.Color("#a4bad2"), .65).getStyle() : "#a4bad2";
        }).linkOpacity(.38).linkWidth(.65).linkCurvature(.08).linkHoverPrecision(2)
        .linkThreeObjectExtend(true).linkThreeObject(link => {
          const label = new SpriteText(link.edge.label || link.edge.relation, 6, "#60738e");
          label.backgroundColor = "#f8fbff"; label.padding = 1; label.visible = latest.current.labels;
          label.raycast = () => {}; relationLabels.add(label);
          if (label.material.map) disposables.push(label.material.map); disposables.push(label.material);
          return label;
        })
        .linkPositionUpdate((object, { start, end }) => { object.position.copy(new THREE.Vector3(start.x, start.y, start.z).add(new THREE.Vector3(end.x, end.y, end.z)).multiplyScalar(.5)); })
        .d3Force("charge", null).d3Force("center", null)
        .d3Force("x", forces.forceX<SphereNode>(n => n.ax).strength(.1))
        .d3Force("y", forces.forceY<SphereNode>(n => n.ay).strength(.1))
        .d3Force("z", forces.forceZ<SphereNode>(n => n.az).strength(.1))
        .d3VelocityDecay(.38).cooldownTicks(140)
        .onNodeHover(node => { hovered = node?.id || null; latest.current.onHover(node?.node || null); })
        .onNodeClick(node => {
          if (clickTimer && lastClick === node.id) { clearTimeout(clickTimer); clickTimer = undefined; latest.current.onExpand(node.node); return; }
          if (clickTimer) clearTimeout(clickTimer);
          lastClick = node.id;
          clickTimer = setTimeout(() => { clickTimer = undefined; latest.current.onSelect(node.node); }, 230);
        })
        .onNodeRightClick((node, event) => { event.preventDefault(); latest.current.onExpand(node.node); })
        .onLinkClick(link => latest.current.onRelation(link.edge))
        .onNodeDrag((node, delta) => {
          dragging = node.id;
          if (media.matches) return;
          const neighbors = new Set(latest.current.edges.flatMap(e => e.source === node.id ? [e.target] : e.target === node.id ? [e.source] : []));
          nodes.forEach(n => {
            if (!neighbors.has(n.id)) return;
            n.fx = n.fy = n.fz = undefined;
            n.x = n.ax + THREE.MathUtils.clamp(n.x - n.ax + delta.x * .1, -7, 7);
            n.y = n.ay + THREE.MathUtils.clamp(n.y - n.ay + delta.y * .1, -7, 7);
            n.z = n.az + THREE.MathUtils.clamp(n.z - n.az + delta.z * .1, -7, 7);
          });
        })
        .onNodeDragEnd(node => {
          dragging = null; interacting = false; suspendedUntil = performance.now() + 250;
          node.fx = node.fy = node.fz = undefined;
          if (media.matches) { node.x = node.fx = node.ax; node.y = node.fy = node.ay; node.z = node.fz = node.az; }
          graph.d3ReheatSimulation();
        })
        .onEngineStop(() => nodes.forEach(n => { if (n.id !== dragging) { n.x = n.fx = n.ax; n.y = n.fy = n.ay; n.z = n.fz = n.az; } }));

      // Keep the library's link force to resolve endpoint IDs, without moving the fixed layout.
      graph.d3Force("link")!.strength(0);
      fit.current = (ids = []) => {
        const active = graph.graphData().nodes;
        if (!active.length) return;
        const targets = ids.length ? active.filter(n => ids.includes(n.id)) : active;
        const chosen = targets.length ? targets : active;
        const center = chosen.reduce((v, n) => v.add(new THREE.Vector3(n.x, n.y, n.z)), new THREE.Vector3()).divideScalar(chosen.length);
        const radius = Math.max(chosen.length === 1 ? 100 : 70, ...chosen.map(n => new THREE.Vector3(n.x, n.y, n.z).distanceTo(center))) + 30;
        const camera = graph.camera() as THREE.PerspectiveCamera;
        const halfFov = Math.min(THREE.MathUtils.degToRad(camera.fov / 2), Math.atan(Math.tan(THREE.MathUtils.degToRad(camera.fov / 2)) * camera.aspect));
        const distance = radius / Math.sin(halfFov) * 1.08;
        const direction = camera.position.clone().sub(controls.target).normalize();
        graph.cameraPosition(center.clone().addScaledVector(direction, distance), center, media.matches ? 0 : 450);
      };
      refresh.current = () => {
        const p = latest.current, visible = new Set(p.visibleIds);
        shell.visible = visible.size > 1 && visible.size === nodes.length;
        nodes.forEach(n => { const updated = p.graph.nodes.find(item => item.id === n.id); if (updated) n.node = updated; });
        graph.graphData({ nodes: nodes.filter(n => visible.has(n.id)), links: p.edges.map(edge => ({ source: edge.source, target: edge.target, edge })) });
        meshes.forEach((mesh, id) => { const node = nodes.find(n => n.id === id); if (node) mesh.material.color.set(p.color(node.node)); });
        relationLabels.forEach(label => { label.visible = p.labels; });
      };
      rebuild.current = () => {
        const clean = new Map(sphereLayout(latest.current.graph).map(n => [n.id, n]));
        nodes.forEach(n => Object.assign(n, clean.get(n.id)));
        graph.cameraPosition({ x: 0, y: 35, z: 650 }, { x: 0, y: 0, z: 0 });
        refresh.current(); fit.current();
      };
      const resize = () => {
        const rect = element.getBoundingClientRect();
        if (!rect.width || !rect.height) return;
        graph.width(rect.width).height(rect.height);
        const camera = graph.camera() as THREE.PerspectiveCamera;
        camera.aspect = rect.width / rect.height; camera.updateProjectionMatrix();
        fit.current();
      };
      const observer = new ResizeObserver(resize); observer.observe(element);
      graph.cameraPosition({ x: 0, y: 35, z: 650 });
      refresh.current(); resize();
      const visibility = () => { if (document.hidden) graph.pauseAnimation(); else graph.resumeAnimation(); };
      document.addEventListener("visibilitychange", visibility);
      const draw = () => {
        if (cancelled) return;
        const p = latest.current;
        const autoRotate = p.rotating && !media.matches && !interacting && !dragging && performance.now() > suspendedUntil;
        const stopping = controls.autoRotate && !autoRotate;
        controls.autoRotate = autoRotate;
        if (stopping) { controls.enableDamping = false; controls.update(0); controls.enableDamping = true; }
        element.dataset.rotating = String(controls.autoRotate);
        // Greedy screen-space label placement prevents front/back text from piling up.
        const camera = graph.camera() as THREE.PerspectiveCamera;
        const active = graph.graphData().nodes.slice().sort((a, b) => Number(b.id === hovered || b.id === p.selectedId) - Number(a.id === hovered || a.id === p.selectedId) || a.depth - b.depth || new THREE.Vector3(a.x, a.y, a.z).distanceToSquared(camera.position) - new THREE.Vector3(b.x, b.y, b.z).distanceToSquared(camera.position));
        const boxes: Array<{ x: number; y: number; w: number; h: number }> = [];
        for (const node of active) {
          const label = labels.get(node.id), mesh = meshes.get(node.id); if (!label || !mesh) continue;
          const emphasized = node.id === hovered || node.id === p.selectedId;
          mesh.material.emissive.set(emphasized ? p.color(node.node) : "#000000"); mesh.material.emissiveIntensity = emphasized ? .25 : 0;
          const world = new THREE.Vector3(node.x, node.y + label.position.y, node.z);
          const viewPoint = world.clone().applyMatrix4(camera.matrixWorldInverse);
          const scale = graph.height() / (2 * Math.tan(THREE.MathUtils.degToRad(camera.fov / 2)) * -viewPoint.z);
          const screen = graph.graph2ScreenCoords(world.x, world.y, world.z);
          const minHeight = emphasized || node.depth === 0 ? 13 : active.length <= 45 ? 11 : 0;
          const targetHeight = Math.max(node.depth === 0 ? 12 : 10, minHeight / Math.max(.01, scale));
          if (Math.abs(label.textHeight - targetHeight) > .1) label.textHeight = targetHeight;
          const box = { x: screen.x, y: screen.y, w: label.scale.x * scale + 8, h: label.scale.y * scale + 5 };
          label.visible = viewPoint.z < 0 && (emphasized || node.depth === 0 || box.h >= 15) && screen.x > 0 && screen.x < graph.width() && screen.y > 0 && screen.y < graph.height() && (emphasized || !boxes.some(b => Math.abs(b.x - box.x) < (b.w + box.w) / 2 && Math.abs(b.y - box.y) < (b.h + box.h) / 2));
          if (label.visible) boxes.push(box);
        }
        frame = requestAnimationFrame(draw);
      };
      draw(); element.dataset.ready = "true";
      cleanup = () => {
        refresh.current = () => {}; fit.current = () => {}; rebuild.current = () => {};
        observer.disconnect(); cancelAnimationFrame(frame); if (clickTimer) clearTimeout(clickTimer);
        document.removeEventListener("visibilitychange", visibility);
        document.removeEventListener("pointerup", ignoreSyntheticRelease, true);
        controls.removeEventListener("start", startInteraction); controls.removeEventListener("end", endInteraction);
        const renderer = graph.renderer();
        graph._destructor(); geometry.dispose(); disposables.forEach(item => item.dispose());
        shellGeometries.forEach(item => item.dispose()); shellMaterial.dispose();
        renderer.dispose(); engine.current = null; element.replaceChildren();
      };
    }).catch(error => { if (!cancelled) { console.error("Knowledge graph renderer failed", error); setFailure(true); } });
    return () => { cancelled = true; cleanup(); };
  }, [structure]);

  useEffect(() => {
    refresh.current();
    const key = props.visibleIds.join("\0");
    if (key !== previousVisible.current) { previousVisible.current = key; fit.current(); }
  }, [props.visibleIds.join("\0"), props.edges, props.graph, props.labels]);
  useEffect(() => { if (props.focusIds?.length) fit.current(props.focusIds); }, [props.focusIds?.join("\0")]);

  return <>
    <div ref={host} className="absolute inset-0" data-testid="knowledge-sphere" role="img" aria-label="三维知识图谱" />
    {failure && <p role="alert" className="absolute inset-0 flex items-center justify-center p-6 text-sm text-slate-600">三维图谱加载失败，请刷新页面或启用浏览器硬件加速。</p>}
    {!props.visibleIds.length && <p role="status" className="pointer-events-none absolute inset-0 flex items-center justify-center text-sm text-slate-500">没有匹配的知识点</p>}
    <div className="sr-only" aria-label="知识节点列表">{props.graph.nodes.filter(n => props.visibleIds.includes(n.id)).map(node => <button key={node.id} data-node-id={node.id} onClick={() => props.onSelect(node)} onKeyDown={event => { if (event.key === "ArrowRight") props.onExpand(node); }}>{node.name}</button>)}</div>
  </>;
});
