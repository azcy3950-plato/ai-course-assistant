// Real main-view rendering, configuration and insecure-context compatibility.
import assert from 'node:assert/strict';
import { chromium } from 'playwright';
import { mkdirSync, writeFileSync } from 'node:fs';
import { createHash } from 'node:crypto';

const base = process.argv[2] || process.env.SANDBOX_BASE_URL || 'http://127.0.0.1:3000';
assert(['localhost', '127.0.0.1', '[::1]'].includes(new URL(base).hostname), 'Only local test URLs allowed');
const dir = 'artifacts/sandbox-landscape-integration';
mkdirSync(dir, { recursive: true });
const browser = await chromium.launch({ headless: true, channel: process.env.PLAYWRIGHT_CHANNEL || undefined });
const context = await browser.newContext({ viewport: { width: 1440, height: 1040 }, acceptDownloads: true });
await context.addInitScript(() => Object.defineProperty(crypto, 'randomUUID', { value: undefined, configurable: true }));
const page = await context.newPage(), checks = [], errors = [];
page.on('pageerror', error => errors.push(error.message));
const image = () => page.getByTestId('sandbox-landscape');
const frame = () => image().locator('..');
const draft = () => page.evaluate(() => JSON.parse(localStorage.getItem('zijing-studio-v1')));
const ready = () => frame().and(page.locator('[data-artwork-state="ready"]')).waitFor();
const signature = () => frame().getAttribute('data-artwork-signature');
const camera = () => image().locator('[data-camera]').getAttribute('transform');
const digest = value => createHash('sha256').update(value).digest('hex');
async function pixels() {
  return digest(await image().locator('[data-landscape-image]').evaluate(async el => {
    const source = new Image(); source.src = el.getAttribute('href'); await source.decode();
    const canvas = document.createElement('canvas'); canvas.width = source.naturalWidth; canvas.height = source.naturalHeight;
    canvas.getContext('2d').drawImage(source, 0, 0); return canvas.toDataURL('image/png');
  }));
}
async function changed(previous) {
  await page.waitForFunction(previous => {
    const el = document.querySelector('[data-testid="sandbox-landscape"]')?.parentElement;
    return el?.dataset.artworkSignature !== previous && el?.dataset.artworkState === 'ready';
  }, previous);
}
async function check(name, fn) { await fn(); checks.push(name); console.log('PASS ' + name); }
const tool = name => page.getByRole('button', { name: new RegExp('^' + name + ' ') }).click();
async function add(name, area, depth) {
  const before = await signature(); await tool(name);
  await page.getByLabel('设施占地面积', { exact: true }).fill(String(area));
  await page.getByLabel('设施蓄水深度', { exact: true }).fill(String(depth));
  await page.getByRole('button', { name: '＋ 添加到当前空间', exact: true }).click(); await changed(before);
}

