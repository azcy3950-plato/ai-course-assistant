import { NextRequest, NextResponse } from 'next/server';
import { verify } from 'jsonwebtoken';
import { execFile } from 'child_process';
import { promisify } from 'util';
import { mkdir, readFile, writeFile } from 'fs/promises';
import { existsSync } from 'fs';
import { join } from 'path';
import { createHash, randomUUID } from 'crypto';
import { loadCampus } from '@/lib/sandbox/server';
import { planSignature,validatePlacements,section } from '@/lib/sandbox/model';
import { compileStudentInp } from '@/lib/sandbox/swmm-model';
import { calculateEco } from '@/lib/sandbox/ecosystem';
import { HydroResult } from '@/lib/sandbox/types';
import { parseSwmmOutfallLoadingSummary } from '@/lib/swmm-quality';
export const runtime='nodejs';
export const maxDuration=120;
const execute=promisify(execFile);let active=0;
const cache=new Map<string,HydroResult>();
function authorized(req:NextRequest){
  if(process.env.NODE_ENV==='development' && ['localhost','127.0.0.1','[::1]'].includes(req.nextUrl.hostname))return true;
  const token=req.headers.get('authorization')?.replace(/^Bearer /,'');
  if(!token||!process.env.JWT_SECRET)return false;
  try{return Boolean(verify(token,process.env.JWT_SECRET));}catch{return false;}
}
export async function POST(req:NextRequest){
  if(!authorized(req))return NextResponse.json({error:'请先登录后运行仿真。'},{status:401});
  if(active>=2)return NextResponse.json({error:'计算引擎正在运行其他实验，请稍后重试。'},{status:429});
  const body=await req.json().catch(()=>null);if(!body)return NextResponse.json({error:'请求格式错误。'},{status:400});
  const {original,campus}=loadCampus();const checked=validatePlacements(campus,body.placements);
  if(checked.errors.length || !['3A','5A','10A','20A','50A'].includes(body.rain))return NextResponse.json({error:checked.errors.join(' ')||'请选择有效降雨情景。'},{status:400});
  const proposed=compileStudentInp(original,campus,checked.placements,body.rain);
  if(body.export===true)return new NextResponse(proposed,{headers:{'Content-Type':'text/plain; charset=utf-8','Content-Disposition':'attachment; filename="zijing-student.inp"'}});
  active++;
  try{
    const id=randomUUID(),dir=join(process.cwd(),'.sandbox-runs',id);await mkdir(dir,{recursive:true});
    const mapping=join(dir,'mapping.json');await writeFile(mapping,JSON.stringify(Object.fromEntries(campus.patches.map(p=>[p.id,p.zone]))));
    const virtualenv=join(process.cwd(),'.venv',process.platform==='win32'?'Scripts':'bin',process.platform==='win32'?'python.exe':'python');
    const python=process.env.SWMM_PYTHON?.trim() || (existsSync(virtualenv)?virtualenv:process.platform==='win32'?'python':'python3');
    async function simulate(inp:string,label:string){
      const key=createHash('sha256').update(inp).update('runner-v2').digest('hex');const hit=cache.get(key);if(hit)return hit;
      const input=join(dir,label+'.inp'),result=join(dir,label+'.json');await writeFile(input,inp,'utf8');
      await execute(python,[join(process.cwd(),'scripts','sandbox-run.py'),input,result,mapping],{timeout:100000,maxBuffer:5*1024*1024,windowsHide:true});
      const data=JSON.parse(await readFile(result,'utf8')) as HydroResult;
      data.runId=id;
      const report=await readFile(join(dir,label+'.rpt'),'utf8');
      const summary=parseSwmmOutfallLoadingSummary(report,section(inp,'POLLUTANTS').map(r=>r[0]))?.system;
      if(!summary)throw new Error('SWMM outfall loading summary is missing');
      data.peakFlow=summary.maximumFlow;
      for(const [pollutant,load] of Object.entries(summary.pollutantLoads))data.pollutants[pollutant].load=load;
      await writeFile(result,JSON.stringify(data),'utf8');
      if(cache.size>=24)cache.delete(cache.keys().next().value!);cache.set(key,data);return data;
    }
    const baseline=await simulate(compileStudentInp(original,campus,[],body.rain),'baseline');
    const result=await simulate(proposed,'proposed');
    return NextResponse.json({id,signature:planSignature(checked.placements,body.rain),baseline,proposed:result,eco:calculateEco(checked.placements),baselineEco:calculateEco([]),warnings:[
      '课程基准清空可编辑空间的 LID，保留原管网及区外来水；空间分类依据案例设施和覆盖标注。',
      '水质土地覆盖按识别的空间补全，用于课堂情景比较；总负荷优先取 SWMM 报告汇总。',
      '生态价值采用 course-esv-1 教学参数，非论文复现或经现场校准的经济预测。',
      '径流与洪泛总量取引擎累计统计，峰值及污染负荷取原始报告；曲线为每 5 分钟输出的过程数据。',
    ]});
  }catch(error){console.error('[student-sandbox]',error);return NextResponse.json({error:'SWMM 计算未完成。请确认已安装沙盘 Python 依赖（npm run sandbox:setup），或检查 SWMM_PYTHON 和模型参数；本次没有生成替代结果。'},{status:503});}
  finally{active--;}
}
