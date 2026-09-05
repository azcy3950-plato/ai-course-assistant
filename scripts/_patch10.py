import re

p = 'src/app/history/page.tsx'
s = open(p, encoding='utf-8').read()

# 1) events tab 渲染：改用 mergedItems（含问答+小测），按日期分组
old_events = """      {tab === "events" && (
        <div>
          {loading ? (
            <div className="p-10 text-center text-sm text-[var(--color-text-muted)]">加载中...</div>
          ) : grouped.length === 0 ? (
            <div className="bg-white rounded-xl border border-[var(--color-border)] p-12 text-center">
              <div className="text-4xl mb-3">🕐</div>
              <p className="text-sm text-[var(--color-text-secondary)]">暂无学习记录，开始学习后会自动记录</p>
            </div>
          ) : (
            <div className="space-y-5">
              {grouped.map((g) => (
                <div key={g.date}>
                  <div className="text-xs font-semibold text-[var(--color-text-muted)] mb-2 ml-1">{g.date}</div>
                  <div className="bg-white rounded-xl border border-[var(--color-border)] divide-y divide-[var(--color-border)]">
                    {g.items.map((e) => (
                      <div key={e.id} className="flex items-start gap-3 px-4 py-3">
                        <span className="text-lg mt-0.5">{EVENT_META[e.type] || "•"}</span>
                        <div className="flex-1 min-w-0">
                          <div className="text-sm font-medium text-[var(--color-text)]">{e.title}</div>
                          {e.summary && <div className="text-xs text-[var(--color-text-secondary)] mt-0.5 line-clamp-1">{e.summary}</div>}
                        </div>
                        <span className="text-[10px] text-[var(--color-text-muted)] shrink-0 mt-1">
                          {new Date(e.created_at).toLocaleTimeString("zh-CN", { hour: "2-digit", minute: "2-digit" })}
                        </span>
                      </div>
                    ))}
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      )}"""
new_events = """      {tab === "events" && (
        <div>
          {loading ? (
            <div className="p-10 text-center text-sm text-[var(--color-text-muted)]">加载中...</div>
          ) : mergedItems.length === 0 ? (
            <div className="bg-white rounded-xl border border-[var(--color-border)] p-12 text-center">
              <div className="text-4xl mb-3">🕐</div>
              <p className="text-sm text-[var(--color-text-secondary)]">暂无学习记录，开始学习后会自动记录</p>
            </div>
          ) : (
            <div className="space-y-5">
              {(() => {
                const groups: { date: string; items: MergedItem[] }[] = [];
                for (const it of mergedItems) {
                  const date = new Date(it.ts).toLocaleDateString("zh-CN", { year: "numeric", month: "long", day: "numeric" });
                  const last = groups[groups.length - 1];
                  if (last && last.date === date) last.items.push(it);
                  else groups.push({ date, items: [it] });
                }
                return groups.map((g) => (
                  <div key={g.date}>
                    <div className="text-xs font-semibold text-[var(--color-text-muted)] mb-2 ml-1">{g.date}</div>
                    <div className="bg-white rounded-xl border border-[var(--color-border)] divide-y divide-[var(--color-border)]">
                      {g.items.map((it) => (
                        <div key={it.id} className="flex items-start gap-3 px-4 py-3">
                          <span className="text-lg mt-0.5">{it.icon}</span>
                          <div className="flex-1 min-w-0">
                            <div className="text-sm font-medium text-[var(--color-text)]">{it.title}</div>
                            {it.summary && <div className="text-xs text-[var(--color-text-secondary)] mt-0.5 line-clamp-1">{it.summary}</div>}
                          </div>
                          <span className="text-[10px] text-[var(--color-text-muted)] shrink-0 mt-1">
                            {new Date(it.ts).toLocaleTimeString("zh-CN", { hour: "2-digit", minute: "2-digit" })}
                          </span>
                        </div>
                      ))}
                    </div>
                  </div>
                ));
              })()}
            </div>
          )}
        </div>
      )}"""
