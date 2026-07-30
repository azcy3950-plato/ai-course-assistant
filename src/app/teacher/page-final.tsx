"use client";

import React, { Suspense, useState, useEffect, useRef, useCallback } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import Link from "next/link";
import { useApp } from "@/contexts/AppContext";
import { supabase } from "@/lib/supabase";

// ── Types ──
interface DocRecord {
  id: string; name: string; type: string; size: number;
  r2_key: string; uploaded_by: string; created_at: string;
}
type TabKey = "upload" | "manage" | "insights" | "students";

const COURSES = ["基础设施规划", "城市水文学", "城市内涝防治", "海绵城市", "GIS与电子沙盘"];
const API_STORAGE = "/api/storage";
const API_DOCS = "/api/documents";

function mapType(name: string): string {
  const e = name.split(".").pop()?.toLowerCase() || "";
  if (e === "pdf") return "pdf";
  if (["ppt", "pptx"].includes(e)) return "ppt";
  if (["doc", "docx"].includes(e)) return "docx";
  if (["png", "jpg", "jpeg", "gif", "webp", "svg"].includes(e)) return "image";
  return "other";
}

function fileIcon(name: string) {
  const t = mapType(name);
  return { pdf: "📄", ppt: "📊", docx: "📝", image: "🖼" }[t] || "📁";
}

function statusBadge(s?: string) {
  if (!s || s === "ready") return <span className="text-xs px-2 py-0.5 rounded-full font-medium bg-green-100 text-green-700">已就绪</span>;
  if (s === "processing") return <span className="text-xs px-2 py-0.5 rounded-full font-medium bg-blue-100 text-blue-700">解析中</span>;
  return <span className="text-xs px-2 py-0.5 rounded-full font-medium bg-red-100 text-red-700">{s}</span>;
}

