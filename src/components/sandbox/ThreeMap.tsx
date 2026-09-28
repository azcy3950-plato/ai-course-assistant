'use client';

import React, { useMemo, useState } from 'react';
import { Campus, FACILITIES, Placement } from '@/lib/sandbox/types';
import { boundsOf, paddedViewBox } from '@/lib/sandbox/viewport';
import useSvgViewport, { ViewRequest } from './useSvgViewport';
import ViewportControls from './ViewportControls';
import styles from './studio.module.css';

export default function ThreeMap({ campus, placements, viewRequest, disabled, selected, onSelect, onViewAll }: {
  campus: Campus; placements: Placement[]; viewRequest: ViewRequest; disabled: boolean; selected: string; onSelect: (id: string) => void; onViewAll: () => void;
}) {
  const [angle, setAngle] = useState(0), [height, setHeight] = useState(1);
  const [x0, y0, x1, y1] = campus.bounds, cx = (x0 + x1) / 2, cy = (y0 + y1) / 2;
  // Project only for display; model coordinates and facility areas remain untouched.
  const project = (x: number, y: number, z = 0, rotation = angle): [number, number] => {
    const a = rotation * Math.PI / 180, dx = x - cx, dy = y - cy;
    return [cx + dx * Math.cos(a) - dy * Math.sin(a), cy + (dx * Math.sin(a) + dy * Math.cos(a)) * .78 - z * .7];
  };
  const initialBounds = useMemo(() => boundsOf(campus.patches.flatMap(p => p.points.map(([x, y]) => project(x, y, p.surface === 'roof' ? 8.5 : 0, 0)))), [campus]);
  const sceneBounds = boundsOf(campus.patches.flatMap(p => p.points.map(([x, y]) => project(x, y, p.surface === 'roof' ? 5 * height : 0))));
  const targetBounds = boundsOf(campus.patches.filter(p => viewRequest.zone === null || p.zone === viewRequest.zone).flatMap(p => p.points.map(([x, y]) => project(x, y, p.surface === 'roof' ? 5 * height : 0))));
  const controls = useSvgViewport({ bounds: sceneBounds, targetBounds, request: viewRequest, disabled, onReset: () => { setAngle(0); setHeight(1); } });
  const occupied = useMemo(() => {
    const map = new Map<string, Placement[]>();
    placements.forEach(p => map.set(p.patchId, [...(map.get(p.patchId) || []), p]));
    return map;
  }, [placements]);
  const selectedPatch = campus.patches.find(p => p.id === selected);

  return <div className={styles.threeWrap}>
    <svg ref={controls.svg} viewBox={paddedViewBox(initialBounds)} tabIndex={disabled ? -1 : 0} role="img" aria-label="紫荆雅苑三维示意沙盘" aria-describedby="sandbox-3d-help" data-testid="sandbox-3d" data-dragging={controls.dragging} data-space={controls.spaceDown} {...controls.handlers}>
      <desc id="sandbox-3d-help">滚轮缩放，空白处或空格加左键平移；方向键或 WASD 平移，R 重置；旋转使用右上角按钮。</desc>
      <defs><filter id="three-shadow"><feDropShadow dx="2" dy="4" stdDeviation="2" floodColor="#264338" floodOpacity=".23" /></filter></defs>
      <g data-camera="3d" transform={controls.transform}>
        {campus.patches.map(p => {
          const roof = p.surface === 'roof', z = roof ? 5 * height : 0;
          const ground = p.points.map(([x, y]) => project(x, y).join(',')).join(' ');
          const top = p.points.map(([x, y]) => project(x, y, z).join(',')).join(' ');
          const list = occupied.get(p.id) || [];
          const minX = Math.min(...p.points.map(v => v[0])), maxX = Math.max(...p.points.map(v => v[0]));
          const minY = Math.min(...p.points.map(v => v[1])), maxY = Math.max(...p.points.map(v => v[1]));
          const groupedSelected = !!selectedPatch && p.zone === selectedPatch.zone && p.surface === selectedPatch.surface;
          return <g key={p.id} data-patch={p.id} data-space-group={`${p.zone}-${p.surface}`} data-surface={p.surface} data-selected={groupedSelected} className={styles.mapPatch} onClick={() => onSelect(p.id)}>
            {roof && <polygon points={ground} fill="#bcb8a6" stroke="#b0ad9c" strokeWidth=".5" filter="url(#three-shadow)" />}
            <polygon points={top} fill={roof ? '#eee9d8' : p.surface === 'road' ? '#d7cfbb' : p.surface === 'green' ? '#9fbd91' : '#e1e7dc'} stroke={groupedSelected ? '#3166ff' : '#b6c5b2'} strokeWidth={groupedSelected ? .7 : .55}>
              <title>{`Z${String(p.zone).padStart(2, '0')} · ${p.id}`}</title>
            </polygon>
            {!!list.length && <><clipPath id={`three-clip-${p.id}`}><polygon points={top} /></clipPath><g clipPath={`url(#three-clip-${p.id})`} pointerEvents="none">{list.map((x, i) => {
              const offset = list.slice(0, i).reduce((s, v) => s + v.area, 0) / p.area;
              const left = minX + (maxX - minX) * offset, right = left + (maxX - minX) * x.area / p.area;
              const pts = [[left, minY], [right, minY], [right, maxY], [left, maxY]].map(([a, b]) => project(a, b, z).join(',')).join(' ');
              return <polygon key={x.id} points={pts} fill={FACILITIES[x.facility].color} opacity=".85" />;
            })}</g></>}
            {groupedSelected&&<polygon points={top} fill="none" stroke="#3166ff" strokeWidth="1.5" vectorEffect="non-scaling-stroke" pointerEvents="none"/>}
          </g>;
        })}
        {campus.pipes.map(p => <polyline key={p.id} points={p.points.map(([x, y]) => project(x, y, -1).join(',')).join(' ')} stroke="#527f8a" strokeWidth=".55" fill="none" opacity=".55" pointerEvents="none" />)}
        {campus.zones.map(z => { const p = project(z.center[0], z.center[1], 8); return <text key={z.id} x={p[0]} y={p[1]} textAnchor="middle" fontSize="7" fill="#315b42" fontWeight="700" pointerEvents="none">Z{String(z.id).padStart(2, '0')}</text>; })}
      </g>
    </svg>
    <ViewportControls three zoom={controls.camera.zoom} onZoom={f => { controls.zoomBy(f); controls.focus(); }} onReset={controls.reset} onAll={() => { onViewAll(); controls.reset(); }} />
    <div className={styles.threeControls}>
      <button onClick={() => { setAngle(a => (a - 15) % 360); controls.focus(); }} aria-label="向左旋转" title="向左旋转 15°">↶</button>
      <button onClick={() => { setAngle(a => (a + 15) % 360); controls.focus(); }} aria-label="向右旋转" title="向右旋转 15°">↷</button>
      <button onClick={() => setHeight(h => h === 1 ? 1.7 : 1)} aria-label="切换建筑高度">▥</button><span>旋转 / 示意高度</span>
    </div>
  </div>;
}
