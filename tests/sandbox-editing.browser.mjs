// Regression for choosing a zone, adding all four facilities independently, and seeing them on the editable map.
import assert from 'node:assert/strict';
import { chromium } from 'playwright';
import { mkdirSync } from 'node:fs';

const base = process.argv[2] || process.env.SANDBOX_BASE_URL || 'http://localhost:3000';
assert(['localhost', '127.0.0.1', '[::1]'].includes(new URL(base).hostname), 'Only local test URLs allowed');
const browser = await chromium.launch({ headless: true, channel: process.env.PLAYWRIGHT_CHANNEL || undefined });
mkdirSync('artifacts/sandbox-editing', { recursive: true });
const page = await browser.newPage({ viewport: { width: 1440, height: 950 } });
const errors = [];
page.on('pageerror', error => errors.push(error.message));
const draft = () => page.evaluate(() => JSON.parse(localStorage.getItem('zijing-studio-v1')));
const facilities = [['GR', '绿色屋顶', 'roof'], ['VS', '植草沟', 'green'], ['RG', '雨水花园', 'green'], ['PP', '透水铺装', 'road']];

try {
  await page.goto(new URL('/sandbox', base).href);
  await page.getByTestId('sandbox-2d').waitFor();
  assert.equal(await page.getByRole('button', { name: '俯视编辑', exact: true }).getAttribute('aria-pressed'), 'true');
  const model = await page.request.get(new URL('/api/sandbox/model', base).href).then(response => response.json());
  const patches = new Map(model.patches.map(patch => [patch.id, patch]));

  await page.getByLabel('跳转片区').selectOption('10');
  assert.equal(await page.getByRole('button', { name: 'Z10', exact: true }).getAttribute('aria-pressed'), 'true');
  assert.match(await page.getByLabel('Z10措施配置').textContent(), /Z10 已布置/);
  const camera = await page.getByTestId('sandbox-2d').locator('[data-camera]').getAttribute('transform');

  for (const [code, name, surface] of facilities) {
    await page.getByRole('button', { name: `添加${name}到Z10`, exact: true }).click();
    await page.waitForFunction(code => {
      const draft = JSON.parse(localStorage.getItem('zijing-studio-v1') || 'null');
      return draft?.placements.some(placement => placement.facility === code);
    }, code);
    const entries = (await draft()).placements.filter(placement => placement.facility === code);
    assert(entries.length > 0, name + ' was not saved');
    assert(entries.every(placement => patches.get(placement.patchId).zone === 10 && patches.get(placement.patchId).surface === surface), name + ' was placed in the wrong zone or surface');
    assert(Math.abs(entries.reduce((sum, placement) => sum + placement.area, 0) - 50) < 1e-6, name + ' did not receive its own 50 m²');
    assert.equal(await page.getByTestId('sandbox-2d').locator(`[data-zone-label="10"] [data-zone-facility="${code}"]`).count(), 1, name + ' has no map marker');
    assert.match(await page.getByLabel('Z10措施配置').textContent(), new RegExp(name + ' 50 m²'));
  }
  assert.equal(await page.getByTestId('sandbox-2d').locator('[data-camera]').getAttribute('transform'), camera, 'adding a facility changed the selected map view');
  await page.getByTestId('sandbox-2d').screenshot({ path: 'artifacts/sandbox-editing/z10-four-facilities.png' });

  await page.getByRole('button', { name: '查看全图', exact: true }).click();
  await page.getByTestId('sandbox-2d').locator('[data-zone-label="5"] > rect').click();
  assert.equal(await page.getByLabel('跳转片区').inputValue(), '5', 'map zone label did not select Z05');
  await page.getByLabel('跳转片区').selectOption('10');
  assert.equal((await draft()).placements.length > 0, true, 'zone navigation lost placements');
  assert.match(await page.getByLabel('Z10措施配置').textContent(), /绿色屋顶 50 m²/);

  await page.setViewportSize({ width: 390, height: 844 });
  await page.getByLabel('跳转片区').selectOption('9');
  await page.getByLabel('跳转片区').selectOption('10');
  assert.equal(await page.getByRole('button', { name: 'Z10', exact: true }).getAttribute('aria-pressed'), 'true');
  assert.deepEqual(errors, []);
  console.log('PASS Z10 selection, four independent facilities, visible map markers, and mobile zone navigation');
} finally {
  await browser.close();
}
