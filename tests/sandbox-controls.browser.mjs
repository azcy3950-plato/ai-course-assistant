// Local-only regression checks against actual rendered SVG and native browser input.
// Run: node tests/sandbox-controls.browser.mjs http://127.0.0.1:3030
import assert from 'node:assert/strict';
import { chromium } from 'playwright';
import { mkdirSync, writeFileSync } from 'node:fs';
const url = new URL('/sandbox',process.argv[2] || process.env.SANDBOX_BASE_URL || 'http://127.0.0.1:3000').href;
assert(['localhost', '127.0.0.1', '[::1]'].includes(new URL(url).hostname), 'Only local test URLs allowed');
const dir = 'artifacts/sandbox-controls-qa';
mkdirSync(dir, {recursive:true});
const browser = await chromium.launch({channel:process.env.PLAYWRIGHT_CHANNEL || undefined, headless:true});
const page = await browser.newPage({viewport:{width:1440,height:1000}});
const errors = [], checks = [];
page.on('pageerror', e => errors.push(e.message));
page.on('console', m => { if(m.type()==='error' && /passive|ReferenceError|TypeError/.test(m.text())) errors.push(m.text()); });
let mode = '2d';
const svg = () => page.getByTestId('sandbox-' + mode);
const state = () => svg().evaluate(el => el.querySelector('[data-camera]').getAttribute('transform'));
const selected = () => page.getByLabel('当前空间', {exact:true}).inputValue();
const settle = () => page.waitForTimeout(100);
async function check(name, fn) { await fn(); checks.push(name); console.log('PASS ' + name); }
async function reset() { await page.getByRole('button',{name:'重置视图',exact:true}).click(); await settle(); }
async function screenPoint(blank = false, surface = null) {
  return svg().evaluate((el,{blank,surface}) => {
    const r=el.getBoundingClientRect();
    if(blank){
      for(let y=r.top+85;y<r.bottom-65;y+=13)for(let x=r.left+12;x<r.right-12;x+=17){
        const hit=document.elementFromPoint(x,y);
        if(hit && el.contains(hit) && !hit.closest('[data-patch]'))return {x,y};
      }
    } else {
      for(const p of el.querySelectorAll(surface ? '[data-patch][data-surface="'+surface+'"]' : '[data-patch]')){
        const r2=p.getBoundingClientRect();
        if(r2.width<6||r2.height<6)continue;
        for(const fx of [.5,.3,.7])for(const fy of [.5,.3,.7]){
          const x=Math.floor(r2.left+r2.width*fx),y=Math.floor(r2.top+r2.height*fy);
          if(x<r.left+8||x>r.right-8||y<r.top+80||y>r.bottom-65)continue;
          if(document.elementFromPoint(x,y)?.closest('[data-patch]')===p)return {x,y,id:p.getAttribute('data-patch')};
        }
      }
    }
    throw Error('No visible test point found');
  },{blank,surface});
}
async function worldAt(p) { return svg().evaluate((el,p) => {const m=el.querySelector('[data-camera]').getScreenCTM();const v=new DOMPoint(p.x,p.y).matrixTransform(m.inverse());return {x:v.x,y:v.y};},p); }
async function project(p) { return svg().evaluate((el,p) => {const v=new DOMPoint(p.x,p.y).matrixTransform(el.querySelector('[data-camera]').getScreenCTM());return {x:v.x,y:v.y};},p); }
async function drag(from,to) {await page.mouse.move(from.x,from.y);await page.mouse.down();await page.mouse.move(to.x,to.y,{steps:8});await page.mouse.up();await settle();}
async function hold(key,ms=230,fast=false){await svg().focus();if(fast)await page.keyboard.down('Shift');await page.keyboard.down(key);await page.waitForTimeout(ms);await page.keyboard.up(key);if(fast)await page.keyboard.up('Shift');await settle();}
try {
  await page.goto(url.endsWith('/sandbox')?url:url+'/sandbox');
  await svg().waitFor({state:'visible'});
  await svg().scrollIntoViewIfNeeded();
  await settle();
  const modelBefore = await page.request.get(new URL('/api/sandbox/model',url).href).then(r=>r.text());
  await check('2D/3D: continuous cursor anchored wheel zoom, buttons, pan, selection, keyboard, reset', async()=>{
    for(const nextMode of ['2d','3d']){
      mode=nextMode;
      await page.getByRole('button',{name:mode==='2d'?'俯视编辑':'三维查看',exact:true}).click();
      await svg().scrollIntoViewIfNeeded();await reset();
      const p=await screenPoint(false), world=await worldAt(p), scroll=await page.evaluate(()=>scrollY);
      await page.mouse.move(p.x,p.y);
      for(let i=0;i<5;i++){await page.mouse.wheel(0,-65);await settle();}
      const after=await project(world);
      assert(Math.hypot(after.x-p.x,after.y-p.y)<.3, mode+' cursor anchor drift '+JSON.stringify({p,after,scroll,nowScroll:await page.evaluate(()=>scrollY),camera:await state()}));
      assert.equal(await page.evaluate(()=>scrollY),scroll,'wheel scrolled page inside canvas');
      for(let i=0;i<5;i++){await page.mouse.wheel(0,65);await settle();}
      assert(Math.hypot((await project(world)).x-p.x,(await project(world)).y-p.y)<.3);
      const box=await svg().boundingBox(),center={x:box.x+box.width/2,y:box.y+box.height/2},centerWorld=await worldAt(center);
      await page.getByRole('button',{name:'放大视图',exact:true}).click();await settle();
      const centerAfter=await project(centerWorld);assert(Math.hypot(centerAfter.x-center.x,centerAfter.y-center.y)<.3);
      await reset();
      const initial=await state(), picked=await selected(), blank=await screenPoint(true);
      await page.mouse.move(blank.x,blank.y);await page.mouse.down();await page.mouse.move(blank.x+2,blank.y+2);await settle();
      assert.equal(await state(),initial,'threshold moved view');await page.mouse.up();
      await drag(blank,{x:blank.x+75,y:blank.y+40});assert.notEqual(await state(),initial);assert.equal(await selected(),picked);
      await reset();
      const obj=await screenPoint(false);
      await drag(obj,{x:obj.x+25,y:obj.y+20});assert.equal(await state(),initial,'object drag without Space panned');assert.equal(await selected(),picked,'object drag misselected');
      await svg().focus();await page.keyboard.down('Space');
      await drag(obj,{x:obj.x+70,y:obj.y+35});await page.keyboard.up('Space');
      assert.notEqual(await state(),initial);assert.equal(await selected(),picked,'pan misselected');
      await reset();const obj2=await screenPoint(false);await page.mouse.click(obj2.x,obj2.y);await settle();
      assert.equal(await selected(),obj2.id);assert.equal(await state(),initial,'selection reset camera');
      await hold('ArrowRight');const regular=await project(world);assert.notEqual(await state(),initial);
      await reset();const start=await project(world);await hold('d',230,true);const accelerated=await project(world);
      assert(Math.abs(accelerated.x-start.x)>Math.abs(regular.x-start.x)*1.5,'Shift did not accelerate');
      for(const key of ['ArrowUp','ArrowDown','ArrowLeft','w','a','s']){const before=await state();await hold(key,80);assert.notEqual(await state(),before,key+' did not pan');}
      await svg().press('=');const plus=await state();await svg().press('-');assert.notEqual(await state(),plus);
      await svg().press('r');await settle();assert.equal(await state(),initial,'R failed to reset');
      checks.push(mode+' mouse/keyboard passed');
    }
  });
  mode='2d';await page.getByRole('button',{name:'俯视编辑',exact:true}).click();await svg().scrollIntoViewIfNeeded();await reset();
  await check('Escape, Space release, pointer capture outside canvas and blur stop movement',async()=>{
    const initial=await state(),p=await screenPoint(false);
    await svg().focus();await page.keyboard.down('Space');await page.mouse.move(p.x,p.y);await page.mouse.down();await page.mouse.move(p.x+30,p.y+30,{steps:4});await settle();
    assert.equal(await svg().getAttribute('data-dragging'),'true');
    await page.keyboard.press('Escape');const stopped=await state();await page.mouse.move(p.x+80,p.y+80);await page.mouse.up();await page.keyboard.up('Space');await settle();
    assert.equal(await state(),stopped);assert.equal(await svg().getAttribute('data-dragging'),'false');
    await reset();await svg().focus();await page.keyboard.down('Space');const q=await screenPoint(false);await page.mouse.move(q.x,q.y);await page.mouse.down();await page.mouse.move(q.x+25,q.y+25);await page.keyboard.up('Space');const released=await state();await page.mouse.move(q.x+70,q.y+70);await page.mouse.up();await settle();assert.equal(await state(),released);
    await reset();const blank=await screenPoint(true),box=await svg().boundingBox();await drag(blank,{x:box.x+box.width/2,y:box.y-30});
    assert.equal(await svg().getAttribute('data-dragging'),'false');const outside=await state();await page.mouse.move(blank.x,blank.y);await settle();assert.equal(await state(),outside);
    await reset();await svg().focus();await page.keyboard.down('a');await page.waitForTimeout(90);await page.getByLabel('方案名称').focus();const blurred=await state();await page.waitForTimeout(180);await page.keyboard.up('a');assert.equal(await state(),blurred);
    assert.notEqual(initial,outside);
  });
  await check('Form editing, dropdowns, external focus, modal and browser Ctrl shortcuts',async()=>{
    await reset();const before=await state();
    await page.getByLabel('方案名称').fill('wasd R + - = 测试');
    await page.getByLabel('方案名称').press('ArrowLeft');assert.equal(await state(),before);
    await page.getByLabel('设施占地面积').fill('35');await page.getByLabel('设施占地面积').press('ArrowUp');assert.equal(await state(),before);
    await page.getByLabel('降雨情景').selectOption('10A');assert.equal(await state(),before);
    await page.getByRole('button',{name:'保存方案',exact:true}).focus();await page.keyboard.press('r');assert.equal(await state(),before);
    await page.getByLabel('更多操作',{exact:true}).click();
    await page.getByRole('button',{name:'使用指南',exact:true}).click();assert(await page.getByRole('dialog').isVisible());
    await svg().focus();await page.keyboard.press('=');await hold('d',100);assert.equal(await state(),before,'modal did not pause shortcuts');
    await page.getByRole('button',{name:'关闭窗口',exact:true}).click();
    await page.getByLabel('更多操作',{exact:true}).click();
    await svg().focus();
    await page.evaluate(()=>{window.shortcutEvents=[];document.addEventListener('keydown',e=>{if(e.ctrlKey||e.metaKey)window.shortcutEvents.push({key:e.key,prevented:e.defaultPrevented})});});
    await page.keyboard.press('Control+=');await page.keyboard.press('Control+0');await settle();
    assert.equal(await state(),before);
    const events=await page.evaluate(()=>window.shortcutEvents);assert(events.length>0&&events.every(e=>!e.prevented));
  });
  await check('View is preserved by object selection, facility drop, data updates and 2D/3D switching',async()=>{
    await reset();
    await page.getByRole('button',{name:'Z05',exact:true}).click();await settle();
    await page.getByRole('button',{name:'放大视图',exact:true}).click();await hold('ArrowLeft',90);
    const before=await state(),p=await screenPoint(false,'green');
    await page.mouse.click(p.x,p.y);await settle();assert.equal(await state(),before);
    const id=p.id;
    const source=page.locator('button[draggable=true]').filter({hasText:'雨水花园'});
    const box=await source.boundingBox();
    await page.mouse.move(box.x+box.width/2,box.y+box.height/2);await page.mouse.down();await page.mouse.move(p.x,p.y,{steps:30});await page.mouse.move(p.x+1,p.y+1);await page.mouse.up();await settle();
    const stored=await page.evaluate(()=>JSON.parse(localStorage.getItem('zijing-studio-v1')));
    assert(stored.placements.some(x=>x.patchId===id&&x.facility==='RG'),'native facility drop missed the selected polygon');
    assert.equal(await state(),before,'drop changed view');
    await page.getByLabel('排水管网').check();assert.equal(await state(),before);
    await page.getByRole('button',{name:'三维查看',exact:true}).click();mode='3d';await svg().scrollIntoViewIfNeeded();
    const threeBefore=await state();await page.getByRole('button',{name:'向右旋转',exact:true}).click();assert.equal(await state(),threeBefore,'rotation altered pan/zoom');
    await page.getByRole('button',{name:'俯视编辑',exact:true}).click();mode='2d';assert.equal(await state(),before,'switch discarded 2D camera');
    const storedAfter=await page.evaluate(()=>JSON.parse(localStorage.getItem('zijing-studio-v1')));
    assert.deepEqual(storedAfter.placements,stored.placements);
  });
  await check('Calculation response preserves camera without a playback timeline (UI fixture only)',async()=>{
    await page.route('**/api/sandbox/run',async route=>{
      const body=route.request().postDataJSON();
      const canonical=JSON.stringify([body.rain,body.placements.map(p=>[p.patchId,p.facility,p.area,p.depth,p.trees]).sort((a,b)=>JSON.stringify(a).localeCompare(JSON.stringify(b)))]);
      let hash=2166136261;for(let i=0;i<canonical.length;i++){hash^=canonical.charCodeAt(i);hash=Math.imul(hash,16777619);}
      const times=Array.from({length:60},(_,i)=>i/12),values=times.map((_,i)=>.5+Math.sin(i/10)*.2);
      const hydro={source:'SWMM',engine:'UI_TEST_FIXTURE',times,runoff:values,outflow:values,runoffVolume:10,peakFlow:.7,floodVolume:0,maxDepth:1,continuity:{runoff:0,routing:0,quality:0},pollutants:{},zoneRunoff:{},nodeDepth:Object.fromEntries(JSON.parse(modelBefore).nodes.map(n=>[n.id,values]))};
      // Controlled stream is used only in this isolated test context, never served by production code.
      await route.fulfill({json:{id:'ui-test',signature:(hash>>>0).toString(16),baseline:hydro,proposed:hydro,eco:{annual:{total:0}},baselineEco:{annual:{total:0}},warnings:['UI interaction test fixture']}});
    });
    const before=await state();await page.getByRole('button',{name:'运行计算',exact:true}).click();
    await page.getByText('SWMM 计算完成',{exact:true}).waitFor();
    assert.equal(await state(),before,'calculation response reset camera');
    assert.equal(await page.getByLabel('水位回放时间轴').count(),0);
    await page.unroute('**/api/sandbox/run');await svg().scrollIntoViewIfNeeded();
  });
  await check('Focus mode drawers allow selection and facility drop without an overlay blocking the map',async()=>{
    await page.getByRole('button',{name:'专注编辑 ↗',exact:true}).click();await svg().scrollIntoViewIfNeeded();await reset();
    await page.getByRole('button',{name:'设施工具箱',exact:true}).click();await settle();
    const p=await screenPoint(false,'green'),source=page.locator('button[draggable=true]').filter({hasText:'雨水花园'}),b=await source.boundingBox();
    const total=await page.evaluate(()=>JSON.parse(localStorage.getItem('zijing-studio-v1')).placements.reduce((s,p)=>s+p.area,0));
    await page.mouse.move(b.x+b.width/2,b.y+b.height/2);await page.mouse.down();await page.mouse.move(p.x,p.y,{steps:30});await page.mouse.move(p.x+1,p.y+1);await page.mouse.up();await settle();
    const afterDrop=await page.evaluate(()=>JSON.parse(localStorage.getItem('zijing-studio-v1')).placements.reduce((s,p)=>s+p.area,0));
    assert(afterDrop>total,'native facility drop did not add grouped area');
    await page.getByRole('button',{name:'关闭设施工具箱',exact:true}).click();
    await page.screenshot({path:dir+'/focus.png'});
    await page.getByRole('button',{name:'三维查看',exact:true}).click();mode='3d';await reset();
    await page.getByRole('button',{name:'向右旋转',exact:true}).click();
    const first=await page.getByRole('button',{name:'向右旋转',exact:true}).boundingBox(),second=await page.getByRole('button',{name:'放大视图',exact:true}).boundingBox();
    assert(first.x>second.x+second.width,'rotation and zoom buttons overlap');
    await page.screenshot({path:dir+'/three.png'});
    await page.getByRole('button',{name:'俯视编辑',exact:true}).click();mode='2d';
    await page.getByRole('button',{name:'退出专注',exact:true}).click();await svg().scrollIntoViewIfNeeded();
  });
  await check('Zoom limits, bounded pan, explicit refit and all-view reset',async()=>{
    await reset();const initial=await state();await svg().focus();
    for(let i=0;i<25;i++)await page.keyboard.press('=');
    assert.equal(await page.getByLabel('缩放比例',{exact:true}).filter({visible:true}).textContent(),'1600%');
    for(let i=0;i<50;i++)await page.keyboard.press('-');
    assert.equal(await page.getByLabel('缩放比例',{exact:true}).filter({visible:true}).textContent(),'50%');
    await hold('ArrowRight',1800,true);const edge=await state();await hold('ArrowRight',300,true);assert.equal(await state(),edge,'pan not bounded');
    await page.getByRole('button',{name:'查看全图',exact:true}).click();await settle();assert.equal(await state(),initial);
    await page.getByRole('button',{name:'Z03',exact:true}).click();await settle();const fit=await state();assert.notEqual(fit,initial);
    await hold('s',100);await page.getByRole('button',{name:'Z03',exact:true}).click();await settle();assert.equal(await state(),fit,'same zone explicit refit failed');
    await reset();assert.equal(await state(),initial);
  });
  await check('Wheel outside the canvas scrolls the page',async()=>{
    // Use the page gutter, outside both the canvas and the independently scrolling sidebars.
    const before=await page.evaluate(()=>scrollY);await page.mouse.move(8,180);await page.mouse.wheel(0,350);await settle();assert.notEqual(await page.evaluate(()=>scrollY),before);
  });
  await check('Data remains unchanged by navigation and no browser runtime errors',async()=>{
    assert.equal(await page.request.get(new URL('/api/sandbox/model',url).href).then(r=>r.text()),modelBefore);
    assert.deepEqual(errors,[]);
  });
  await svg().scrollIntoViewIfNeeded();
  await page.screenshot({path:dir+'/desktop.png',fullPage:true});
  await check('Narrow viewport preserves input mapping',async()=>{
    await page.setViewportSize({width:740,height:920});await svg().scrollIntoViewIfNeeded();await reset();
    const p=await screenPoint(false),w=await worldAt(p);await page.mouse.move(p.x,p.y);await page.mouse.wheel(0,-90);await settle();const after=await project(w);assert(Math.hypot(after.x-p.x,after.y-p.y)<.3);
    await page.screenshot({path:dir+'/narrow.png'});
  });
  writeFileSync(dir+'/results.json',JSON.stringify({url,checks,errors},null,2));
  console.log('All '+checks.length+' checks passed');
} catch(e) {
  await page.screenshot({path:dir+'/failure.png',fullPage:true}).catch(()=>{});
  writeFileSync(dir+'/results.json',JSON.stringify({url,checks,errors,failure:String(e)},null,2));
  console.error(e);process.exitCode=1;
} finally {await browser.close();}
