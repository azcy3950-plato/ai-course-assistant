// Real pointer interactions on the landscape, backed by model placements and per-zone pixels.
import assert from 'node:assert/strict';
import { chromium } from 'playwright';
import { mkdirSync, writeFileSync } from 'node:fs';

const base = process.argv[2] || process.env.SANDBOX_BASE_URL || 'http://localhost:3000';
assert(['localhost', '127.0.0.1', '[::1]'].includes(new URL(base).hostname), 'Only local test URLs allowed');
const dir = 'artifacts/sandbox-landscape-editing';
mkdirSync(dir, { recursive: true });
const browser = await chromium.launch({ headless: true, channel: process.env.PLAYWRIGHT_CHANNEL || undefined });
const page = await browser.newPage({ viewport: { width: 1440, height: 1040 } });
const errors = [], checks = [];
page.on('pageerror', error => errors.push(error.message));
const image = () => page.getByTestId('sandbox-landscape');
const panel = () => page.getByTestId('landscape-selection');
const draft = () => page.evaluate(() => JSON.parse(localStorage.getItem('zijing-studio-v1')));
const camera = () => image().locator('[data-camera]').getAttribute('transform');
const ready = () => image().locator('..').and(page.locator('[data-artwork-state="ready"]')).waitFor();
const signature = () => image().locator('..').getAttribute('data-artwork-signature');
const changed = previous => page.waitForFunction(previous => {
  const el = document.querySelector('[data-testid="sandbox-landscape"]')?.parentElement;
  return el?.dataset.artworkSignature !== previous && el?.dataset.artworkState === 'ready';
}, previous);
const facilities = [['GR','绿色屋顶','roof'], ['VS','植草沟','green'], ['RG','雨水花园','green'], ['PP','透水铺装','road']];
let patches;
const area = async (zone, code) => (await draft()).placements.filter(p => patches.get(p.patchId).zone === zone && p.facility === code).reduce((sum,p) => sum + p.area, 0);
async function check(name, fn) { await fn(); checks.push(name); console.log('PASS ' + name); }
async function closePanel() { if (await panel().isVisible()) await panel().getByLabel('关闭景观配置').click(); }
// A polygon's bounding-box center may be in a hole or behind a floating panel.
async function hitPoint(selector) {
  await image().scrollIntoViewIfNeeded();
  return image().locator(selector).evaluate(el => {
    for (const child of el.querySelectorAll('polygon,rect')) {
      const b = child.getBoundingClientRect();
      for (const fy of [.5,.25,.75,.1,.9]) for (const fx of [.5,.25,.75,.1,.9]) {
        const x = b.x + b.width * fx, y = b.y + b.height * fy;
        if (x < 0 || y < 0 || x >= innerWidth || y >= innerHeight) continue;
        if (el.contains(document.elementFromPoint(x,y))) return { x,y };
      }
    }
    throw new Error('No visible pointer target for ' + el.outerHTML.slice(0,140));
  });
}
async function click(selector) { const p = await hitPoint(selector); await page.mouse.click(p.x,p.y); }
async function space(zone, surface) { await closePanel(); await click('g[data-landscape-space="Z'+String(zone).padStart(2,'0')+'-'+surface+'"]:not([data-landscape-facility])'); await panel().waitFor(); }
async function drag(name, zone, surface) {
  await closePanel();
  await page.getByRole('button', { name: '查看全图', exact: true }).click();
  const p = await hitPoint('g[data-landscape-space="Z'+String(zone).padStart(2,'0')+'-'+surface+'"]:not([data-landscape-facility])');
  const tool = page.getByRole('button', { name: new RegExp('^' + name + ' ') });
  const b = await tool.boundingBox(); assert(b);
  await page.mouse.move(b.x+b.width/2,b.y+b.height/2); await page.mouse.down();
  await page.mouse.move(p.x,p.y,{steps:30}); await page.mouse.move(p.x+1,p.y+1); await page.mouse.up();
}
async function pixels() {
  return image().locator('[data-landscape-image]').evaluate(async el => {
    const source = new Image(); source.src = el.getAttribute('href'); await source.decode();
    const c = document.createElement('canvas'); c.width = source.naturalWidth; c.height = source.naturalHeight;
    c.getContext('2d').drawImage(source,0,0); return c.toDataURL('image/png');
  });
}
async function pixelDelta(previous, zone) {
  return image().locator('[data-landscape-image]').evaluate(async (el,{previous,zone}) => {
    const read = async src => { const i = new Image(); i.src = src; await i.decode(); const c = document.createElement('canvas'); c.width=i.naturalWidth;c.height=i.naturalHeight;const ctx=c.getContext('2d');ctx.drawImage(i,0,0);return ctx.getImageData(0,0,c.width,c.height); };
    const a = await read(previous), b = await read(el.getAttribute('href'));
    let inside=0,outside=0;
    const boundary = document.querySelector('[data-landscape-zone-boundary="'+zone+'"]');
    const path = new Path2D(); Array.from({length:boundary.points.numberOfItems},(_,n)=>boundary.points.getItem(n)).forEach((p,n)=>n?path.lineTo(p.x,p.y):path.moveTo(p.x,p.y)); path.closePath();
    const ctx = document.createElement('canvas').getContext('2d'); ctx.lineWidth=2;
    for(let n=0;n<a.data.length;n+=4) if(a.data[n]!==b.data[n]||a.data[n+1]!==b.data[n+1]||a.data[n+2]!==b.data[n+2]) {
      const pixel=n/4,x=pixel%a.width,y=Math.floor(pixel/a.width);
      // Allow the one-pixel antialias fringe at a clipped diagonal boundary.
      if(ctx.isPointInPath(path,x+.5,y+.5)||ctx.isPointInStroke(path,x+.5,y+.5))inside++;else outside++;
    }
    return {inside,outside};
  },{previous,zone});
}

