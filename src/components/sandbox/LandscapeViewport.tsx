'use client';
import { useEffect, useState, type DragEvent } from 'react';
import type { ArtworkRecipe } from '@/lib/sandbox/artwork';
import layout from '@/lib/sandbox/artwork-layout.json';
import { renderPlanArtwork } from '@/lib/sandbox/artwork-renderer';
import { FACILITIES, type Facility } from '@/lib/sandbox/types';
import type { Bounds } from '@/lib/sandbox/viewport';
import useSvgViewport from './useSvgViewport';
import ViewportControls from './ViewportControls';
import styles from './studio.module.css';

const bounds: Bounds = [0, 0, layout.canvas.width, layout.canvas.height];
const request = { sequence: 0, zone: null };
type Props = { recipe: ArtworkRecipe; disabled: boolean; onDropFacility: (facility: Facility) => void; onViewAll: () => void };

export default function LandscapeViewport({ recipe, disabled, onDropFacility, onViewAll }: Props) {
  const controls = useSvgViewport({ bounds, targetBounds: bounds, request, disabled });
  const [image, setImage] = useState(layout.base), [attempt, setAttempt] = useState(0);
  const [status, setStatus] = useState<'loading' | 'ready' | 'error'>('loading'), [message, setMessage] = useState('');
  const [dropping, setDropping] = useState(false);
  useEffect(() => () => { if (image.startsWith('blob:')) URL.revokeObjectURL(image); }, [image]);
  useEffect(() => {
    let alive = true;
    setStatus('loading'); setMessage('');
    renderPlanArtwork(recipe).then(canvas => new Promise<Blob>((resolve, reject) => {
      canvas.toBlob(blob => blob ? resolve(blob) : reject(new Error('效果图生成失败，请重试。')), 'image/png');
    })).then(blob => {
      if (!alive) return;
      setImage(URL.createObjectURL(blob)); setStatus('ready');
    }).catch(error => {
      if (alive) { setStatus('error'); setMessage(error instanceof Error ? error.message : '效果图加载失败，请重试。'); }
    });
    return () => { alive = false; };
  }, [recipe, attempt]);
  function drop(event: DragEvent<SVGSVGElement>) {
    event.preventDefault(); setDropping(false);
    if (!controls.canDrop()) return;
    const facility = event.dataTransfer.getData('application/x-lid') as Facility;
    if (FACILITIES[facility]) onDropFacility(facility);
  }
  return <div className={`${styles.mapCanvas} ${styles.landscapeViewport}`} data-artwork-state={status} data-artwork-signature={recipe.signature}>
    <svg ref={controls.svg} viewBox={`0 0 ${layout.canvas.width} ${layout.canvas.height}`} tabIndex={disabled ? -1 : 0} role="img" aria-label="紫荆雅苑景观效果图" aria-describedby="sandbox-landscape-help" data-testid="sandbox-landscape" data-dragging={controls.dragging} data-space={controls.spaceDown} {...controls.handlers}
      onDragOver={event => { if (controls.canDrop()) { event.preventDefault(); event.dataTransfer.dropEffect = 'copy'; setDropping(true); } }} onDragLeave={() => setDropping(false)} onDrop={drop}>
      <desc id="sandbox-landscape-help">景观效果图按社区设施总量更新。选择片区及空间后配置设施，拖入设施会添加到当前片区。滚轮缩放、拖动平移，方向键或 WASD 平移，R 重置。精确地块选择可切换俯视编辑。</desc>
      <g data-camera="landscape" transform={controls.transform}>
        <image href={image} width={layout.canvas.width} height={layout.canvas.height} pointerEvents="none" data-landscape-image="true" />
      </g>
    </svg>
    <ViewportControls landscape zoom={controls.camera.zoom} onZoom={factor => { controls.zoomBy(factor); controls.focus(); }} onReset={controls.reset} onAll={() => { onViewAll(); controls.reset(); }} />
    {status === 'loading' && <div className={styles.landscapeStatus} role="status">正在更新景观效果…</div>}
    {status === 'error' && <div className={styles.landscapeStatus} role="alert">{message}<button className={styles.textButton} onClick={() => setAttempt(value => value + 1)}>重新生成</button></div>}
    {dropping && !disabled && <div className={styles.landscapeDrop}>松开，将设施添加到当前片区的适用空间</div>}
  </div>;
}
