'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { useApp } from '@/contexts/AppContext';
import WenshuiAvatar from '@/components/guided/WenshuiAvatar';
import { accountStorageKey } from '@/lib/mentor/course';
import { EXPERIMENT_STORAGE_PREFIX, experimentObservation, getExperimentPreset, makeExperimentRecord, restoreExperimentNotebook, upsertExperimentRecord, type ExperimentLessonId, type ExperimentNotebook, type ExperimentPreset } from '@/lib/mentor/experiment';
import type { Placement, RunResult } from '@/lib/sandbox/types';
import { FACILITIES } from '@/lib/sandbox/types';
import { planSignature } from '@/lib/sandbox/model';
import styles from './mentor-experiment.module.css';

export type MentorExperimentProps = {
  lessonId: ExperimentLessonId; placements: Placement[]; zone: number; rain: string;
  result: RunResult | null; stale: boolean; running: boolean;
  onApply: (preset: ExperimentPreset) => {ok:boolean; message?:string};
  onRun: () => void;
};

export default function MentorExperiment({lessonId,placements,zone,rain,result,stale,running,onApply,onRun}: MentorExperimentProps) {
  const {state:account} = useApp();
  const storageKey = account.authLoading ? null : accountStorageKey(EXPERIMENT_STORAGE_PREFIX);
  const [stored,setStored] = useState<{key:string|null; notebook:ExperimentNotebook; dirty:boolean}|null>(null);
  const [storageError,setStorageError] = useState('');
  const [notice,setNotice] = useState('');
  const [applied,setApplied] = useState(false);
  const [expanded,setExpanded] = useState(true);
  const preset = getExperimentPreset(lessonId)!;
  const notebook = stored?.key === storageKey ? stored.notebook : null;
  const currentId = result ? `${lessonId}:${result.id}` : null;
  const current = notebook?.records.find(item => item.id === currentId);
  const recent = notebook?.records.find(item => item.lessonId === lessonId);
  const hasFacility = placements.some(item => item.facility === preset.facility);

  useEffect(() => {
    setStorageError('');
    try {
      setStored({key:storageKey,notebook:restoreExperimentNotebook(storageKey ? JSON.parse(localStorage.getItem(storageKey)||'null') : null),dirty:false});
      if (!storageKey) setStorageError('当前未登录或浏览器存储受限，实验记录仅在此页保留。');
    } catch {
      setStored({key:storageKey,notebook:{version:1,records:[]},dirty:false});
      setStorageError('无法读取本机实验记录。可以继续实验，记录保存后会再次尝试。');
    }
  },[storageKey]);
  useEffect(() => {setApplied(false);setNotice('');setExpanded(true);},[lessonId]);
  useEffect(() => {
    if (!notebook) return;
    if (!result) {
      const outdated = recent && recent.signature !== planSignature(placements,rain);
      if (recent && recent.stale !== outdated) setStored({key:storageKey,notebook:upsertExperimentRecord(notebook,{...recent,stale:!!outdated}),dirty:true});
      return;
    }
    const fresh = stale ? null : makeExperimentRecord(lessonId,result,placements,rain);
    if (current) {
      if (current.stale !== stale) setStored({key:storageKey,notebook:upsertExperimentRecord(notebook,{...current,stale}),dirty:true});
    } else if (fresh) setStored({key:storageKey,notebook:upsertExperimentRecord(notebook,fresh),dirty:true});
  },[lessonId,notebook,result,placements,rain,stale,current,recent,storageKey]);
  useEffect(() => {
    if (!stored || !stored.dirty || stored.key !== storageKey || !storageKey) return;
    try {
      localStorage.setItem(storageKey,JSON.stringify(stored.notebook));
      setStorageError('');
    } catch {setStorageError('浏览器未能保存实验记录，可能空间不足或禁止存储。请复制反思文字后再离开。');}
  },[stored,storageKey]);
  const apply = () => {
    const response = onApply(preset);
    setNotice(response.message || (response.ok ? '建议已加入当前方案，现在可以运行计算。' : '未能加入建议，请检查当前片区的可用空间。'));
    if (response.ok) setApplied(true);
  };
  const saveReflection = (reflection:string) => {
    if (current && notebook) setStored({key:storageKey,notebook:upsertExperimentRecord(notebook,{...current,reflection:reflection.slice(0,2000)}),dirty:true});
  };
  const format = (value:number,decimals=1) => value.toLocaleString('zh-CN',{maximumFractionDigits:decimals});

  return <section className={styles.card} aria-label="问水先生的沙盘实验" data-testid="mentor-experiment">
    <div className={styles.heading}>
      <WenshuiAvatar size={68} mood={running?'thinking':current&&!stale?'celebrate':'question'}/>
      <div><span className={styles.eyebrow}>问水先生 · 先预测，再验证</span><h2>{preset.title}</h2><p>{expanded ? '把知识图谱里的推理，交给一场真实计算检验。' : current&&!stale?'实验已计算，可以回到图谱继续反思。':'实验任务已保留，随时展开继续。'}</p></div>
      <button className={styles.collapse} onClick={() => setExpanded(value=>!value)} aria-expanded={expanded} aria-label={expanded?'收起导师实验':'展开导师实验'}>{expanded?'收起':'展开'}</button>
    </div>
    {expanded && <div className={styles.body}>
      <div className={styles.instructions}>
        <div className={styles.tags}><span>{FACILITIES[preset.facility].name}</span><span>新增 {preset.area} m²</span><span>蓄水深度 {preset.depth} mm</span><span>5 年一遇</span></div>
        <p>在当前 Z{String(zone).padStart(2,'0')} 片区的适用空间添加建议，保留已有设施，并将降雨设为 5 年一遇。{preset.facility==='RG'?'本次不另加乔木，先观察水文变化。':''}</p>
        <p className={styles.question}>{preset.question}</p>
        <div className={styles.actions}>
          <button className={styles.primary} onClick={apply} disabled={running}>{applied?'再添加 50 m²':'应用建议'}</button>
          <button onClick={onRun} disabled={running||!hasFacility}>{running?'正在计算…':'运行实验'}</button>
          <Link href={`/guided?mentor=${lessonId}`}>返回图谱继续学习 ↗</Link>
        </div>
        {notice && <p className={styles.notice} role="status">{notice}</p>}
      </div>
      <div className={styles.result}>
        {current ? <>
          <strong>{stale?'方案已修改，需重新计算':'这场雨留下了什么证据？'}</strong>
          <div className={styles.metrics}>
            <div><span>径流总量 / m³</span><b>{format(current.baseline.runoffVolume)} → {format(current.proposed.runoffVolume)}</b></div>
            <div><span>出流峰值 / m³/s</span><b>{format(current.baseline.peakFlow,3)} → {format(current.proposed.peakFlow,3)}</b></div>
          </div>
          <p>{stale?'下列记录属于上次计算，不能代表修改后的方案。':experimentObservation(current)}</p>
          <label className={styles.reflection}>我的实验反思<textarea value={current.reflection} maxLength={2000} rows={3} onChange={event=>saveReflection(event.target.value)} placeholder="实际变化和预测一致吗？用总量、峰值两个指标解释，再写一个限制条件。"/></label>
          <small>{current.rain.replace('A',' 年一遇')} · {format(current.facilityArea)} m² {FACILITIES[current.facility].name} · {storageError?'本次记录尚未成功保存':'结果与反思自动保存于此账号的本机记录'}</small>
        </> : <>
          <strong>先说说你的预测</strong><p>先想一想：增加设施后，总量和峰值都会降低吗？点击“应用建议”，再运行实验，真实结果会出现在这里。</p>
          {recent && <p className={styles.notice}>你已有本课实验记录，返回图谱可复习。{recent.stale?'上次方案后来有修改，复习时请区分旧结果。':''}</p>}
          <small>保持同一降雨和其他设置，再只改变面积，才能更清楚地比较。当前课程基准为未布置可编辑设施的场景。</small>
        </>}
        {storageError && <p className={styles.storageError} role="status">{storageError}</p>}
      </div>
    </div>}
  </section>;
}