try {
  await page.goto(new URL('/sandbox',base).href); await page.getByTestId('sandbox-2d').waitFor();
  const model = await page.request.get(new URL('/api/sandbox/model',base).href).then(r => r.json());
  patches = new Map(model.patches.map(p => [p.id,p]));
  await page.getByRole('button', { name: '景观效果', exact: true }).click(); await ready();
  const emptyPixels = await pixels();
  await check('Landscape labels select and focus Z10', async () => {
    const before = await camera(); await click('[data-zone-label="10"]');
    assert.equal(await page.getByLabel('跳转片区').inputValue(),'10');
    assert.notEqual(await camera(),before);
  });
  await check('Each landscape surface adds compatible facilities to Z10 and renders only that zone', async () => {
    const basePixels = await pixels();
    for (const [code,name,surface] of facilities) {
      await space(10,surface); assert.match(await panel().textContent(),/Z10/);
      const before = await signature();
      await panel().getByRole('button', { name: '＋ '+name+' 50 m²', exact: true }).click(); await changed(before);
      assert(Math.abs(await area(10,code)-50)<1e-6,name);
      assert.equal(await image().locator('[data-landscape-facility="'+code+'"][data-zone="10"]').count(),1);
    }
    assert((await draft()).placements.every(p => patches.get(p.patchId).zone===10 && patches.get(p.patchId).surface===facilities.find(f=>f[0]===p.facility)[2]));
    const delta = await pixelDelta(basePixels,10);
    assert(delta.inside>100); assert.equal(delta.outside,0,'Z10 configuration painted a different zone');
    await closePanel(); await page.screenshot({path:dir+'/z10-desktop.png'});
  });
  await check('Native drag uses the drop zone and rejects incompatible roof placement', async () => {
    const before=await signature(); await drag('雨水花园',1,'green'); await changed(before);
    assert.equal(await page.getByLabel('跳转片区').inputValue(),'1');
    assert(Math.abs(await area(1,'RG')-50)<1e-6); assert(Math.abs(await area(10,'RG')-50)<1e-6);
    const placements=JSON.stringify((await draft()).placements);
    await drag('雨水花园',10,'roof');
    await page.getByText('屋顶不能布置雨水花园。请选择绿地。',{exact:true}).waitFor();
    assert.equal(JSON.stringify((await draft()).placements),placements);
  });
  await check('Facility markers edit, remove and undo one facility without disturbing the others', async () => {
    await page.getByLabel('跳转片区').selectOption('10'); await closePanel();
    await click('[data-landscape-facility="GR"][data-zone="10"]'); await panel().waitFor();
    await panel().getByLabel('绿色屋顶合计面积',{exact:true}).fill('120');
    let before=await signature(); await panel().getByRole('button',{name:'应用面积',exact:true}).click(); await changed(before);
    assert(Math.abs(await area(10,'GR')-120)<1e-6);
    await closePanel(); await click('[data-landscape-facility="VS"][data-zone="10"]');
    before=await signature(); await panel().getByLabel('删除植草沟',{exact:true}).click(); await changed(before);
    assert.equal(await area(10,'VS'),0);
    for(const code of ['RG','PP'])assert(Math.abs(await area(10,code)-50)<1e-6);
    assert.equal(await image().locator('[data-landscape-facility="VS"][data-zone="10"]').count(),0);
    before=await signature(); await page.getByLabel('撤销',{exact:true}).click(); await changed(before);
    assert(Math.abs(await area(10,'VS')-50)<1e-6);
    assert.equal(await image().locator('[data-landscape-facility="VS"][data-zone="10"]').count(),1);
  });
  await check('Saving captures per-zone artwork and reload and view switching preserve the same configuration', async () => {
    const original=await pixels(), items=JSON.stringify((await draft()).placements);
    await page.getByRole('button',{name:'保存方案',exact:true}).click();
    const dialog=page.getByRole('dialog',{name:'方案效果图',exact:true});await dialog.locator('[data-artwork-state="ready"]').waitFor();
    assert.equal(await dialog.locator('canvas').evaluate(c=>c.toDataURL('image/png')),original);
    const saved=await page.evaluate(()=>JSON.parse(localStorage.getItem('zijing-studio-v1-saved'))[0]);
    assert.equal(saved.artwork.version,'zijing-plan-artwork-v2');assert(Math.abs(saved.artwork.zones[10].facilities.GR.area-120)<1e-6);
    await page.keyboard.press('Escape');
    await page.getByRole('button',{name:'俯视编辑',exact:true}).click(); await page.getByTestId('sandbox-2d').waitFor();
    assert.equal(JSON.stringify((await draft()).placements),items);
    await page.getByRole('button',{name:'景观效果',exact:true}).click();await ready();assert.equal(await pixels(),original);
    await page.reload();await page.getByTestId('sandbox-2d').waitFor();
    await page.getByRole('button',{name:'景观效果',exact:true}).click();await ready();
    assert.equal(await pixels(),original);assert.equal(JSON.stringify((await draft()).placements),items);
  });
  await check('Mobile landscape supports selection and facility editing without overflow', async () => {
    await page.setViewportSize({width:390,height:844});
    await page.getByLabel('跳转片区').selectOption('10'); await closePanel();
    await click('[data-landscape-facility="GR"][data-zone="10"]');await panel().waitFor();
    await panel().getByLabel('绿色屋顶合计面积',{exact:true}).fill('130');
    const before=await signature();await panel().getByRole('button',{name:'应用面积',exact:true}).click();await changed(before);
    assert(Math.abs(await area(10,'GR')-130)<1e-6);
    assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1),true);
    await page.screenshot({path:dir+'/z10-mobile.png'});
  });
  await check('All ten zones expose each surface and keep their artwork within that zone', async () => {
    await page.setViewportSize({width:1440,height:1040});
    for (let zone=1;zone<=10;zone++) {
      await closePanel();
      const items = facilities.map(([facility,_name,surface]) => {
        const p = model.patches.filter(p => p.zone===zone && p.surface===surface).sort((a,b)=>b.area-a.area)[0];
        return {id:'zone-'+zone+'-'+facility,patchId:p.id,facility,area:Math.min(50,p.area*.2),depth:facility==='PP'?65:100,trees:false};
      });
      const before = await signature();
      await page.locator('input[type="file"]').setInputFiles({name:'zone.json',mimeType:'application/json',buffer:Buffer.from(JSON.stringify({version:model.version,name:'片区 '+zone,rain:'5A',placements:items}))});
      await changed(before);await page.getByLabel('跳转片区').selectOption(String(zone));
      for (const surface of ['roof','road','green']) { await space(zone,surface);assert.match(await panel().textContent(),new RegExp('Z'+String(zone).padStart(2,'0'))); }
      assert.equal(await image().locator('[data-landscape-facility][data-zone="'+zone+'"]').count(),4);
      const delta = await pixelDelta(emptyPixels,zone);
      assert(delta.inside>100,'No facility pixels for zone '+zone); assert.equal(delta.outside,0,'Facility pixels leaked from zone '+zone);
    }
  });
  await check('Mentor suggestions preserve other landscape facilities in the same zone', async () => {
    const original = await draft(), previousArea = await area(10,'RG');
    await page.goto(new URL('/sandbox?mentor=rain-garden',base).href);await page.getByTestId('sandbox-2d').waitFor();
    await page.getByLabel('跳转片区').selectOption('10');
    const mentor = page.getByTestId('mentor-experiment');await mentor.waitFor();
    await mentor.getByRole('button',{name:'应用建议',exact:true}).click();
    await page.getByRole('button',{name:'景观效果',exact:true}).click();await ready();
    assert(Math.abs(await area(10,'RG')-previousArea-50)<1e-6);
    assert.deepEqual((await draft()).placements.filter(p=>p.facility!=='RG'),original.placements.filter(p=>p.facility!=='RG'));
    assert.equal(await image().locator('[data-landscape-facility="RG"][data-zone="10"]').count(),1);
    await closePanel();await click('[data-landscape-facility="GR"][data-zone="10"]');await panel().waitFor();
    await panel().getByLabel('绿色屋顶合计面积',{exact:true}).fill('120');
    const before = await signature();await panel().getByRole('button',{name:'应用面积',exact:true}).click();await changed(before);
    assert(Math.abs(await area(10,'RG')-previousArea-50)<1e-6);
    assert.equal(await mentor.getByRole('button',{name:'运行实验',exact:true}).isEnabled(),true);
  });
  assert.deepEqual(errors,[]);writeFileSync(dir+'/verification.json',JSON.stringify({checks,errors},null,2));
} catch(error) {
  await page.screenshot({path:dir+'/failure.png'});
  writeFileSync(dir+'/failure.json',JSON.stringify({checks,errors,message:String(error)},null,2));
  throw error;
} finally {await browser.close();}
