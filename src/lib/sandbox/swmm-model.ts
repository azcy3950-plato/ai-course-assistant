import { Campus, FACILITIES, Placement } from './types';
import { replaceSection, section, validatePlacements } from './model';

/** A clearly defined teaching baseline: original network/boundaries, editable LIDs rebuilt. */
export function compileStudentInp(original:string,campus:Campus,placements:Placement[],rain:string):string {
  const validation=validatePlacements(campus,placements);
  if(validation.errors.length) throw new Error(validation.errors.join('\n'));
  if(!['3A','5A','10A','20A','50A'].includes(rain)) throw new Error('降雨情景不存在');
  const editable=new Map(campus.patches.filter(p=>p.surface!=='reserved').map(p=>[p.id,p]));
  let text=original.replace(/\r\n/g,'\n');
  // Use ASCII names for portable execution of the Windows SWMM C engine.
  const originalControls=section(text,'LID_CONTROLS');
  const controls=originalControls.filter(p=>p.length===2).map(p=>p[0]);
  const names=new Map(controls.map((n,i)=>[n,'CASE_LID_'+i]));
  const template:Record<string,string>={GR:'绿色屋顶',VS:'植草沟',RG:'雨水花园',PP:'透水砖铺装'};
  const lidControls=originalControls.map(r=>[names.get(r[0])||r[0],...r.slice(1)]);
  const lidUsage=section(text,'LID_USAGE').filter(r=>!editable.has(r[0])).map(r=>[r[0],names.get(r[1])||r[1],...r.slice(2)]);
  placements.forEach((p,i)=>{
    const name='STUDENT_'+i,patch=editable.get(p.patchId)!;
    const rows=originalControls.filter(r=>r[0]===template[p.facility]);
    if(!rows.length) throw new Error('缺少设施结构模板：'+FACILITIES[p.facility].name);
    for(const row of rows) {const r=[name,...row.slice(1)];if(r[1]==='SURFACE') r[2]=String(p.depth);lidControls.push(r);}
    const ratio=Math.min(100,p.area/patch.area*100);
    // Each LID receives direct rainfall; external captured flow is apportioned once.
    const imp=patch.surface==='road'?ratio:0,perv=patch.surface==='green'?ratio:0;
    lidUsage.push([patch.id,name,'1',p.area.toFixed(6),Math.sqrt(p.area).toFixed(4),'0',imp.toFixed(6),'0','*','*',perv.toFixed(6)]);
  });
  text=replaceSection(text,'LID_CONTROLS',lidControls);text=replaceSection(text,'LID_USAGE',lidUsage);
  const subs=section(text,'SUBCATCHMENTS').map(r=>{
    const p=editable.get(r[0]);if(p) {r[4]=p.surface==='green'?'0':'100';}return r;
  });
  text=replaceSection(text,'SUBCATCHMENTS',subs);
  // Recover land-use class for teaching runs from known existing LID/coverage evidence.
  const coverage=section(text,'COVERAGES').filter(r=>!editable.has(r[0]));
  for(const p of editable.values()) coverage.push([p.id,p.surface==='green'?'greenland':p.surface,'100']);
  text=replaceSection(text,'COVERAGES',coverage);
  text=replaceSection(text,'RAINGAGES',section(text,'RAINGAGES').map(r=>{const j=r.findIndex(v=>v.toUpperCase()==='TIMESERIES');if(j>=0)r[j+1]=rain;return r;}));
  // All reported series must be present for regional aggregation and map playback.
  const report=section(text,'REPORT').filter(r=>!['SUBCATCHMENTS','NODES','LINKS'].includes(r[0].toUpperCase()));
  report.push(['SUBCATCHMENTS','ALL'],['NODES','ALL'],['LINKS','ALL']);text=replaceSection(text,'REPORT',report);
  return text;
}
