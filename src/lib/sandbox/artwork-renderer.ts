import layoutData from './artwork-layout.json';
import { ARTWORK_FACILITIES, ARTWORK_VERSION, artworkNote, artworkCoverage, type ArtworkLayout, type ArtworkRecipe, type ArtworkRegion } from './artwork';
import { LANDSCAPE_ZONES } from './landscape-layout';
import { FACILITIES, type Facility, type Point } from './types';

const layout = layoutData as ArtworkLayout;
let loadingAssets: Promise<{ base: HTMLImageElement; sprites: Record<Facility, HTMLImageElement> }> | undefined;

function loadImage(src: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error('效果图素材加载失败，请重试。'));
    img.src = src;
  });
}
function assets() {
  if (!loadingAssets) loadingAssets = Promise.all([loadImage(layout.base), ...ARTWORK_FACILITIES.map(f => loadImage(layout.assets[f].src))])
    .then(([base, ...images]) => ({ base, sprites: Object.fromEntries(ARTWORK_FACILITIES.map((f, i) => [f, images[i]])) as Record<Facility, HTMLImageElement> }))
    .catch(error => { loadingAssets = undefined; throw error; });
  return loadingAssets;
}
function polygon(points: Point[]): Path2D {
  const p = new Path2D();
  points.forEach(([x, y], i) => i ? p.lineTo(x, y) : p.moveTo(x, y));
  p.closePath();
  return p;
}
function bounds(points: Point[]): [number, number, number, number] {
  const xs = points.map(p => p[0]), ys = points.map(p => p[1]);
  const x = Math.min(...xs), y = Math.min(...ys);
  return [x, y, Math.max(...xs) - x, Math.max(...ys) - y];
}
function polygonArea(points: Point[]): number {
  return Math.abs(points.reduce((sum, point, i) => {
    const next = points[(i + 1) % points.length];
    return sum + point[0] * next[1] - next[0] * point[1];
  }, 0)) / 2;
}
function context(canvas: HTMLCanvasElement): CanvasRenderingContext2D {
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('浏览器暂不支持生成效果图。');
  return ctx;
}

function swale(ctx: CanvasRenderingContext2D, image: HTMLImageElement, region: ArtworkRegion, share: number) {
  if (!region.route || !region.width) return;
  const segments = region.route.slice(1).map((point, i) => {
    const start = region.route![i], dx = point[0] - start[0], dy = point[1] - start[1];
    return { start, dx, dy, length: Math.hypot(dx, dy) };
  });
  const total = segments.reduce((sum, s) => sum + s.length, 0);
  const [sx, sy, sw, sh] = layout.assets.VS.sourceRect;
  let offset = 0, remaining = total * share;
  for (const segment of segments) {
    if (remaining <= 0 || total <= 0) break;
    const length = Math.min(segment.length, remaining), span = length / total * sw;
    ctx.save();
    ctx.translate(...segment.start); ctx.rotate(Math.atan2(segment.dy, segment.dx));
    ctx.globalAlpha = 0.94;
    ctx.drawImage(image, sx + offset / total * sw, sy, span, sh, 0, -region.width / 2, length, region.width);
    ctx.restore();
    offset += segment.length; remaining -= length;
  }
}

