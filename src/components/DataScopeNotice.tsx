"use client";

import React, { useState } from "react";

export type DataScope = "real" | "all";

export default function DataScopeNotice({ compact = false, scope, onScopeChange }: { compact?: boolean; scope?: DataScope; onScopeChange?: (scope: DataScope) => void }) {
  const [open, setOpen] = useState(false);
  return (
    <div className="mb-4 rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-amber-950">
      <div className="flex items-start justify-between gap-3">
        <div>
          <p className="text-xs font-semibold">数据范围：{scope === "all" ? "包含演示账号" : "仅真实学生"}</p>
          <p className="mt-1 text-[11px] leading-5 text-amber-800">
            固定演示账号为 student01-12@demo.edu.cn。系统默认剔除演示账号；只有功能演示和联调时才建议将其纳入统计。
          </p>
        </div>
        <div className="flex shrink-0 items-center gap-2">
          {onScopeChange && <div className="rounded-lg border border-amber-300 bg-white p-0.5 text-[11px]">
            <button onClick={() => onScopeChange("real")} className={`rounded-md px-2 py-1 ${scope !== "all" ? "bg-amber-600 text-white" : "text-amber-800"}`}>仅真实学生</button>
            <button onClick={() => onScopeChange("all")} className={`rounded-md px-2 py-1 ${scope === "all" ? "bg-amber-600 text-white" : "text-amber-800"}`}>含演示账号</button>
          </div>}
          {!compact && <button onClick={() => setOpen((v) => !v)} className="text-[11px] font-medium text-amber-800 hover:underline">{open ? "收起口径" : "指标口径"}</button>}
        </div>
      </div>
      {open && (
        <div className="mt-3 grid gap-2 border-t border-amber-200 pt-3 text-[11px] leading-5 md:grid-cols-2">
          <p><b>活跃学生：</b>统计周期内至少产生一条学习事件的去重学生数。</p>
          <p><b>任务完成率：</b>已完成任务项 ÷ 已发布任务项；需修改和逾期不计为完成。</p>
          <p><b>平均掌握度：</b>仅对已有学习记录的知识点取平均，属于辅助诊断指标。</p>
          <p><b>小测正确率：</b>正确题数 ÷ 已提交题数；样本不足时不用于教学结论。</p>
        </div>
      )}
    </div>
  );
}