function TeacherPageInner() {
  const { state } = useApp();
  const router = useRouter();
  const sp = useSearchParams();
  const [authorized, setAuthorized] = useState(false);

  useEffect(() => {
    if (state.authLoading) return;
    if (!state.role) router.replace("/login?redirect=/teacher");
    else if (state.role !== "teacher") router.replace("/");
    else setAuthorized(true);
  }, [state.authLoading, state.role, router]);

  // ── Tab state ──
  const [tab, setTab] = useState<TabKey>((sp?.get("tab") as TabKey) || "upload");
  const [docs, setDocs] = useState<DocRecord[]>([]);
  const [dragOver, setDragOver] = useState(false);
  const [uploadQueue, setUploadQueue] = useState<{ name: string; progress: number; status: string }[]>([]);
  const [loadingDocs, setLoadingDocs] = useState(true);
  const [selectedCourse, setSelectedCourse] = useState(COURSES[0]);
  const [searchTerm, setSearchTerm] = useState("");
  const [filterType, setFilterType] = useState("全部");
  const [realStudents, setRealStudents] = useState<any[]>([]);
  const [dashboardData, setDashboardData] = useState<any>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const getAuthHeaders = useCallback(async () => {
    const { data } = await supabase.auth.getSession();
    return { "Content-Type": "application/json", Authorization: "Bearer " + (data.session?.access_token || "") };
  }, []);

  // ── Load real data ──
  useEffect(() => {
    if (!authorized) return;
    loadDocs();
    fetch("/api/students").then(r => r.json()).then(d => { if (Array.isArray(d)) setRealStudents(d); }).catch(() => {});
    fetch("/api/teacher-stats").then(r => r.json()).then(d => setDashboardData(d)).catch(() => {});
  }, [authorized]);

  const loadDocs = useCallback(async () => {
    setLoadingDocs(true);
    try {
      const res = await fetch(API_DOCS, { headers: await getAuthHeaders() });
      if (res.ok) setDocs(await res.json());
    } catch (e) {}
    finally { setLoadingDocs(false); }
  }, [getAuthHeaders]);

  // ── Upload ──
  const uploadFiles = useCallback(async (fileList: FileList | null) => {
    if (!fileList?.length) return;
    const queue = Array.from(fileList).map(f => ({ name: f.name, progress: 0, status: "等待上传" }));
    setUploadQueue(prev => [...prev, ...queue]);
    for (let i = 0; i < fileList.length; i++) {
      const file = fileList[i];
      const qi = i;
      if (file.size > 200 * 1024 * 1024) {
        setUploadQueue(prev => prev.map((q, j) => j === qi ? { ...q, status: "文件过大" } : q));
        continue;
      }
      setUploadQueue(prev => prev.map((q, j) => j === qi ? { ...q, status: "上传中" } : q));
      try {
        const headers = await getAuthHeaders();
        const urlRes = await fetch(API_STORAGE, { method: "POST", headers, body: JSON.stringify({ fileName: file.name, fileType: file.type }) });
        if (!urlRes.ok) throw new Error("获取上传链接失败");
        const { uploadUrl, fileKey, fileUrl } = await urlRes.json();
        await new Promise<void>((resolve, reject) => {
          const xhr = new XMLHttpRequest();
          xhr.open("PUT", uploadUrl);
          xhr.setRequestHeader("Content-Type", file.type || "application/octet-stream");
          xhr.upload.onprogress = (e) => { if (e.lengthComputable) setUploadQueue(prev => prev.map((q, j) => j === qi ? { ...q, progress: Math.round((e.loaded / e.total) * 100) } : q)); };
          xhr.onload = () => xhr.status >= 200 && xhr.status < 300 ? resolve() : reject(new Error("HTTP " + xhr.status));
          xhr.onerror = () => reject(new Error("网络错误"));
          xhr.send(file);
        });
        await fetch(API_DOCS, { method: "POST", headers, body: JSON.stringify({ name: file.name, type: mapType(file.name), size: file.size, r2_key: fileKey, uploaded_by: state.userName || "unknown" }) });
        try { await fetch("/api/process-file", { method: "POST", headers, body: JSON.stringify({ fileName: file.name, fileUrl }) }); } catch (e) {}
        setUploadQueue(prev => prev.map((q, j) => j === qi ? { ...q, status: "完成", progress: 100 } : q));
        await loadDocs();
      } catch (err: any) {
        setUploadQueue(prev => prev.map((q, j) => j === qi ? { ...q, status: "失败" } : q));
      }
    }
  }, [getAuthHeaders, loadDocs, state.userName]);

  const handleDelete = useCallback(async (doc: DocRecord) => {
    if (!confirm("确定删除 \"" + doc.name + "\"？")) return;
    try {
      await fetch(API_STORAGE, { method: "DELETE", headers: await getAuthHeaders(), body: JSON.stringify({ fileKey: doc.r2_key }) });
      await fetch(API_DOCS, { method: "DELETE", headers: await getAuthHeaders(), body: JSON.stringify({ id: doc.id }) });
      setDocs(prev => prev.filter(d => d.id !== doc.id));
    } catch { alert("删除失败"); }
  }, [getAuthHeaders]);

  const filteredDocs = docs.filter(d => {
    if (filterType !== "全部" && mapType(d.name) !== filterType.toLowerCase()) return false;
    if (searchTerm && !d.name.toLowerCase().includes(searchTerm.toLowerCase())) return false;
    return true;
  });

  if (state.authLoading || !authorized) {
    return <div className="flex items-center justify-center min-h-[70vh] text-[var(--color-text-muted)]">加载中...</div>;
  }

  return (
    <div className="max-w-7xl mx-auto px-6 py-6">
      <div className="mb-6">
        <h1 className="text-2xl font-bold text-[var(--color-text)]">教师工作台</h1>
        <p className="text-sm text-[var(--color-text-secondary)] mt-1">
          学生 {realStudents.length} 人 · 文档 {docs.length} 个 · 提问 {dashboardData?.totalQuestions || 0} 次 · 正确率 {dashboardData?.quizRate || 0}%
        </p>
      </div>

      {/* Course selector + Tabs */}
      <div className="flex flex-wrap items-center gap-3 mb-4">
        <select value={selectedCourse} onChange={e => setSelectedCourse(e.target.value)}
          className="px-3 py-2 rounded-lg border border-[var(--color-border)] text-sm bg-white">
          {COURSES.map(c => <option key={c}>{c}</option>)}
        </select>
        <div className="flex gap-1 bg-gray-100 rounded-xl p-1">
          {[{ k: "upload" as TabKey, l: "文件上传", i: "📤" }, { k: "manage" as TabKey, l: "文档管理", i: "📋" }, { k: "insights" as TabKey, l: "数据洞察", i: "📊" }, { k: "students" as TabKey, l: "学生管理", i: "👥" }].map(t => (
            <button key={t.k} onClick={() => setTab(t.k)}
              className={"px-4 py-2 rounded-lg text-sm font-medium transition-colors " + (tab === t.k ? "bg-white text-[var(--color-text)] shadow-sm" : "text-[var(--color-text-secondary)] hover:text-[var(--color-text)]")}>{t.i} {t.l}</button>
          ))}
        </div>
      </div>

      {/* ═══════ UPLOAD TAB ═══════ */}
      {tab === "upload" && (
        <div>
          <div onDragOver={e => { e.preventDefault(); setDragOver(true); }} onDragLeave={() => setDragOver(false)}
            onDrop={e => { e.preventDefault(); setDragOver(false); uploadFiles(e.dataTransfer.files); }}
            className={"border-2 border-dashed rounded-2xl p-16 text-center transition-colors mb-6 " + (dragOver ? "border-[var(--color-primary)] bg-blue-50" : "border-gray-300 hover:border-gray-400")}>
            <div className="text-5xl mb-4">📤</div>
            <h3 className="text-xl font-bold mb-2">拖拽文件到此处上传</h3>
            <p className="text-sm text-[var(--color-text-secondary)] mb-6">支持 PDF、PPTX、DOCX、TXT · 单文件最大 200MB · 可批量上传</p>
            <button onClick={() => fileInputRef.current?.click()}
              className="px-6 py-3 bg-[var(--color-primary)] text-white rounded-xl text-base font-medium hover:opacity-90">+ 选择文件</button>
            <input ref={fileInputRef} type="file" multiple accept=".pdf,.ppt,.pptx,.doc,.docx,.txt,.md,.png,.jpg,.jpeg,.gif,.webp" className="hidden" onChange={e => uploadFiles(e.target.files)} />
            <p className="text-xs text-[var(--color-text-muted)] mt-4">上传后自动提取文字、分段、向量化并加入课程知识库</p>
          </div>
          {uploadQueue.length > 0 && (
            <div className="bg-white rounded-xl border p-6 mb-6">
              <h3 className="text-sm font-bold mb-4">上传队列</h3>
              <div className="space-y-3">
                {uploadQueue.map((q, i) => (
                  <div key={i} className="flex items-center gap-4">
                    <span className="text-sm font-medium flex-1 truncate">{q.name}</span>
                    <span className={"text-xs px-2 py-0.5 rounded-full font-medium " + (q.status.includes("完成") ? "bg-green-100 text-green-700" : q.status.includes("失败") || q.status.includes("过大") ? "bg-red-100 text-red-700" : "bg-blue-100 text-blue-700")}>{q.status}</span>
                    {q.progress > 0 && q.progress < 100 && (
                      <div className="w-24 bg-gray-200 rounded-full h-2"><div className="bg-[var(--color-primary)] h-2 rounded-full" style={{ width: q.progress + "%" }} /></div>
                    )}
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      )}

      {/* ═══════ MANAGE TAB ═══════ */}
      {tab === "manage" && (
        <div>
          <div className="flex gap-3 mb-4 flex-wrap">
            <input type="text" placeholder="搜索文件名称..." value={searchTerm} onChange={e => setSearchTerm(e.target.value)}
              className="px-4 py-2 rounded-lg border text-sm flex-1 min-w-[200px] focus:outline-none focus:ring-2 focus:ring-[var(--color-primary)]" />
            <select value={filterType} onChange={e => setFilterType(e.target.value)} className="px-3 py-2 rounded-lg border text-sm bg-white">
              {["全部", "PDF", "PPTX", "DOCX", "图片", "其他"].map(t => <option key={t}>{t}</option>)}
            </select>
            <span className="text-sm text-[var(--color-text-muted)] self-center">{filteredDocs.length} 个文件</span>
          </div>
          <div className="bg-white rounded-xl border overflow-hidden">
            <table className="w-full text-sm">
              <thead><tr className="border-b bg-gray-50">
                {["文件名称", "类型", "大小", "上传时间", "状态", "操作"].map(h => <th key={h} className="text-left px-5 py-3 text-xs font-medium text-[var(--color-text-secondary)]">{h}</th>)}
              </tr></thead>
              <tbody>
                {loadingDocs ? <tr><td colSpan={6} className="text-center py-12 text-[var(--color-text-muted)]">加载中...</td></tr> :
                 filteredDocs.length === 0 ? <tr><td colSpan={6} className="text-center py-12 text-[var(--color-text-muted)]">暂无文档</td></tr> :
                 filteredDocs.map(doc => (
                  <tr key={doc.id} className="border-b hover:bg-gray-50">
                    <td className="px-5 py-3 font-medium"><span className="mr-2">{fileIcon(doc.name)}</span>{doc.name}</td>
                    <td className="px-5 py-3 text-[var(--color-text-secondary)] text-xs">{mapType(doc.name).toUpperCase()}</td>
                    <td className="px-5 py-3 text-[var(--color-text-secondary)] text-xs">{doc.size > 1024*1024 ? (doc.size/(1024*1024)).toFixed(1)+" MB" : (doc.size/1024).toFixed(0)+" KB"}</td>
                    <td className="px-5 py-3 text-[var(--color-text-muted)] text-xs">{new Date(doc.created_at).toLocaleDateString("zh-CN")}</td>
                    <td className="px-5 py-3">{statusBadge()}</td>
                    <td className="px-5 py-3"><div className="flex gap-2">
                      <a href={"https://ai-course-assistant.oss-cn-beijing.aliyuncs.com/"+doc.r2_key} target="_blank" rel="noopener noreferrer" className="text-xs text-[var(--color-primary)] hover:underline">预览</a>
                      <button onClick={() => handleDelete(doc)} className="text-xs text-red-500 hover:underline">删除</button>
                    </div></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* ═══════ INSIGHTS TAB ═══════ */}
      {tab === "insights" && (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
          <div className="bg-white rounded-xl border p-6">
            <h3 className="text-sm font-bold mb-4">📊 知识库概览</h3>
            <div className="grid grid-cols-2 gap-4">
              {[["文档总数", dashboardData?.docCount || docs.length, "bg-blue-50 text-blue-700"], ["向量片段", dashboardData?.chunkCount || 0, "bg-green-50 text-green-700"], ["提问总数", dashboardData?.totalQuestions || 0, "bg-purple-50 text-purple-700"], ["正确率", (dashboardData?.quizRate || 0) + "%", "bg-amber-50 text-amber-700"]].map(([l, v, c]) => (
                <div key={String(l)} className={c + " rounded-lg p-4 text-center"}><div className="text-2xl font-bold">{String(v)}</div><div className="text-xs mt-1">{String(l)}</div></div>
              ))}
            </div>
          </div>
          <div className="bg-white rounded-xl border p-6">
            <h3 className="text-sm font-bold mb-4">📈 全班学习概况</h3>
            <div className="space-y-3">
              <div className="flex justify-between text-sm"><span>学生总数</span><span className="font-bold">{realStudents.length}</span></div>
              <div className="flex justify-between text-sm"><span>总提问</span><span className="font-bold">{dashboardData?.totalQuestions || 0}</span></div>
              <div className="flex justify-between text-sm"><span>总测验</span><span className="font-bold">{dashboardData?.totalQuizzes || 0}</span></div>
              <div className="flex justify-between text-sm"><span>正确数</span><span className="font-bold">{dashboardData?.correctQuizzes || 0}</span></div>
            </div>
          </div>
          {dashboardData?.weakTopics?.length > 0 && (
            <div className="bg-white rounded-xl border p-6 md:col-span-2">
              <h3 className="text-sm font-bold mb-4">⚠️ 薄弱知识点</h3>
              <div className="space-y-2">
                {dashboardData.weakTopics.map((t: any, i: number) => (
                  <div key={i} className="flex items-center gap-4 text-sm">
                    <span className="w-32 truncate">{t.topic}</span>
                    <div className="flex-1 bg-gray-200 rounded-full h-2"><div className="bg-red-400 h-2 rounded-full" style={{ width: Math.round(t.correct/t.total*100) + "%" }} /></div>
                    <span className="text-xs text-red-600">{Math.round(t.correct/t.total*100)}% ({t.correct}/{t.total})</span>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      )}

      {/* ═══════ STUDENTS TAB ═══════ */}
      {tab === "students" && (
        <div>
          <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-6">
            {[["👥", realStudents.length, "学生总数"], ["💬", dashboardData?.totalQuestions || 0, "总提问"], ["📝", dashboardData?.totalQuizzes || 0, "总测验"], ["✅", (dashboardData?.quizRate || 0) + "%", "正确率"]].map(([icon, val, label]) => (
              <div key={String(label)} className="bg-white rounded-xl border p-4"><div className="text-2xl mb-1">{icon}</div><div className="text-2xl font-bold">{String(val)}</div><div className="text-xs text-[var(--color-text-muted)]">{String(label)}</div></div>
            ))}
          </div>
          <div className="bg-white rounded-xl border overflow-hidden">
            <div className="px-5 py-3 border-b"><h3 className="text-sm font-bold">学生详情</h3></div>
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead><tr className="border-b bg-gray-50">
                  {["姓名","提问数","测验数","正确率","正确/总数","最近活跃"].map(h => <th key={h} className="text-center px-3 py-3 text-xs font-medium text-[var(--color-text-secondary)]">{h}</th>)}
                </tr></thead>
                <tbody>
                  {realStudents.length === 0 ? (
                    <tr><td colSpan={6} className="text-center py-12 text-[var(--color-text-muted)]">暂无学生数据，学生提问后将自动显示</td></tr>
                  ) : realStudents.map((stu: any) => (
                    <tr key={stu.email} className="border-b hover:bg-gray-50">
                      <td className="px-5 py-3 font-medium">
                        <Link href={"/teacher/students/" + encodeURIComponent(stu.email || "")} className="text-[var(--color-primary)] hover:underline">
                          {(stu.email || "").split("@")[0]}
                        </Link>
                      </td>
                      <td className="text-center px-3 py-3 text-[var(--color-text-secondary)]">{stu.totalQuestions}</td>
                      <td className="text-center px-3 py-3 text-[var(--color-text-secondary)]">{stu.totalQuizzes}</td>
                      <td className="text-center px-3 py-3">
                        <span className={"text-xs px-2 py-0.5 rounded-full font-medium " + (stu.rate >= 70 ? "bg-green-100 text-green-700" : stu.rate >= 50 ? "bg-yellow-100 text-yellow-700" : "bg-red-100 text-red-700")}>{stu.rate}%</span>
                      </td>
                      <td className="text-center px-3 py-3 text-[var(--color-text-secondary)]">{stu.correct}/{stu.totalQuizzes}</td>
                      <td className="text-center px-3 py-3 text-xs text-[var(--color-text-muted)]">{stu.lastActive ? new Date(stu.lastActive).toLocaleDateString("zh-CN") : "—"}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

export default function TeacherPage() { return ( <Suspense fallback={<div className="flex items-center justify-center min-h-[70vh]">加载中...</div>}> <TeacherPageInner /> </Suspense> ); }
