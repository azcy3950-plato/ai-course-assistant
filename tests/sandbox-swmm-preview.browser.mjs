// Exercise the actual local SWMM service in an isolated browser context.
import assert from 'node:assert/strict';
import {mkdirSync,readFileSync,writeFileSync} from 'node:fs';
import {chromium} from 'playwright';

const base=process.argv[2]||process.env.SANDBOX_BASE_URL||'http://127.0.0.1:3000';
assert(['localhost','127.0.0.1','[::1]'].includes(new URL(base).hostname),'Local URL required');
const dir='artifacts/sandbox-swmm-preview';
mkdirSync(dir,{recursive:true});
const browser=await chromium.launch({channel:process.env.PLAYWRIGHT_CHANNEL||undefined,headless:true});
const page=await browser.newPage({viewport:{width:1600,height:1050}});
const errors=[],checks=[];
page.on('pageerror',e=>errors.push(e.message));
try{
 const campus=await page.request.get(base+'/api/sandbox/model').then(r=>r.json());
 const green=campus.patches.find(p=>p.surface==='green'&&p.area>=50);
 const original={name:'保留用户当前草稿',rain:'10A',placements:[{id:'original',patchId:green.id,facility:'RG',area:50,depth:100,trees:true}]};
 const saved=[{...original,id:'original-saved',date:'原有实验'}];
 await page.addInitScript(({original,saved})=>{
  if(!localStorage.getItem('preview-check-seeded')){
   localStorage.setItem('zijing-studio-v1',JSON.stringify(original));
   localStorage.setItem('zijing-studio-v1-saved',JSON.stringify(saved));
   localStorage.setItem('preview-check-seeded','true');
  }
 },{original,saved});
 const responseReady=page.waitForResponse(r=>r.url().endsWith('/api/sandbox/run')&&r.request().method()==='POST',{timeout:120000});
 const start=Date.now();
 await page.goto(base+'/sandbox/demo');
 await page.getByTestId('sandbox-2d').waitFor();
 const response=await responseReady,result=await response.json();
 assert.equal(response.status(),200,JSON.stringify(result));
 assert.equal(result.proposed.source,'SWMM');
 assert.equal(result.baseline.source,'SWMM');
 assert.match(result.proposed.engine,/^\d+$/);
 assert(result.proposed.times.length>100);
 assert(result.proposed.runoffVolume<result.baseline.runoffVolume);
 assert.equal(JSON.parse(response.request().postData()).rain,'5A');
 assert.equal(JSON.parse(response.request().postData()).placements.length,campus.baseline.length);
 for(const label of ['baseline','proposed']){
  const report=readFileSync('.sandbox-runs/'+(result[label].runId||result.id)+'/'+label+'.rpt','utf8');
  const data=result[label];
  const runoffSection=report.slice(report.indexOf('Runoff Quantity Continuity'));
  const runoffHaM=Number(runoffSection.match(/Surface Runoff\s*\.+\s*([\d.eE+-]+)/)[1]);
  assert(Math.abs(data.runoffVolume-runoffHaM*10000)<5.1,'runoff volume must agree with the engine report rounding');
  const routingSection=report.slice(report.indexOf('Flow Routing Continuity'));
  const floodML=Number(routingSection.match(/Flooding Loss\s*\.+\s*([\d.eE+-]+)\s+([\d.eE+-]+)/)[2]);
  assert(Math.abs(data.floodVolume-floodML*1000)<1.1,'flood volume must agree with the engine report');
  const summary=report.slice(report.indexOf('Outfall Loading Summary')).match(/^\s*System\s+(.+)$/m)[1].trim().split(/\s+/).map(Number);
  assert.equal(data.peakFlow,summary[2]);
  for(const [i,p] of ['COD','TP','TN'].entries())assert.equal(data.pollutants[p].load,summary[4+i]);
  assert.notDeepEqual(data.pollutants.COD.concentration,data.pollutants.TN.concentration);
  assert.notDeepEqual(data.pollutants.TN.concentration,data.pollutants.TP.concentration);
  const error=Number(report.slice(report.indexOf('Quality Routing Continuity')).match(/Continuity Error \(%\)\s*\.+\s*([\d.eE+-]+)/)[1]);
  assert(Math.abs(data.continuity.quality-error)<.001);
 }
 checks.push('Volumes, peak flow, pollutant loads and continuity errors agree with the original SWMM reports');
 await page.getByText('SWMM 计算完成',{exact:true}).waitFor();
 const elapsed=Date.now()-start;
 checks.push('Automatically loaded actual four-facility case and ran real SWMM for baseline and proposed plans');
 assert.equal(await page.getByRole('img',{name:'出水口流量过程对比',exact:true}).count(),1);
 await page.getByRole('button',{name:'关闭提示',exact:true}).click();
 await page.locator('#sandbox-results').screenshot({path:dir+'/swmm-results.png'});
 assert.equal(await page.getByLabel('水位回放时间轴').count(),0);
 await page.getByRole('button',{name:'查看全图',exact:true}).click();
 await page.evaluate(()=>scrollTo(0,0));
 await page.screenshot({path:dir+'/swmm-map.png'});
 checks.push('Hydrograph remains available and the playback timeline has been removed');
 for(const pollutant of ['COD','TN','TP']){
  await page.getByRole('button',{name:'水质控制',exact:true}).click();
  await page.getByRole('button',{name:pollutant,exact:true}).click();
  assert.equal(result.proposed.pollutants[pollutant].concentration.length,result.proposed.times.length);
  assert(await page.getByRole('img',{name:pollutant+' 出水口流量加权浓度',exact:true}).isVisible());
  if(pollutant==='COD')await page.locator('#sandbox-results').screenshot({path:dir+'/swmm-quality.png'});
 }
 checks.push('COD, TN and TP charts use the actual SWMM water quality output');
 await page.getByRole('button',{name:'生态服务',exact:true}).click();
 await page.locator('#sandbox-results').screenshot({path:dir+'/swmm-eco.png'});
 await page.getByRole('button',{name:'保存方案',exact:true}).click();
 const storage=await page.evaluate(()=>({draft:JSON.parse(localStorage.getItem('zijing-studio-v1')),saved:JSON.parse(localStorage.getItem('zijing-studio-v1-saved')),preview:JSON.parse(localStorage.getItem('zijing-swmm-preview-v1-saved'))}));
 assert.deepEqual(storage.draft,original);assert.deepEqual(storage.saved,saved);
 assert.equal(storage.preview[0].result.id,result.id);
 await page.getByRole('link',{name:'返回我的沙盘 ↗',exact:true}).click();
 await page.waitForURL('**/sandbox');
 await page.waitForFunction(()=>document.querySelector('[aria-label="方案名称"]')?.value==='保留用户当前草稿');
 assert.equal(await page.getByLabel('降雨情景',{exact:true}).inputValue(),'10A');
 assert.equal(await page.getByLabel('水位回放时间轴').count(),0);
 checks.push('Demo draft and saved results are isolated; original draft, rain and saved plans remain intact');
 await page.setViewportSize({width:390,height:900});
 const rerun=page.waitForResponse(r=>r.url().endsWith('/api/sandbox/run')&&r.request().method()==='POST',{timeout:120000});
 await page.goto(base+'/sandbox/demo');assert.equal((await rerun).status(),200);
 await page.getByText('SWMM 计算完成',{exact:true}).waitFor();
 assert(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1));
 await page.locator('#sandbox-results').screenshot({path:dir+'/swmm-mobile.png'});
 checks.push('Demo remains usable at 390px without horizontal overflow');
 assert.deepEqual(errors,[]);
 writeFileSync(dir+'/result.json',JSON.stringify(result,null,2));
 const reduction=(before,after)=>(before-after)/before*100;
 const report={checks,errors,elapsedSeconds:elapsed/1000,engine:result.proposed.engine,samples:result.proposed.times.length,facilities:campus.baseline.length,area:result.eco.area,rain:'5A',runoff:{baseline:result.baseline.runoffVolume,proposed:result.proposed.runoffVolume,reductionPercent:reduction(result.baseline.runoffVolume,result.proposed.runoffVolume)},peakFlow:{baseline:result.baseline.peakFlow,proposed:result.proposed.peakFlow},flood:{baseline:result.baseline.floodVolume,proposed:result.proposed.floodVolume},pollutants:Object.fromEntries(['COD','TN','TP'].map(p=>[p,{baseline:result.baseline.pollutants[p].load,proposed:result.proposed.pollutants[p].load}])),annualEco:result.eco.annual.total,continuity:result.proposed.continuity};
 writeFileSync(dir+'/verification.json',JSON.stringify(report,null,2));
 console.log(JSON.stringify(report,null,2));
}catch(e){await page.screenshot({path:dir+'/failure.png',fullPage:true}).catch(()=>{});console.error(e);process.exitCode=1;}
finally{await browser.close();}
