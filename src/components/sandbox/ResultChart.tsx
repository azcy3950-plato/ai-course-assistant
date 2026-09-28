'use client';
import {useState} from 'react';
import styles from './studio.module.css';
export default function ResultChart({a,b,times,label,unit}:{a:number[];b:number[];times:number[];label:string;unit:string}){
 const[hover,setHover]=useState<number|null>(null);const max=Math.max(...a,...b,0.001)*1.12,w=720,h=140,left=50,right=18,top=10,bottom=24;
 const x=(i:number)=>left+i/Math.max(1,times.length-1)*(w-left-right),y=(v:number)=>h-bottom-v/max*(h-top-bottom);
 const path=(values:number[])=>values.map((v,i)=>(i?'L':'M')+x(i).toFixed(2)+','+y(v).toFixed(2)).join(' ');
 return <div className={styles.chart}><div className={styles.chartTitle}><strong>{label}</strong><span>{unit}　<i className={styles.baseDot}/> 课程基准　<i className={styles.planDot}/> 我的方案</span></div>
 <svg viewBox={`0 0 ${w} ${h}`} role="img" aria-label={label} onMouseLeave={()=>setHover(null)} onMouseMove={e=>{const r=e.currentTarget.getBoundingClientRect();const t=((e.clientX-r.left)/r.width*w-left)/(w-left-right);setHover(Math.max(0,Math.min(times.length-1,Math.round(t*(times.length-1)))));}}>
 {[0,.5,1].map(f=><g key={f}><line x1={left} y1={y(max*f)} x2={w-right} y2={y(max*f)} stroke="#e9eee5"/><text x={left-8} y={y(max*f)+4} textAnchor="end" fontSize="10" fill="#809080">{(max*f).toFixed(2)}</text></g>)}
 <path d={path(a)} stroke="#b5beb2" strokeWidth="2" fill="none"/><path d={path(b)} stroke="#477b59" strokeWidth="2.4" fill="none"/>
 {[0,.25,.5,.75,1].map(f=>{const i=Math.round(f*(times.length-1));return <text key={f} x={x(i)} y={h-5} textAnchor="middle" fontSize="10" fill="#809080">{(times[i]||0).toFixed(0)} h</text>;})}
 {hover!==null&&<g><line x1={x(hover)} x2={x(hover)} y1={top} y2={h-bottom} stroke="#6b8b70" strokeDasharray="3 3"/><circle cx={x(hover)} cy={y(b[hover]||0)} r="3" fill="#477b59"/><text x={Math.min(w-145,Math.max(left,x(hover)+8))} y="18" fontSize="11" fill="#31503a">{times[hover]?.toFixed(1)} h · {(b[hover]||0).toFixed(3)} {unit}</text></g>}
 </svg></div>;
}
