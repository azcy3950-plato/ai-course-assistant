import { describe, it, expect } from "vitest";
import { GraphPhysics, graphLabelLines } from "../src/lib/graph-physics";
import { computeLayout, type Placed } from "../src/lib/graph-layout";
import { buildAllNetworks } from "../src/lib/knowledge-map-builder";
import type { KnowledgeNode } from "../src/types";
const node = (id: string, x: number, y: number, chapter = "A"): Placed => ({ node: { id, name: id, chapter, category: "core", description: "", keywords: [], resources: [] } as KnowledgeNode, depth: 1, x, y });
const bounds = { left: 0, right: 1400, top: 0, bottom: 900 };
const overlaps = (sim: GraphPhysics) => {
  const b = [...sim.bodies.values()].filter(b => sim.visible.has(b.id));
  let worst = 0;
  for (let i = 0; i < b.length; i++) for (let j = i + 1; j < b.length; j++) worst = Math.max(worst, b[i].radius + b[j].radius - Math.hypot(b[i].x-b[j].x,b[i].y+b[i].offsetY-b[j].y-b[j].offsetY));
  return worst;
};
describe("knowledge graph physics", () => {
  it("separates overlapping nodes and label envelopes without changing graph data", () => {
    const input = [node("甲乙丙丁戊己庚辛",700,450),node("长标签需要换行继续展示",700,450),node("C",700,450)];
    const original=JSON.stringify(input), sim=new GraphPhysics(input,[]);sim.settle();
    expect(overlaps(sim)).toBeLessThan(.5);expect(JSON.stringify(input)).toBe(original);
    expect(graphLabelLines("长标签需要换行继续展示").length).toBeGreaterThan(1);
  });
  it("springs pull linked neighbors during a drag, then retain the new placement", () => {
    const sim=new GraphPhysics([node("A",350,450),node("B",650,450),node("C",1000,450)],[{source:"A",target:"B"}]);sim.settle();
    const before=sim.positions();sim.begin("A",bounds);sim.move({x:250,y:350});for(let i=0;i<30;i++)sim.step();
    expect(sim.bodies.get("B")!.x).toBeLessThan(before.get("B")!.x-1);
    expect(sim.bodies.get("C")!.x).toBeCloseTo(before.get("C")!.x);
    sim.release({x:0,y:0});sim.settle();expect(sim.bodies.get("A")!.x).toBeLessThan(300);
  });
  it("glides after release and transfers motion through a soft collision", () => {
    const sim=new GraphPhysics([node("A",400,450),node("B",550,450)],[]);sim.settle();sim.begin("A",bounds);sim.move({x:470,y:450});
    const before=sim.bodies.get("A")!.x;sim.release({x:12,y:0});sim.step();expect(sim.bodies.get("A")!.x).toBeGreaterThan(before);expect(sim.bodies.get("B")!.x).toBeGreaterThan(550);sim.settle();expect(overlaps(sim)).toBeLessThan(.5);
  });
  it("keeps chapter groups closer together than unrelated chapters", () => {
    const sim=new GraphPhysics([node("A1",600,400,"A"),node("A2",800,500,"A"),node("B1",600,400,"B"),node("B2",800,500,"B")],[]);sim.settle();
    const a=sim.bodies.get("A1")!,a2=sim.bodies.get("A2")!,b=sim.bodies.get("B1")!;
    expect(Math.hypot(a.x-a2.x,a.y-a2.y)).toBeLessThan(Math.hypot(a.x-b.x,a.y-b.y));
  });
  it("expands revealed nodes from the active concept and settles without overlap", () => {
    const sim=new GraphPhysics([node("A",400,450),node("B",800,450)],[]);sim.settle();sim.show(["A"]);sim.show(["A","B"],"A");
    const a=sim.bodies.get("A")!,b=sim.bodies.get("B")!;expect(Math.hypot(a.x-b.x,a.y-b.y)).toBeCloseTo(30);
    sim.settle();expect(overlaps(sim)).toBeLessThan(.5);expect(b.x).toBeGreaterThan(a.x+100);
  });
  it("buffers the viewport edge and prevents inertia from throwing labels outside", () => {
    const sim=new GraphPhysics([node("A",700,450)],[]);sim.begin("A",bounds);sim.move({x:3000,y:-2000});sim.release({x:1000,y:-1000});
    for(let i=0;i<260;i++){sim.step();const b=sim.bodies.get("A")!;expect(b.x+b.radius).toBeLessThanOrEqual(1400.001);expect(b.y+b.offsetY-b.radius).toBeGreaterThanOrEqual(-.001);}
  });
  it("stops after bounded time and reduced-motion release has no inertia", () => {
    const sim=new GraphPhysics([node("A",700,450)],[]);sim.begin("A",bounds);sim.move({x:800,y:450});sim.release({x:12,y:12},true);expect(sim.bodies.get("A")!.vx).toBe(0);
    let active=true;for(let i=0;i<260;i++)active=sim.step();expect(active).toBe(false);expect(sim.bodies.get("A")!.x).toBeCloseTo(800);
  });
  it("handles the real combined graph without non-finite positions", () => {
    const networks=buildAllNetworks(), nodes=networks.flatMap(n=>n.nodes),edges=networks.flatMap(n=>n.edges);
    const sim=new GraphPhysics(computeLayout(nodes,edges,nodes[0].id,1,1400,900),edges);sim.settle();
    expect(sim.bodies.size).toBe(nodes.length);for(const b of sim.bodies.values()){expect(Number.isFinite(b.x)&&Number.isFinite(b.y)).toBe(true);}
    expect(overlaps(sim)).toBeLessThan(3);
  });
});