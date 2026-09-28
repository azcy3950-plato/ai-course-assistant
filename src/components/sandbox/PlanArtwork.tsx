'use client';
import { useEffect, useRef, useState } from 'react';
import { ARTWORK_FACILITIES, ARTWORK_NOTE, artworkFilename, type ArtworkRecipe } from '@/lib/sandbox/artwork';
import { exportArtworkCanvas, renderPlanArtwork } from '@/lib/sandbox/artwork-renderer';
import { FACILITIES } from '@/lib/sandbox/types';
import styles from './studio.module.css';

type Props = { recipe: ArtworkRecipe; name: string; rain: string; date: string; compact?: boolean };
const number = (value: number, digits = 1) => value.toLocaleString('zh-CN', { maximumFractionDigits: digits });

export default function PlanArtwork({ recipe, name, rain, date, compact = false }: Props) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [status, setStatus] = useState<'loading' | 'ready' | 'error'>('loading');
  const [message, setMessage] = useState(''), [attempt, setAttempt] = useState(0), [exporting, setExporting] = useState(false);
  useEffect(() => {
    let alive = true;
    setStatus('loading'); setMessage('');
    renderPlanArtwork(recipe, compact ? 340 : 1484).then(image => {
      if (!alive || !canvasRef.current) return;
      const target = canvasRef.current, ctx = target.getContext('2d');
      if (!ctx) throw new Error('浏览器暂不支持预览效果图。');
      target.width = image.width; target.height = image.height; ctx.drawImage(image, 0, 0); setStatus('ready');
    }).catch(error => { if (alive) { setStatus('error'); setMessage(error instanceof Error ? error.message : '效果图生成失败，请重试。'); } });
    return () => { alive = false; };
  }, [recipe, compact, attempt]);
  async function download() {
    if (!canvasRef.current || status !== 'ready' || exporting) return;
    setExporting(true); setMessage('');
    try {
      const blob = await exportArtworkCanvas(canvasRef.current, recipe, { name, rain, date });
      const url = URL.createObjectURL(blob), link = document.createElement('a');
      link.href = url; link.download = artworkFilename(name); link.click();
      window.setTimeout(() => URL.revokeObjectURL(url), 2000);
    } catch (error) { setMessage(error instanceof Error ? error.message : '图片导出失败，请重试。'); }
    finally { setExporting(false); }
  }
  return <div className={compact ? styles.artworkThumbnail : styles.artwork} data-artwork-state={status} data-artwork-signature={recipe.signature}>
    {!compact && <div className={styles.artworkMeta}><span>{rain.replace('A', ' 年一遇')} · {date}</span><button className={styles.run} disabled={status !== 'ready' || exporting} onClick={download}>{exporting ? '正在导出…' : '下载 PNG'}</button></div>}
    <canvas ref={canvasRef} className={styles.artworkCanvas} width={compact ? 340 : 1484} height={compact ? 243 : 1060} hidden={status !== 'ready'} role="img" aria-label={name + '的方案效果图'} />
    {status === 'loading' && <div className={styles.artworkLoading} role={compact ? undefined : 'status'}>{compact ? '生成中…' : '正在生成方案效果图…'}</div>}
    {status === 'error' && <div className={styles.artworkLoading} role={compact ? undefined : 'alert'}>{compact ? '效果图暂不可用' : <>{message}<button className={styles.save} onClick={() => setAttempt(value => value + 1)}>重新生成</button></>}</div>}
    {!compact && <>
      <div className={styles.artworkStats}>{ARTWORK_FACILITIES.map(f => { const s = recipe.facilities[f]; return <div key={f}><span>{FACILITIES[f].name}</span><strong>{number(s.area, 2)}<small> m²</small></strong><span>{s.area ? '平均蓄水深度 ' + number(s.depth) + ' mm' : '未布置'}</span>{f === 'RG' && <span>含乔木配置 {number(s.treeArea, 2)} m²</span>}</div>; })}</div>
      <p className={styles.artworkNote}>{ARTWORK_NOTE}</p>
      {message && status !== 'error' && <p role="alert" className={styles.constraint}>{message}</p>}
    </>}
  </div>;
}