assert old_events in s, 'events block'
s = s.replace(old_events, new_events, 1)

# 2) 页面末尾（QA tab 结束后、fbModal 之前）插入 insights + favorites tab
anchor = """      )}

      {/* AI 反馈弹窗 */}"""
assert anchor in s, 'modal anchor'
new_tabs = """      )}

      {tab === "insights" && <InsightsPanel />}

      {tab === "favorites" && (
        <div>
          {favorites.length === 0 ? (
            <div className="bg-white rounded-xl border border-[var(--color-border)] p-12 text-center">
              <div className="text-4xl mb-3">⭐</div>
              <p className="text-sm text-[var(--color-text-secondary)]">暂无收藏。在知识点抽屉、AI 问答或错题处点 ☆ 收藏</p>
            </div>
          ) : (
            <div className="space-y-3">
              <div className="flex items-center justify-between">
                <span className="text-xs text-[var(--color-text-muted)]">共 {favorites.length} 条 · {favorites.filter((f) => f.in_review).length} 条待复习</span>
              </div>
              {favorites.map((f) => {
                const label = f.ref_type === "qa_message" ? `🤖 ${f.note || "AI 问答"}` : f.ref_type === "node" ? `📚 ${f.note || "知识点"}` : `📝 ${f.note || "错题"}`;
                return (
                  <div key={f.id} className="bg-white rounded-xl border border-[var(--color-border)] p-4 flex items-center gap-3">
                    <div className="flex-1 min-w-0">
                      <div className="text-sm font-medium text-[var(--color-text)]">{label}</div>
                      <div className="text-[10px] text-[var(--color-text-muted)] mt-0.5">
                        收藏于 {new Date(f.created_at).toLocaleDateString("zh-CN")}
                        {f.in_review && <span className="ml-2 text-amber-600">待复习</span>}
                        {!f.in_review && f.last_reviewed_at && <span className="ml-2 text-green-600">已复习 {new Date(f.last_reviewed_at).toLocaleDateString("zh-CN")}</span>}
                      </div>
                    </div>
                    <button onClick={async () => {
                      await fetch("/api/favorites", { method: "PATCH", headers: jsonHeaders, body: JSON.stringify({ id: f.id, inReview: !f.in_review }) });
                      loadFavorites();
                    }} className="text-xs px-2.5 py-1 rounded-full border border-[var(--color-border)] hover:bg-gray-50 shrink-0">
                      {f.in_review ? "✓ 标记已复习" : "＋ 加入待复习"}
                    </button>
                    <button onClick={async () => {
                      await fetch("/api/favorites", { method: "DELETE", headers: jsonHeaders, body: JSON.stringify({ id: f.id }) });
                      loadFavorites();
                    }} className="text-xs text-[var(--color-text-muted)] hover:text-red-500 shrink-0">取消收藏</button>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      )}

      {/* AI 反馈弹窗 */}"""
s = s.replace(anchor, new_tabs, 1)
open(p, 'w', encoding='utf-8').write(s)
print('history part2 ok')

# ── /records 与 /insights 重定向到 /history ──
for route, tab in [('records', 'events'), ('insights', 'insights')]:
    fp = f'src/app/{route}/page.tsx'
    content = f'''"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";

/** 已并入统一学习档案 /history（tab={tab}），保留旧 URL 重定向 */
export default function RedirectPage() {{
  const router = useRouter();
  useEffect(() => {{
    router.replace("/history" + ("{tab}" === "events" ? "" : "?tab={tab}"));
  }}, [router]);
  return <div className="p-10 text-center text-sm text-[var(--color-text-muted)]">正在跳转到学习档案…</div>;
}}
'''
    open(fp, 'w', encoding='utf-8').write(content)
    print(f'{route} redirect ok')
