'use client';
import { useEffect, useState } from 'react';
import { FACILITIES } from '@/lib/sandbox/types';
import { GroupedPlacement } from '@/lib/sandbox/grouping';
import styles from './studio.module.css';

export default function GroupPlacementEditor({item, available, disabled, onApply, onRemove}: {
  item: GroupedPlacement; available: number; disabled: boolean;
  onApply: (area: number) => void; onRemove: () => void;
}) {
  const [draft, setDraft] = useState(String(Number(item.area.toFixed(2))));
  useEffect(() => setDraft(String(Number(item.area.toFixed(2)))), [item.area]);
  const title = FACILITIES[item.facility].name, max = item.area + available;
  const amount = Number(draft), invalid = draft.trim() === '' || !Number.isFinite(amount) || amount <= 0 || amount > max + 1e-7;
  return <div className={styles.groupPlacement} data-config={item.key}>
    <div className={styles.groupPlacementHeading}><i style={{background:FACILITIES[item.facility].color}}/><strong>{title}</strong><button aria-label={`删除${title}`} onClick={onRemove} disabled={disabled}>移除</button></div>
    <p>{item.depth} mm 蓄水深度{item.trees ? ' · 含乔木' : ''} · 本类空间合计</p>
    <label className={styles.groupAreaField}>合计面积 / m²<input aria-label={`${title}合计面积`} type="number" min="0.01" max={max} step="0.01" value={draft} onChange={e => setDraft(e.target.value)} disabled={disabled}/></label>
    <input aria-label={`${title}面积调整`} type="range" min="0" max={max} step="any" value={Number.isFinite(amount) ? Math.min(max, Math.max(0, amount)) : 0} onChange={e => setDraft(e.target.value)} disabled={disabled}/>
    <div className={styles.groupAreaActions}><button onClick={() => setDraft(String(max))} disabled={disabled}>用满剩余面积</button><button onClick={() => onApply(amount)} disabled={disabled || invalid}>应用面积</button></div>
    {invalid && <small className={styles.constraint}>请输入大于 0 且不超过 {max.toLocaleString('zh-CN', {maximumFractionDigits:2})} m² 的面积。</small>}
  </div>;
}
