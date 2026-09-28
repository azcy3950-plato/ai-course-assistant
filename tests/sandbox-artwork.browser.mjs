import assert from 'node:assert/strict';
import { chromium } from 'playwright';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { createHash } from 'node:crypto';

const base = process.argv[2] || process.env.SANDBOX_BASE_URL || 'http://127.0.0.1:3000';
assert(['localhost', '127.0.0.1', '[::1]'].includes(new URL(base).hostname), 'Only local test URLs allowed');
const dir = 'artifacts/sandbox-artwork-integration';
mkdirSync(dir, { recursive: true });
const browser = await chromium.launch({ headless: true, channel: process.env.PLAYWRIGHT_CHANNEL || undefined });
const context = await browser.newContext({ viewport: { width: 1440, height: 1040 }, acceptDownloads: true });
const page = await context.newPage(), checks = [], errors = [];
page.on('pageerror', error => errors.push(error.message));
const modelResponse = await page.request.get(new URL('/api/sandbox/model', base).href);
assert.equal(modelResponse.status(), 200);
const model = await modelResponse.json();
const patch = surface => [...model.patches].filter(p => p.surface === surface).sort((a, b) => b.area - a.area)[0];
const roof = patch('roof'), green = patch('green'), road = patch('road');
const placements = [
  { id: 'qa-gr', patchId: roof.id, facility: 'GR', area: roof.area * 0.6, depth: 100, trees: false },
  { id: 'qa-rg', patchId: green.id, facility: 'RG', area: green.area * 0.3, depth: 120, trees: true },
  { id: 'qa-vs', patchId: green.id, facility: 'VS', area: green.area * 0.15, depth: 80, trees: false },
  { id: 'qa-pp', patchId: road.id, facility: 'PP', area: road.area * 0.5, depth: 65, trees: false },
];
const legacy = { id: 'legacy-plan', name: '旧方案', placements: placements.slice(1, 2), rain: '3A', date: '2026/9/28 10:00:00' };
await context.addInitScript(item => {
  if (!localStorage.getItem('artwork-qa-seeded')) {
    localStorage.setItem('zijing-studio-v1', JSON.stringify({ placements: [], name: '零设施方案', rain: '5A' }));
    localStorage.setItem('zijing-studio-v1-saved', JSON.stringify([item]));
    localStorage.setItem('artwork-qa-seeded', '1');
  }
}, legacy);

async function check(name, fn) { await fn(); checks.push(name); console.log('PASS ' + name); }
const dialog = () => page.getByRole('dialog', { name: '方案效果图', exact: true });
async function ready() { await dialog().locator('[data-artwork-state="ready"]').waitFor(); }
const pixels = () => dialog().locator('canvas').evaluate(c => c.toDataURL('image/png'));
async function close() { await page.keyboard.press('Escape'); await dialog().waitFor({ state: 'hidden' }); }
async function importPlan(name, items) {
  await page.locator('input[type="file"]').setInputFiles({ name: 'plan.json', mimeType: 'application/json', buffer: Buffer.from(JSON.stringify({ version: model.version, name, placements: items, rain: '5A' })) });
  await page.waitForFunction(name => JSON.parse(localStorage.getItem('zijing-studio-v1') || '{}').name === name, name);
}
async function notebook() {
  const more = page.getByLabel('更多操作', { exact: true });
  if (!(await more.evaluate(el => el.parentElement.open))) await more.click();
  await page.getByRole('button', { name: /^我的实验/ }).click();
  await page.getByRole('dialog', { name: '我的实验', exact: true }).waitFor();
}
async function download(filename) {
  const downloading = page.waitForEvent('download');
  await dialog().getByRole('button', { name: '下载 PNG', exact: true }).click();
  const file = await downloading;
  await file.saveAs(dir + '/' + filename);
  return readFileSync(dir + '/' + filename);
}