try {
  await page.goto(new URL('/sandbox', base).href); await ready();
  const model = await page.request.get(new URL('/api/sandbox/model', base).href).then(r => r.json());
  await check('Default main view displays the approved landscape while exact editors remain available', async () => {
    assert.equal(await image().isVisible(), true);
    assert.equal(await page.getByTestId('sandbox-2d').isVisible(), false);
    assert.equal(await page.getByRole('button', { name: '景观效果', exact: true }).getAttribute('aria-pressed'), 'true');
    const basePixels = await page.evaluate(async () => {
      const source = new Image(); source.src = '/sandbox/artwork/zijing-v1/base.png'; await source.decode();
      const canvas = document.createElement('canvas'); canvas.width = source.naturalWidth; canvas.height = source.naturalHeight;
      canvas.getContext('2d').drawImage(source, 0, 0); return canvas.toDataURL('image/png');
    });
    assert.equal(await pixels(), digest(basePixels));
  });
  await check('Adding and adjusting facilities updates main pixels with compatible space selection', async () => {
    const empty = await pixels(); await add('绿色屋顶', 120, 100); assert.notEqual(await pixels(), empty);
    assert(Math.abs((await draft()).placements.reduce((sum, p) => sum + p.area, 0) - 120) < 1e-6);
    const before = await signature(), oldPixels = await pixels();
    await page.getByLabel('绿色屋顶合计面积', { exact: true }).fill('240');
    await page.getByRole('button', { name: '应用面积', exact: true }).click(); await changed(before);
    assert.notEqual(await pixels(), oldPixels);
    await add('雨水花园', 100, 140);
    const beforeDrop = await signature();
    const dataTransfer = await page.evaluateHandle(() => { const transfer = new DataTransfer(); transfer.setData('application/x-lid', 'VS'); return transfer; });
    await image().dispatchEvent('drop', { dataTransfer }); await dataTransfer.dispose(); await changed(beforeDrop);
    const items = (await draft()).placements;
    assert(items.some(p => p.facility === 'VS'));
    assert(items.every(p => /^[0-9a-f-]{36}$/.test(p.id)));
    assert(items.every(p => model.patches.find(x => x.id === p.patchId).surface === (p.facility === 'GR' ? 'roof' : 'green')));
    assert(Math.abs(items.filter(p => p.facility === 'RG').reduce((sum, p) => sum + p.area, 0) - 100) < 1e-6);
  });
  await check('View, save and PNG export work without crypto.randomUUID and match the main artwork', async () => {
    const main = await pixels();
    await page.getByRole('button', { name: '查看效果图', exact: true }).click();
    const dialog = page.getByRole('dialog', { name: '方案效果图', exact: true });
    await dialog.locator('[data-artwork-state="ready"]').waitFor();
    assert.equal(digest(await dialog.locator('canvas').evaluate(el => el.toDataURL('image/png'))), main);
    await page.keyboard.press('Escape');
    await page.getByRole('button', { name: '保存方案', exact: true }).click();
    await dialog.locator('[data-artwork-state="ready"]').waitFor();
    const saved = await page.evaluate(() => JSON.parse(localStorage.getItem('zijing-studio-v1-saved')));
    assert.equal(saved.length, 1); assert.match(saved[0].id, /^[0-9a-f-]{36}$/);
    const downloading = page.waitForEvent('download');
    await dialog.getByRole('button', { name: '下载 PNG', exact: true }).click();
    await (await downloading).saveAs(dir + '/saved.png'); await page.keyboard.press('Escape');
  });
  await check('Landscape navigation and view switching preserve the draft and camera', async () => {
    await image().scrollIntoViewIfNeeded(); const initial = await camera();
    await page.getByRole('button', { name: '放大视图', exact: true }).click(); assert.notEqual(await camera(), initial);
    const zoomed = await camera(); await page.getByRole('button', { name: 'Z06', exact: true }).click();
    assert.equal(await camera(), zoomed);
    await image().focus(); await page.keyboard.down('ArrowRight'); await page.waitForTimeout(200); await page.keyboard.up('ArrowRight');
    const moved = await camera(); assert.notEqual(moved, zoomed);
    const before = JSON.stringify((await draft()).placements);
    for (const [button, id] of [['俯视编辑', 'sandbox-2d'], ['三维查看', 'sandbox-3d'], ['景观效果', 'sandbox-landscape']]) {
      await page.getByRole('button', { name: button, exact: true }).click(); await page.getByTestId(id).waitFor();
      assert.equal(JSON.stringify((await draft()).placements), before);
    }
    assert.equal(await camera(), moved);
    await page.getByRole('button', { name: '重置视图', exact: true }).click();
    const old = await pixels(); await page.reload(); await ready(); assert.equal(await pixels(), old);
    const previous = await signature();
    await page.getByRole('button', { name: '载入案例四类设施 →', exact: true }).click(); await changed(previous);
    await page.locator('[data-testid="sandbox-landscape"]').screenshot({ path: dir + '/main-artwork.png' });
    await page.screenshot({ path: dir + '/desktop.png' });
  });
  await check('Main landscape and configuration drawers fit narrow mobile screens', async () => {
    for (const width of [360, 390, 760]) {
      await page.setViewportSize({ width, height: 844 }); await page.waitForTimeout(180);
      assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1), true, String(width));
      await page.getByRole('button', { name: '空间配置', exact: true }).click();
      await page.getByLabel('设施占地面积', { exact: true }).waitFor({ state: 'visible' });
      await page.getByLabel('关闭空间配置', { exact: true }).click();
      assert.equal(await image().isVisible(), true);
      if (width === 390) await page.screenshot({ path: dir + '/mobile.png' });
    }
  });
  assert.deepEqual(errors, []); writeFileSync(dir + '/verification.json', JSON.stringify({ checks, errors }, null, 2));
} finally { await browser.close(); }
