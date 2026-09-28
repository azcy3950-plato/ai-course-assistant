'use client';
import { MAX_ZOOM, MIN_ZOOM } from '@/lib/sandbox/viewport';
import styles from './studio.module.css';

export default function ViewportControls({ zoom, onZoom, onReset, onAll, three = false }: {
  zoom: number; onZoom: (factor: number) => void; onReset: () => void; onAll: () => void; three?: boolean;
}) {
  return <>
    <div className={styles.viewportControls} role="group" aria-label="沙盘视图控制">
      <output aria-label="缩放比例">{Math.round(zoom * 100)}%</output>
      <button type="button" aria-label="放大视图" title="放大（+ / =）" disabled={zoom >= MAX_ZOOM} onClick={() => onZoom(1.25)}>＋</button>
      <button type="button" aria-label="缩小视图" title="缩小（-）" disabled={zoom <= MIN_ZOOM} onClick={() => onZoom(1 / 1.25)}>−</button>
      <button type="button" aria-label="重置视图" title="恢复初始视图（R）" onClick={onReset}>⌖</button>
      <button type="button" onClick={onAll}>查看全图</button>
    </div>
    <details className={styles.viewportHelp}>
      <summary>操作提示</summary>
      <p>滚轮缩放 · 空白处左键拖动<br/>空格 + 左键：从任意位置拖动<br/>点击沙盘后：方向键 / WASD 连续平移，Shift 加速<br/>+ / − 缩放 · R 重置 · Esc 取消拖动</p>
      <p>{three ? '三维旋转使用右上角 ↶ / ↷，平移手势相同。' : '单击选中空间；从设施工具箱拖入设施。'}<br/>输入框、下拉框及弹窗内不启用沙盘快捷键。</p>
    </details>
  </>;
}