try {
  await page.goto(new URL('/sandbox', base).href);
  await page.getByTestId('sandbox-landscape').waitFor();
  await check('Portable local assets and exact approved base for an empty plan', async () => {
    for (const file of ['base.png', 'green-roof.png', 'bioswale.png', 'rain-garden.png', 'permeable-paving.png']) {
      const response = await page.request.get(new URL('/sandbox/artwork/zijing-v1/' + file, base).href);
      assert.equal(response.status(), 200, file);
      assert.match(response.headers()['content-type'], /image\/png/);
    }
    await page.getByRole('button', { name: '查看效果图', exact: true }).click(); await ready();
    const equal = await dialog().locator('canvas').evaluate(async canvas => {
      const image = new Image();
      image.src = '/sandbox/artwork/zijing-v1/base.png'; await image.decode();
      const reference = document.createElement('canvas'); reference.width = canvas.width; reference.height = canvas.height;
      reference.getContext('2d').drawImage(image, 0, 0);
      const a = reference.getContext('2d').getImageData(0, 0, canvas.width, canvas.height).data;
      const b = canvas.getContext('2d').getImageData(0, 0, canvas.width, canvas.height).data;
      return a.every((v, i) => v === b[i]);
    });
    assert.equal(equal, true);
    assert.equal(await page.evaluate(() => JSON.parse(localStorage.getItem('zijing-studio-v1-saved')).length), 1, 'Preview must not save');
    await close();
  });
  let originalPixels, firstPng;
  await check('Saving opens artwork, stores a recipe instead of pixels and exports a valid PNG', async () => {
    await importPlan('四类设施方案', placements);
    await page.getByRole('button', { name: '保存方案', exact: true }).click(); await ready();
    originalPixels = await pixels();
    const records = await page.evaluate(() => JSON.parse(localStorage.getItem('zijing-studio-v1-saved')));
    assert.equal(records.length, 2); assert.equal(records[0].artwork.version, 'zijing-plan-artwork-v1');
    assert.equal(records[0].artwork.facilities.RG.depth, 120);
    assert.equal(records[0].artwork.facilities.RG.treeArea, placements[1].area);
    assert(!JSON.stringify(records).includes('data:image/'), 'Large image data must not be stored in localStorage');
    firstPng = await download('saved-plan.png');
    assert.equal(firstPng.subarray(0, 8).toString('hex'), '89504e470d0a1a0a');
    assert.equal(firstPng.readUInt32BE(16), 1484); assert.equal(firstPng.readUInt32BE(20), 1330);
    await dialog().screenshot({ path: dir + '/desktop.png' });
    await close();
  });
  await check('Parameter changes affect the new image while saved snapshots remain stable after reload', async () => {
    const changed = placements.map(p => p.facility === 'RG' ? { ...p, area: p.area * 1.5, depth: 180, trees: false } : p);
    await importPlan('调整后的草稿', changed);
    await page.getByRole('button', { name: '查看效果图', exact: true }).click(); await ready();
    assert.notEqual(await pixels(), originalPixels); await close();
    await page.reload(); await page.getByTestId('sandbox-landscape').waitFor(); await notebook();
    await page.getByRole('button', { name: '查看四类设施方案的效果图', exact: true }).locator('[data-artwork-state="ready"]').waitFor();
    await page.getByRole('button', { name: '查看四类设施方案的效果图', exact: true }).click(); await ready();
    assert.equal(await pixels(), originalPixels);
    const again = await download('saved-plan-reloaded.png');
    assert.equal(createHash('sha256').update(again).digest('hex'), createHash('sha256').update(firstPng).digest('hex'));
    await close(); await notebook();
    await page.getByRole('button', { name: '查看旧方案的效果图', exact: true }).click(); await ready();
    await close();
  });
  await check('PNG preview fits mobile and preserves keyboard focus', async () => {
    await page.setViewportSize({ width: 390, height: 844 });
    const button = page.getByRole('button', { name: '查看效果图', exact: true });
    await button.click(); await ready();
    assert.equal(await dialog().evaluate(el => el.scrollWidth <= el.clientWidth + 1), true);
    await dialog().screenshot({ path: dir + '/mobile.png' }); await close();
    assert.equal(await button.evaluate(el => document.activeElement === el), true);
  });
  await check('A failed image load retains the saved plan and can be retried', async () => {
    const badContext = await browser.newContext({ viewport: { width: 1280, height: 950 } });
    const bad = await badContext.newPage();
    const pattern = '**/sandbox/artwork/zijing-v1/base.png';
    await bad.route(pattern, route => route.abort());
    await bad.goto(new URL('/sandbox', base).href); await bad.getByTestId('sandbox-landscape').waitFor();
    await bad.getByRole('button', { name: '保存方案', exact: true }).click();
    const d = bad.getByRole('dialog', { name: '方案效果图', exact: true });
    await d.locator('[data-artwork-state="error"]').waitFor();
    assert.equal(await bad.evaluate(() => JSON.parse(localStorage.getItem('zijing-studio-v1-saved')).length), 1);
    await bad.unroute(pattern); await d.getByRole('button', { name: '重新生成', exact: true }).click();
    await d.locator('[data-artwork-state="ready"]').waitFor(); await badContext.close();
  });
  assert.deepEqual(errors, []);
  writeFileSync(dir + '/verification.json', JSON.stringify({ checks, errors }, null, 2));
} finally { await browser.close(); }