export async function renderPlanArtwork(recipe: ArtworkRecipe, width = layout.canvas.width): Promise<HTMLCanvasElement> {
  const { base, sprites } = await assets();
  const makeCanvas = () => {
    const canvas = document.createElement('canvas');
    canvas.width = Math.max(1, Math.round(width));
    canvas.height = Math.round(canvas.width * layout.canvas.height / layout.canvas.width);
    return canvas;
  };
  const result = makeCanvas(), output = context(result);
  output.drawImage(base, 0, 0, result.width, result.height);
  const pavingTile = document.createElement('canvas');
  pavingTile.width = 64; pavingTile.height = 8;
  context(pavingTile).drawImage(sprites.PP, ...layout.assets.PP.sourceRect, 0, 0, 64, 8);
  for (const key of layout.drawOrder) {
    const groups: { coverage: number; regions: ArtworkRegion[]; boundary?: Point[] }[] = recipe.version === ARTWORK_VERSION && recipe.zones
      ? LANDSCAPE_ZONES.map(zone=>({coverage:artworkCoverage(recipe,key,zone.id),regions:zone.facilities[key],boundary:zone.boundary}))
      : [{coverage:artworkCoverage(recipe,key),regions:layout.layers[key].regions}];
    if (!groups.some(group=>group.coverage>0)) continue;
    const c = makeCanvas(), ctx = context(c);
    ctx.scale(c.width / layout.canvas.width, c.height / layout.canvas.height);
    ctx.imageSmoothingEnabled = true; ctx.imageSmoothingQuality = 'high';
    for (const {coverage,regions,boundary} of groups) {
      if (!coverage) continue;
      ctx.save();
      if (boundary) ctx.clip(polygon(boundary));
      let remaining = coverage * regions.reduce((sum, r) => sum + (r.polygon ? polygonArea(r.polygon) : 0), 0);
      for (const region of regions) {
        ctx.save();
        if (region.clipPolygon) ctx.clip(polygon(region.clipPolygon));
        if (region.route) swale(ctx, sprites.VS, region, coverage);
        else if (region.polygon) {
          const area = polygonArea(region.polygon), share = Math.min(1, Math.max(0, remaining / area));
          remaining -= area;
          if (share > 0) {
            const p = polygon(region.polygon), [x, y, w, h] = bounds(region.polygon);
            ctx.clip(p); ctx.beginPath(); ctx.rect(x, y, w * share, h); ctx.clip();
            if (key === 'PP') {
              ctx.globalAlpha = 0.72; ctx.fillStyle = ctx.createPattern(pavingTile, 'repeat')!; ctx.fill(p);
            } else {
              ctx.globalAlpha = 0.97;
              ctx.drawImage(sprites[key], ...layout.assets[key].sourceRect, x, y, w, h);
              ctx.globalAlpha = 0.92; ctx.strokeStyle = '#dddcd0'; ctx.lineWidth = 1.5; ctx.stroke(p);
            }
          }
        } else if (region.rect) {
          const [x, y, w, h] = region.rect, scale = Math.sqrt(coverage);
          ctx.translate(x + w / 2, y + h / 2); ctx.rotate((region.rotation || 0) * Math.PI / 180);
          ctx.globalAlpha = 0.97;
          ctx.drawImage(sprites[key], ...layout.assets[key].sourceRect, -w * scale / 2, -h * scale / 2, w * scale, h * scale);
        }
        ctx.restore();
      }
      ctx.restore();
    }
    if (key === 'VS' || key === 'RG') {
      ctx.save(); ctx.globalCompositeOperation = 'destination-out'; ctx.filter = 'blur(0.7px)';
      for (const mask of layout.groundForegroundMasks) {
        const [cx, cy, rx, ry] = mask.ellipse;
        ctx.beginPath(); ctx.ellipse(cx, cy, rx, ry, 0, 0, 2 * Math.PI); ctx.fill();
      }
      ctx.restore();
    }
    output.drawImage(c, 0, 0);
  }
  return result;
}

const number = (v: number, digits = 1) => v.toLocaleString('zh-CN', { maximumFractionDigits: digits });
function fitText(ctx: CanvasRenderingContext2D, value: string, maxWidth: number): string {
  if (ctx.measureText(value).width <= maxWidth) return value;
  let text = value;
  while (text && ctx.measureText(text + '…').width > maxWidth) text = text.slice(0, -1);
  return text + '…';
}
export function exportArtworkCanvas(image: HTMLCanvasElement, recipe: ArtworkRecipe, plan: { name: string; rain: string; date: string }): Promise<Blob> {
  const canvas = document.createElement('canvas');
  canvas.width = image.width; canvas.height = image.height + 270;
  const ctx = context(canvas), w = canvas.width;
  ctx.fillStyle = '#ffffff'; ctx.fillRect(0, 0, w, canvas.height);
  ctx.fillStyle = '#203457'; ctx.font = '500 30px system-ui, "Microsoft YaHei", sans-serif';
  ctx.fillText(fitText(ctx, plan.name + ' · 方案效果图', w - 64), 32, 43);
  ctx.font = '18px system-ui, "Microsoft YaHei", sans-serif'; ctx.fillStyle = '#5d6e87';
  ctx.fillText(`紫荆雅苑 · ${plan.rain.replace('A', ' 年一遇')} · ${plan.date}`, 32, 75);
  ctx.drawImage(image, 0, 100);
  const y = image.height + 126;
  ARTWORK_FACILITIES.forEach((f, i) => {
    const x = 32 + i * (w - 64) / 4, s = recipe.facilities[f];
    ctx.fillStyle = '#203457'; ctx.font = '500 19px system-ui, "Microsoft YaHei", sans-serif'; ctx.fillText(FACILITIES[f].name, x, y);
    ctx.font = '24px system-ui, "Microsoft YaHei", sans-serif'; ctx.fillText(number(s.area, 2) + ' m²', x, y + 34);
    ctx.fillStyle = '#5d6e87'; ctx.font = '17px system-ui, "Microsoft YaHei", sans-serif';
    ctx.fillText(s.area > 0 ? '平均蓄水深度 ' + number(s.depth) + ' mm' : '未布置', x, y + 63);
    if (f === 'RG') ctx.fillText('含乔木配置 ' + number(s.treeArea, 2) + ' m²', x, y + 89);
  });
  ctx.fillStyle = '#5d6e87'; ctx.font = '17px system-ui, "Microsoft YaHei", sans-serif'; ctx.fillText(artworkNote(recipe), 32, canvas.height - 22);
  return new Promise((resolve, reject) => canvas.toBlob(blob => blob ? resolve(blob) : reject(new Error('图片导出失败，请重试。')), 'image/png'));
}
