// Local-only acceptance test, using real campus data and real SWMM responses.
// Uses a new browser context: the user's draft and saved plans are not accessed.
import assert from 'node:assert/strict';
import {chromium} from 'playwright';
import {mkdirSync,writeFileSync} from 'node:fs';
const base=process.argv[2]||process.env.SANDBOX_BASE_URL||'http://127.0.0.1:3000';
assert(['localhost','127.0.0.1','[::1]'].includes(new URL(base).hostname),'Local URL required');
const dir='artifacts/sandbox-eco-reset-qa';mkdirSync(dir,{recursive:true});
const browser=await chromium.launch({channel:process.env.PLAYWRIGHT_CHANNEL||undefined,headless:true});
const page=await browser.newPage({viewport:{width:1440,height:1000}});
const checks=[],errors=[];page.on('pageerror',e=>errors.push(e.message));
const reset=()=>page.getByRole('button',{name:'重置方案',exact:true});
const ecoCard=label=>page.getByRole('group',{name:label,exact:true});
const draft=()=>page.evaluate(()=>JSON.parse(localStorage.getItem('zijing-studio-v1')));
const saved=()=>page.evaluate(()=>JSON.parse(localStorage.getItem('zijing-studio-v1-saved')));
const camera=()=>page.getByTestId('sandbox-2d').locator('[data-camera]').getAttribute('transform');
const settle=()=>page.waitForTimeout(120);
async function check(name,fn){await fn();checks.push(name);console.log('PASS '+name);}
async function closeNotice(){const b=page.getByRole('button',{name:'关闭提示',exact:true});if(await b.isVisible())await b.click();}
async function run(){
 const wait=page.waitForResponse(r=>r.url().endsWith('/api/sandbox/run')&&r.request().method()==='POST',{timeout:120000});
 await page.getByRole('button',{name:'运行计算',exact:true}).click();
 assert(await reset().isDisabled(),'reset must be disabled while running');
 const response=await wait,body=await response.json();
 assert.equal(response.status(),200,JSON.stringify(body));assert.equal(body.proposed.source,'SWMM');
 assert(!String(body.proposed.engine).includes('FIXTURE'));return body;
}
try{
 const modelResponse=await page.request.get(base+'/api/sandbox/model');assert(modelResponse.ok());
 const modelText=await modelResponse.text(),campus=JSON.parse(modelText);
 // Include real patches in all ten zones and a negative net carbon balance.
 const placements=campus.zones.map(z=>{
  const patch=campus.patches.filter(p=>p.zone===z.id&&p.surface==='road').sort((a,b)=>b.area-a.area)[0];assert(patch);
  return {id:'reset-test-'+z.id,patchId:patch.id,facility:'PP',area:Math.min(500,patch.area*.8),depth:65,trees:false};
 });
 const green=campus.patches.filter(p=>p.zone===5&&p.surface==='green').sort((a,b)=>b.area-a.area)[0];
 placements.push({id:'reset-test-garden',patchId:green.id,facility:'RG',area:Math.min(50,green.area*.5),depth:100,trees:true});
 const plan={placements,name:'生态服务重置验收',rain:'10A'};
 const otherSaved=[{...plan,id:'saved-before-reset',name:'保留的独立方案',date:'本地测试'}];
 await page.addInitScript(({plan,otherSaved})=>{
  if(!localStorage.getItem('eco-reset-test-initialized')){
   localStorage.setItem('zijing-studio-v1',JSON.stringify(plan));
   localStorage.setItem('zijing-studio-v1-saved',JSON.stringify(otherSaved));
   localStorage.setItem('eco-reset-test-initialized','true');
  }
 },{plan,otherSaved});
 await page.goto(base+'/sandbox');await page.getByTestId('sandbox-2d').waitFor();await settle();
 let ecoBefore={},heroBefore,savedBefore,result;
 await check('Physical indicators appear above smaller monetary values, including negative carbon',async()=>{
  await page.getByRole('button',{name:'生态服务',exact:true}).click();
  for(const label of ['净碳汇','温度调节','空气净化','吸声降噪']){
   const card=ecoCard(label),strong=card.locator('strong'),price=card.locator('p');
   assert(!(await strong.textContent()).includes('¥'));assert((await price.textContent()).startsWith('生态服务价值 ¥'));
   const layout=await card.evaluate(e=>{const s=e.querySelector('strong'),p=e.querySelector('p');return {big:parseFloat(getComputedStyle(s).fontSize),small:parseFloat(getComputedStyle(p).fontSize),top:s.getBoundingClientRect().top,priceTop:p.getBoundingClientRect().top};});
   assert(layout.big>layout.small&&layout.top<layout.priceTop);ecoBefore[label]=await card.textContent();
  }
  assert.match(await ecoCard('净碳汇').locator('strong').textContent(),/年净碳量.*-/);
  assert.match(await ecoCard('净碳汇').locator('p').textContent(),/¥ -/);
  heroBefore=await page.locator('[class*="ecoHero"]').textContent();
  await page.locator('[class*="ecoContent"]').screenshot({path:dir+'/eco-desktop.png'});
 });
 await check('Real calculation and reset disabled while the engine is running',async()=>{
  await page.getByRole('button',{name:'保存方案',exact:true}).click();savedBefore=await saved();
  const view=await camera();result=await run();assert.equal(await camera(),view);
  await page.getByRole('button',{name:'生态服务',exact:true}).click();
  const format=(v,d=0)=>v.toLocaleString('zh-CN',{maximumFractionDigits:d});
  for(const [label,value,precision] of [['净碳汇',result.eco.physical.carbonKg,1],['温度调节',result.eco.physical.electricityKwh,0],['空气净化',result.eco.physical.so2Kg,2],['吸声降噪',result.eco.physical.noiseLength,1]]){
   assert((await ecoCard(label).locator('strong').textContent()).includes(format(value,precision)));
  }
  assert.equal(await page.locator('[class*="ecoHero"]').textContent(),heroBefore);
 });
 await check('Reset clears all ten zones and calculated results but preserves view, rain and saved plans',async()=>{
  await page.getByRole('button',{name:'结果总览',exact:true}).click();
  await page.getByRole('button',{name:'放大视图',exact:true}).click();const view=await camera();
  await reset().click();await settle();
  assert.deepEqual(await draft(),{...plan,placements:[]});assert.deepEqual(await saved(),savedBefore);assert.equal(await camera(),view);
  assert.equal(await page.getByLabel('降雨情景',{exact:true}).inputValue(),'10A');
  assert.equal(await page.getByLabel('空间面积使用率').getAttribute('aria-valuenow'),'0');
  assert.equal(await page.getByLabel('水位回放时间轴').count(),0);assert.equal(await page.getByRole('button',{name:'暂停水位回放',exact:true}).count(),0);
  assert.equal(await page.locator('[data-config]').count(),0);assert(await reset().isDisabled());
  await page.getByRole('button',{name:'生态服务',exact:true}).click();
  for(const label of Object.keys(ecoBefore)){
   assert.match(await ecoCard(label).locator('strong').textContent(),/0/);
   assert.equal(await ecoCard(label).locator('p').textContent(),'生态服务价值 ¥ 0 / 年');
  }
  await page.waitForTimeout(300);assert.equal(await camera(),view);
 });
 await check('Undo and redo preserve the complete facility configuration, with no obsolete results restored',async()=>{
  const view=await camera();await page.getByRole('button',{name:'撤销',exact:true}).click();
  assert.deepEqual((await draft()).placements,placements);assert.equal(await camera(),view);
  for(const label of Object.keys(ecoBefore))assert.equal(await ecoCard(label).textContent(),ecoBefore[label]);
  assert.equal(await page.locator('[class*="ecoHero"]').textContent(),heroBefore);
  await page.getByLabel('更多操作',{exact:true}).click();await page.getByRole('button',{name:'重做',exact:true}).click();
  await page.getByLabel('更多操作',{exact:true}).click();assert.deepEqual((await draft()).placements,[]);
  await page.getByRole('button',{name:'撤销',exact:true}).click();assert.deepEqual((await draft()).placements,placements);
  await page.getByRole('button',{name:'结果总览',exact:true}).click();assert.equal(await page.getByLabel('水位回放时间轴').count(),0);
  assert.deepEqual(await saved(),savedBefore);await closeNotice();
 });
 await check('Reconfigure, save and run a fresh real calculation after reset',async()=>{
  await reset().click();await page.getByLabel('设施占地面积',{exact:true}).fill('25');
  await page.getByRole('button',{name:'＋ 添加到当前空间',exact:true}).click();
  await page.getByRole('button',{name:'保存方案',exact:true}).click();
  const after=await draft();assert(Math.abs(after.placements.reduce((n,p)=>n+p.area,0)-25)<1e-6);
  const fresh=await run();assert.notEqual(fresh.signature,result.signature);assert(Math.abs(fresh.eco.area-25)<1e-6);
  assert.equal(await page.getByLabel('水位回放时间轴').count(),0);
  await closeNotice();
 });
 await check('Mobile controls and long ecological numbers at 360, 390, 560, 768 and 1440 px',async()=>{
  // Restore the real case facilities to exercise longer physical values (not fixed display numbers).
  await page.getByRole('button',{name:'载入案例四类设施 →',exact:true}).click();
  await page.getByRole('button',{name:'生态服务',exact:true}).click();await closeNotice();
  for(const width of [1440,768,560,390,360]){
   await page.setViewportSize({width,height:900});await settle();
   assert(await reset().isVisible());assert(await page.getByRole('button',{name:'保存方案',exact:true}).isVisible());
   const layout=await page.evaluate(()=>({width:innerWidth,scroll:document.documentElement.scrollWidth}));
   assert(layout.scroll<=width+1,'page overflow '+JSON.stringify(layout));
   for(const label of Object.keys(ecoBefore)){
    const sizes=await ecoCard(label).evaluate(e=>({client:e.clientWidth,scroll:e.scrollWidth}));assert(sizes.scroll<=sizes.client+1,label+' overflow at '+width);
   }
   if(width===1440||width===360){
    await page.locator('[class*="ecoContent"]').screenshot({path:dir+'/eco-'+width+'.png'});
    await page.evaluate(()=>scrollTo(0,0));await page.screenshot({path:dir+'/toolbar-'+width+'.png'});
   }
  }
 });
 assert.equal(await page.request.get(base+'/api/sandbox/model').then(r=>r.text()),modelText);assert.deepEqual(errors,[]);
 console.log('All '+checks.length+' checks passed');
 writeFileSync(dir+'/results.json',JSON.stringify({checks,errors,engine:result.proposed.engine,samples:result.proposed.times.length,initialZones:10},null,2));
}catch(e){await page.screenshot({path:dir+'/failure.png',fullPage:true}).catch(()=>{});writeFileSync(dir+'/results.json',JSON.stringify({checks,errors,failure:String(e)},null,2));console.error(e);process.exitCode=1;}
finally{await browser.close();}
