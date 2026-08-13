"use client";

import React, { useState, useEffect, useRef, useCallback } from "react";
import { useRouter } from "next/navigation";
import { useApp, getAuthToken } from "@/contexts/AppContext";
import { supabase } from "@/lib/supabase";
import { StudentStats } from "@/types";

const mockStudents: StudentStats[] = []; // 已弃用:学生统计改为 /api/students 真实数据(users 表)

interface OssFile {
  name: string;
  key: string;
  size: number;
  url: string;
  lastModified: string;
}

type TabKey = "upload" | "knowledge" | "students" | "accounts" | "announcements";

function mapType(name: string): string {
  const ext = name.split(".").pop()?.toLowerCase() || "";
  if (ext === "pdf") return "pdf";
  if (["ppt", "pptx"].includes(ext)) return "ppt";
  if (["doc", "docx"].includes(ext)) return "docx";
  if (["png", "jpg", "jpeg", "gif", "webp", "svg"].includes(ext)) return "image";
  return "other";
}

function fileIcon(name: string) {
  const t = mapType(name);
  if (t === "pdf") return "📄";
  if (t === "ppt") return "📊";
  if (t === "docx") return "📝";
  if (t === "image") return "🖼";
  return "📁";
}

const API = "/api/storage";

export default function TeacherPage() {
  const { state } = useApp();
  const router = useRouter();
  const [authorized, setAuthorized] = useState(false);

  useEffect(() => {
    if (state.authLoading) return;
    if (!state.role) router.replace("/login?redirect=" + encodeURIComponent("/teacher"));
    else if (state.role !== "teacher") router.replace("/");
    else setAuthorized(true);
  }, [state.authLoading, state.role, router]);

  const [activeTab, setActiveTab] = useState<TabKey>("upload");
  const [dragOver, setDragOver] = useState(false);
  const [files, setFiles] = useState<OssFile[]>([]);
  const [uploading, setUploading] = useState(false);
  const [uploadProgress, setUploadProgress] = useState(0);
  const [loadingFiles, setLoadingFiles] = useState(true);
  const fileInputRef = useRef<HTMLInputElement>(null);
  // 真实学生数据(/api/students,users 表 + 学习聚合)
  const [students, setStudents] = useState<any[]>([]);
  const [loadingStudents, setLoadingStudents] = useState(false);
  // 行内管理操作
  const [editingEmail, setEditingEmail] = useState<string | null>(null);
  const [editName, setEditName] = useState("");
  const [pwEmail, setPwEmail] = useState<string | null>(null);
  const [pwValue, setPwValue] = useState("");
  const [busyEmail, setBusyEmail] = useState<string | null>(null);
  const [stuMsg, setStuMsg] = useState<{ email: string; ok: boolean; text: string } | null>(null);

  const loadStudents = useCallback(async () => {
    setLoadingStudents(true);
    try {
      const res = await fetch("/api/students", { headers: { "Content-Type": "application/json", Authorization: `Bearer ${getAuthToken()}` } });
      if (res.ok) { const d = await res.json(); setStudents(d.students || []); }
    } catch (e) { console.error(e); }
    finally { setLoadingStudents(false); }
  }, []);

  useEffect(() => { if (authorized) loadStudents(); }, [authorized, loadStudents]);

  const flashStu = (email: string, ok: boolean, text: string) => {
    setStuMsg({ email, ok, text });
    setTimeout(() => setStuMsg(null), 4000);
  };
  const renameStudent = async (email: string) => {
    if (!editName.trim()) return;
    setBusyEmail(email);
    try {
      const res = await fetch("/api/admin/student", { method: "PATCH", headers: getAuthHeaders(), body: JSON.stringify({ email, name: editName.trim() }) });
      const d = await res.json().catch(() => ({}));
      if (res.ok) { setEditingEmail(null); await loadStudents(); flashStu(email, true, "姓名已更新"); }
      else flashStu(email, false, d.error || "更新失败");
    } catch { flashStu(email, false, "网络错误"); }
    finally { setBusyEmail(null); }
  };
  const resetStudentPassword = async (email: string) => {
    if (pwValue.length < 6) return flashStu(email, false, "新密码至少 6 位");
    setBusyEmail(email);
    try {
      const res = await fetch("/api/admin/student", { method: "PUT", headers: getAuthHeaders(), body: JSON.stringify({ email, password: pwValue }) });
      const d = await res.json().catch(() => ({}));
      if (res.ok) { setPwEmail(null); setPwValue(""); flashStu(email, true, "密码已重置"); }
      else flashStu(email, false, d.error || "重置失败");
    } catch { flashStu(email, false, "网络错误"); }
    finally { setBusyEmail(null); }
  };
  const deleteStudent = async (email: string, name: string) => {
    if (!window.confirm(`确认删除学生「${name}」(${email})?其学习记录与小测成绩将一并删除,且不可恢复。`)) return;
    setBusyEmail(email);
    try {
      const res = await fetch(`/api/admin/student?email=${encodeURIComponent(email)}`, { method: "DELETE", headers: getAuthHeaders() });
      const d = await res.json().catch(() => ({}));
      if (res.ok) { await loadStudents(); flashStu(email, true, "学生已删除"); }
      else flashStu(email, false, d.error || "删除失败");
    } catch { flashStu(email, false, "网络错误"); }
    finally { setBusyEmail(null); }
  };

  const getAuthHeaders = useCallback(() => {
    return {
      "Content-Type": "application/json",
      Authorization: `Bearer ${getAuthToken()}`,
    };
  }, []);

  const loadFiles = useCallback(async () => {
    setLoadingFiles(true);
    try {
      const res = await fetch(API, { headers: getAuthHeaders() });
      if (res.ok) setFiles(await res.json());
    } catch (e) { console.error(e); }
    finally { setLoadingFiles(false); }
  }, [getAuthHeaders]);

  useEffect(() => { if (authorized) loadFiles(); }, [authorized, loadFiles]);

  const handleFiles = useCallback(async (fileList: FileList | null) => {
    if (!fileList?.length) return;
    const file = fileList[0];
    if (file.size > 200 * 1024 * 1024) { alert("文件不能超过 200MB"); return; }

    setUploading(true);
    setUploadProgress(0);
    try {
      // 1) Get pre-signed URL
      const headers = getAuthHeaders();
      const urlRes = await fetch(API, {
        method: "POST",
        headers,
        body: JSON.stringify({ fileName: file.name, fileType: file.type }),
      });
      if (!urlRes.ok) { alert("获取上传链接失败"); return; }
      const { uploadUrl, fileKey, fileUrl, contentType } = await urlRes.json();

      // 2) Upload directly to OSS(使用后端白名单后的 Content-Type,防客户端覆盖为非白名单类型)
      await new Promise<void>((resolve, reject) => {
        const xhr = new XMLHttpRequest();
        xhr.open("PUT", uploadUrl);
        xhr.setRequestHeader("Content-Type", contentType || file.type || "application/octet-stream");
        xhr.upload.onprogress = (e) => {
          if (e.lengthComputable) setUploadProgress(Math.round((e.loaded / e.total) * 100));
        };
        xhr.onload = () => xhr.status >= 200 && xhr.status < 300 ? resolve() : reject(new Error(`HTTP ${xhr.status}`));
        xhr.onerror = () => reject(new Error("网络错误"));
        xhr.send(file);
      });

      // 3) Save metadata to Supabase
      await supabase.from("documents").insert({
        name: file.name, type: mapType(file.name), size: file.size,
        r2_key: fileKey, uploaded_by: state.userName || "unknown",
      });

      // 4) Trigger document processing (extract text → chunk → vectorize)
      try {
        await fetch("/api/process-file", {
          method: "POST",
          headers,
          body: JSON.stringify({ fileName: file.name, fileUrl }),
        });
      } catch (e) { /* non-fatal */ }

      await loadFiles();
    } catch (err: any) { alert("上传失败: " + (err.message || "未知错误")); }
    finally { setUploading(false); setUploadProgress(0); }
  }, [getAuthHeaders, loadFiles, state.userName]);

  const handleDelete = useCallback(async (f: OssFile) => {
    if (!confirm("确定删除？")) return;
    try {
      await fetch(API, {
        method: "DELETE",
        headers: getAuthHeaders(),
        body: JSON.stringify({ fileKey: f.key }),
      });
      await supabase.from("documents").delete().eq("r2_key", f.key);
      setFiles(prev => prev.filter(x => x.key !== f.key));
    } catch { alert("删除失败"); }
  }, [getAuthHeaders]);

  if (state.authLoading || !authorized) {
    return <div className="flex items-center justify-center min-h-[60vh] text-[var(--color-text-muted)]">加载中...</div>;
  }

  return (
    <div className="max-w-6xl mx-auto px-4 py-6">
      <div className="mb-6">
        <h1 className="text-2xl font-bold text-[var(--color-text)] mb-1">教学管理</h1>
        <p className="text-sm text-[var(--color-text-secondary)]">管理课程资料、知识库内容和学生使用数据</p>
      </div>

      <div className="flex gap-1 mb-6 bg-gray-100 rounded-xl p-1 w-fit">
        {[{ k: "upload" as TabKey, l: "资料上传", i: "📤" }, { k: "knowledge" as TabKey, l: "知识库管理", i: "📚" }, { k: "students" as TabKey, l: "学生统计", i: "📊" }, { k: "accounts" as TabKey, l: "教师账号", i: "🔑" }, { k: "announcements" as TabKey, l: "课程公告", i: "📣" }].map(t => (
          <button key={t.k} onClick={() => setActiveTab(t.k)}
            className={`px-4 py-2 rounded-lg text-sm font-medium transition-colors ${activeTab === t.k ? "bg-white text-[var(--color-text)] shadow-sm" : "text-[var(--color-text-secondary)] hover:text-[var(--color-text)]"}`}>
            {t.i} {t.l}
          </button>
        ))}
      </div>

      {activeTab === "upload" && (
        <div>
          <div onDragOver={e => { e.preventDefault(); setDragOver(true); }} onDragLeave={() => setDragOver(false)}
            onDrop={e => { e.preventDefault(); setDragOver(false); handleFiles(e.dataTransfer.files); }}
            className={`border-2 border-dashed rounded-2xl p-12 text-center transition-colors mb-6 ${dragOver ? "border-[var(--color-primary)] bg-[var(--color-primary-bg)]" : "border-gray-300 hover:border-gray-400"}`}>
            <div className="text-4xl mb-3">📤</div>
            <h3 className="text-lg font-bold text-[var(--color-text)] mb-1">拖拽文件到此处上传</h3>
            <p className="text-sm text-[var(--color-text-secondary)] mb-4">支持 PDF、PPT、DOCX、图片等，单文件最大 50MB</p>
            <button onClick={() => fileInputRef.current?.click()} disabled={uploading}
              className="inline-flex items-center gap-1.5 px-5 py-2.5 bg-[var(--color-primary)] text-white rounded-lg text-sm font-medium hover:opacity-90 disabled:opacity-50">
              + {uploading ? "上传中..." : "选择文件"}
            </button>
            <input ref={fileInputRef} type="file" accept=".pdf,.ppt,.pptx,.doc,.docx,.png,.jpg,.jpeg,.gif,.webp" className="hidden"
              onChange={e => handleFiles(e.target.files)} />
          </div>

          {uploading && (
            <div className="mb-6 bg-white rounded-xl border border-[var(--color-border)] p-4">
              <div className="flex items-center justify-between mb-2"><span className="text-sm font-medium">上传中...</span><span className="text-sm text-[var(--color-primary)]">{uploadProgress}%</span></div>
              <div className="w-full bg-gray-200 rounded-full h-2"><div className="bg-[var(--color-primary)] h-2 rounded-full transition-all" style={{ width: `${uploadProgress}%` }} /></div>
            </div>
          )}

          <div className="bg-white rounded-xl border border-[var(--color-border)]">
            <div className="px-5 py-3 border-b border-[var(--color-border)] flex items-center justify-between">
              <h3 className="text-sm font-bold">已上传文件</h3><span className="text-xs text-[var(--color-text-muted)]">{files.length} 个</span>
            </div>
            {loadingFiles ? <div className="p-8 text-center text-sm text-[var(--color-text-muted)]">加载中...</div>
            : files.length === 0 ? <div className="p-8 text-center text-sm text-[var(--color-text-muted)]">暂无上传文件</div>
            : <div className="divide-y divide-[var(--color-border)]">
              {files.map(f => (
                <div key={f.key} className="flex items-center gap-4 px-5 py-3.5 hover:bg-gray-50">
                  <span className="text-2xl">{fileIcon(f.name)}</span>
                  <div className="flex-1 min-w-0">
                    <div className="text-sm font-medium truncate">{f.name}</div>
                    <div className="text-xs text-[var(--color-text-muted)] flex gap-3 mt-0.5">
                      <span>{f.size > 1024*1024 ? `${(f.size/(1024*1024)).toFixed(1)} MB` : `${(f.size/1024).toFixed(1)} KB`}</span>
                      <span>{new Date(f.lastModified).toLocaleDateString("zh-CN")}</span>
                    </div>
                  </div>
                  <div className="flex items-center gap-2">
                    <a href={f.url} target="_blank" rel="noopener noreferrer" className="text-xs text-[var(--color-primary)] hover:underline">查看</a>
                    <span className="text-[10px] px-2 py-0.5 rounded-full font-medium bg-green-100 text-green-700">已就绪</span>
                    <button onClick={() => handleDelete(f)} className="text-[var(--color-text-muted)] hover:text-red-500">🗑</button>
                  </div>
                </div>
              ))}
            </div>}
          </div>
        </div>
      )}

      {activeTab === "knowledge" && (
        <div>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
            <div className="bg-white rounded-xl border border-[var(--color-border)] p-6">
              <h3 className="text-sm font-bold mb-4">📊 知识库概览</h3>
              <div className="grid grid-cols-2 gap-4">
                {[["文档总数", files.length, "bg-blue-50 text-blue-700"], ["知识网络", 8, "bg-green-50 text-green-700"], ["图谱节点", 257, "bg-purple-50 text-purple-700"], ["向量分块", "未启用", "bg-amber-50 text-amber-700"]].map(([label, val, cls]) => (
                  <div key={String(label)} className={`${cls} rounded-lg p-4 text-center`}>
                    <div className="text-2xl font-bold">{String(val)}</div>
                    <div className="text-xs opacity-70 mt-1">{String(label)}</div>
                  </div>
                ))}
              </div>
              <div className="mt-3 text-[11px] leading-4 text-[var(--color-text-muted)]">文档数来自 OSS 存储真实列表;知识网络/图谱节点为内置 8 网络 257 节点;向量索引未启用,当前问答基于关键词检索 + AI 生成。</div>
            </div>
            <div className="bg-white rounded-xl border border-[var(--color-border)] p-6">
              <h3 className="text-sm font-bold mb-4">📑 文档列表</h3>
              {files.length === 0 ? <div className="text-center text-sm text-[var(--color-text-muted)] py-8">上传文件后显示</div>
              : <div className="space-y-3">{files.map(f => (
                <div key={f.key} className="flex items-center justify-between bg-gray-50 rounded-lg p-3">
                  <div className="flex items-center gap-3"><span>{fileIcon(f.name)}</span><div className="text-xs font-medium truncate max-w-[200px]">{f.name}</div></div>
                  <span className="text-[10px] text-[var(--color-text-muted)]">{(f.size / 1024).toFixed(1)} KB · {f.lastModified ? new Date(f.lastModified).toLocaleString("zh-CN") : "—"}</span>
                </div>
              ))}</div>}
            </div>
          </div>
          <div className="bg-white rounded-xl border border-[var(--color-border)] p-6 mt-6">
            <h3 className="text-sm font-bold mb-4">⚙️ 管理操作</h3>
            <div className="flex flex-wrap gap-3">
              <button disabled title="向量索引未启用" className="px-4 py-2 text-sm border border-gray-200 rounded-lg text-gray-400 cursor-not-allowed">🔄 重建向量索引(未启用)</button>
              <button disabled title="向量索引未启用" className="px-4 py-2 text-sm border border-gray-200 rounded-lg text-gray-400 cursor-not-allowed">📥 导出知识库(未启用)</button>
              <button disabled title="向量索引未启用" className="px-4 py-2 text-sm border border-gray-200 rounded-lg text-gray-400 cursor-not-allowed">🗑 清空知识库(未启用)</button>
            </div>
            <div className="mt-2 text-[11px] text-[var(--color-text-muted)]">向量索引/导出/清空依赖向量化服务,当前未启用;文档上传与问答(关键词检索)正常可用。</div>
          </div>
        </div>
      )}

      {activeTab === "students" && (
        <div>
          <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-6">
            {[["👥", students.length, "学生总数"], ["💬", students.reduce((s, st) => s + st.queryCount, 0), "知识查询"], ["✅", students.reduce((s, st) => s + st.quizTotal, 0), "小测次数"], ["🎯", students.length ? Math.round(students.reduce((s, st) => s + st.quizRate, 0) / students.length) : 0, "平均正确率%"]].map(([icon, val, label]) => (
              <div key={String(label)} className="bg-white rounded-xl border border-[var(--color-border)] p-4">
                <div className="text-2xl mb-1">{icon}</div>
                <div className="text-2xl font-bold">{String(val)}</div>
                <div className="text-xs text-[var(--color-text-muted)]">{String(label)}</div>
              </div>
            ))}
          </div>
          <div className="bg-white rounded-xl border border-[var(--color-border)] overflow-hidden">
            <div className="px-5 py-3 border-b flex items-center justify-between">
              <h3 className="text-sm font-bold">学生详情</h3>
              <button onClick={loadStudents} disabled={loadingStudents} className="text-xs text-blue-600 hover:text-blue-800 disabled:opacity-40">🔄 刷新</button>
            </div>
            {loadingStudents ? <div className="text-center text-sm text-[var(--color-text-muted)] py-10">加载中…</div>
            : students.length === 0 ? <div className="text-center text-sm text-[var(--color-text-muted)] py-10">暂无注册学生(学生注册后显示在此)</div>
            : <div className="overflow-x-auto">
              <table className="w-full text-sm"><thead><tr className="border-b bg-gray-50">
                {["姓名","邮箱","知识查询","小测/正确率","最近活跃","管理"].map(h => <th key={h} className="px-3 py-3 text-xs font-medium text-[var(--color-text-secondary)] text-center">{h}</th>)}
              </tr></thead><tbody>
              {students.map(stu => (
                <tr key={stu.email} className="border-b hover:bg-gray-50">
                  <td className="px-3 py-2 font-medium">
                    {editingEmail === stu.email ? (
                      <div className="flex items-center gap-1">
                        <input value={editName} onChange={e => setEditName(e.target.value)} maxLength={30} className="w-24 border border-gray-300 rounded px-1.5 py-0.5 text-xs" />
                        <button onClick={() => renameStudent(stu.email)} disabled={busyEmail === stu.email} className="text-[10px] px-1.5 py-0.5 bg-blue-600 text-white rounded">存</button>
                        <button onClick={() => setEditingEmail(null)} className="text-[10px] px-1.5 py-0.5 bg-gray-200 rounded">✕</button>
                      </div>
                    ) : (
                      <span className="flex items-center gap-1.5">{stu.name}
                        <button title="修改姓名" onClick={() => { setEditingEmail(stu.email); setEditName(stu.name); }} className="text-[10px] text-blue-500 hover:text-blue-700">✏️</button>
                      </span>
                    )}
                  </td>
                  <td className="text-center px-3 py-2 text-xs text-[var(--color-text-secondary)]">{stu.email}</td>
                  <td className="text-center px-3 py-2 text-[var(--color-text-secondary)]">{stu.queryCount}</td>
                  <td className="text-center px-3 py-2"><span className={`text-xs px-2 py-0.5 rounded-full font-medium ${stu.quizRate >= 70 ? "bg-green-100 text-green-700" : stu.quizRate >= 40 ? "bg-yellow-100 text-yellow-700" : "bg-gray-100 text-gray-500"}`}>{stu.quizTotal} 次 · {stu.quizRate}%</span></td>
                  <td className="text-center px-3 py-2 text-xs text-[var(--color-text-muted)]">{stu.lastActive ? new Date(stu.lastActive).toLocaleString("zh-CN") : "—"}</td>
                  <td className="px-3 py-2">
                    <div className="flex items-center justify-center gap-1">
                      {pwEmail === stu.email ? (
                        <span className="flex items-center gap-1">
                          <input type="password" value={pwValue} onChange={e => setPwValue(e.target.value)} placeholder="新密码≥6位" className="w-24 border border-gray-300 rounded px-1.5 py-0.5 text-xs" />
                          <button onClick={() => resetStudentPassword(stu.email)} disabled={busyEmail === stu.email} className="text-[10px] px-1.5 py-0.5 bg-amber-600 text-white rounded">存</button>
                          <button onClick={() => setPwEmail(null)} className="text-[10px] px-1.5 py-0.5 bg-gray-200 rounded">✕</button>
                        </span>
                      ) : (
                        <button title="重置密码" onClick={() => { setPwEmail(stu.email); setPwValue(""); }} className="text-[10px] px-1.5 py-0.5 bg-gray-100 hover:bg-gray-200 rounded">🔑 重置密码</button>
                      )}
                      <button title="查看学习记录" onClick={() => router.push(`/teacher/students/${encodeURIComponent(stu.email)}`)} className="text-[10px] px-1.5 py-0.5 bg-gray-100 hover:bg-gray-200 rounded">📋 记录</button>
                      <button title="删除学生账号" onClick={() => deleteStudent(stu.email, stu.name)} disabled={busyEmail === stu.email} className="text-[10px] px-1.5 py-0.5 bg-red-50 text-red-600 hover:bg-red-100 rounded disabled:opacity-40">🗑</button>
                    </div>
                  </td>
                </tr>
              ))}</tbody></table>
            </div>}
            {stuMsg && <div className={`px-5 py-2 text-xs ${stuMsg.ok ? "text-green-700 bg-green-50" : "text-red-600 bg-red-50"}`}>{stuMsg.email}: {stuMsg.text}</div>}
          </div>
        </div>
      )}

      {activeTab === "accounts" && <AccountManager />}
      {activeTab === "announcements" && <AnnouncementManager />}
    </div>
  );
}

function AnnouncementManager() {
  const [items, setItems] = useState<Array<{ id: number; title: string; content: string; author_email: string; created_at: string }>>([]);
  const [title, setTitle] = useState("");
  const [content, setContent] = useState("");
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const load = useCallback(async () => {
    try {
      const res = await fetch("/api/admin/announcements", { headers: { Authorization: `Bearer ${getAuthToken()}` } });
      const d = await res.json();
      setItems(d.announcements || []);
    } catch { /* 忽略 */ }
  }, []);
  useEffect(() => { load(); }, [load]);
  const publish = async () => {
    if (!title.trim() || busy) return;
    setBusy(true); setMsg(null);
    try {
      const res = await fetch("/api/admin/announcements", { method: "POST", headers: { "Content-Type": "application/json", Authorization: `Bearer ${getAuthToken()}` }, body: JSON.stringify({ title, content }) });
      const d = await res.json();
      if (res.ok) { setMsg({ ok: true, text: "公告已发布,学生端立即可见" }); setTitle(""); setContent(""); await load(); }
      else setMsg({ ok: false, text: d.error || "发布失败" });
    } finally { setBusy(false); }
  };
  const remove = async (id: number) => {
    if (!confirm("确定删除这条公告?")) return;
    setBusy(true);
    try {
      const res = await fetch("/api/admin/announcements", { method: "DELETE", headers: { "Content-Type": "application/json", Authorization: `Bearer ${getAuthToken()}` }, body: JSON.stringify({ id }) });
      if (res.ok) await load();
    } finally { setBusy(false); }
  };
  return (
    <div className="space-y-4">
      <div className="bg-white rounded-xl border border-[var(--color-border)] p-5">
        <h3 className="text-sm font-bold mb-3">📣 发布课程公告</h3>
        <div className="space-y-3">
          <input value={title} onChange={(e) => setTitle(e.target.value)} maxLength={120} placeholder="公告标题(必填)" className="w-full px-3 py-2 border border-[var(--color-border)] rounded-lg text-sm" />
          <textarea value={content} onChange={(e) => setContent(e.target.value)} maxLength={2000} rows={4} placeholder="公告内容(选填)" className="w-full px-3 py-2 border border-[var(--color-border)] rounded-lg text-sm" />
          <button onClick={publish} disabled={busy || !title.trim()} className="px-4 py-2 rounded-lg bg-[var(--color-primary)] text-white text-sm font-medium disabled:opacity-40">{busy ? "发布中…" : "发布公告"}</button>
          {msg && <div className={`text-xs ${msg.ok ? "text-green-700" : "text-red-600"}`}>{msg.text}</div>}
        </div>
      </div>
      <div className="bg-white rounded-xl border border-[var(--color-border)] overflow-hidden">
        <div className="px-5 py-3 border-b"><h3 className="text-sm font-bold">已发布公告</h3></div>
        {items.length === 0 ? <div className="text-center text-sm text-[var(--color-text-muted)] py-8">暂无公告</div> : <div className="divide-y divide-[var(--color-border)]">{items.map((a) => <div key={a.id} className="px-5 py-3 flex items-start justify-between gap-3"><div className="min-w-0"><div className="text-sm font-medium">{a.title}</div>{a.content && <div className="text-xs text-[var(--color-text-secondary)] mt-1 whitespace-pre-wrap">{a.content}</div>}<div className="text-[11px] text-[var(--color-text-muted)] mt-1">{a.author_email} · {new Date(a.created_at).toLocaleString("zh-CN")}</div></div><button onClick={() => remove(a.id)} disabled={busy} className="shrink-0 text-xs text-red-500 hover:text-red-700 disabled:opacity-40">删除</button></div>)}</div>}
      </div>
    </div>
  );
}

function AccountManager() {
  const [email, setEmail] = useState("");
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);

  async function promote() {
    const em = email.trim();
    if (!em) { setMsg({ ok: false, text: "请输入学生邮箱" }); return; }
    setBusy(true); setMsg(null);
    try {
      const res = await fetch("/api/admin/promote", {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${getAuthToken()}` },
        body: JSON.stringify({ email: em }),
      });
      const data = await res.json().catch(() => null);
      if (res.ok && data?.ok) setMsg({ ok: true, text: `✅ ${em} 已开通为教师,对方重新登录后生效` });
      else setMsg({ ok: false, text: data?.error || "开通失败,请稍后重试" });
    } catch {
      setMsg({ ok: false, text: "网络错误,请稍后重试" });
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="max-w-xl">
      <div className="bg-white rounded-xl border border-[var(--color-border)] p-5">
        <h3 className="text-sm font-bold mb-1">开通教师账号</h3>
        <p className="text-xs text-[var(--color-text-muted)] mb-4">输入学生注册邮箱,将其账号提升为教师端。对方重新登录后生效,密码不变。</p>
        <div className="flex gap-2">
          <input
            type="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            placeholder="学生邮箱,如 zhangsan@163.com"
            className="flex-1 px-3 py-2 rounded-lg border border-[var(--color-border)] text-sm outline-none focus:border-[var(--color-primary)]"
          />
          <button
            onClick={promote}
            disabled={busy}
            className="px-4 py-2 rounded-lg bg-[var(--color-primary)] text-white text-sm font-medium disabled:opacity-50"
          >
            {busy ? "开通中…" : "开通教师"}
          </button>
        </div>
        {msg && (
          <div className={`mt-3 text-sm ${msg.ok ? "text-green-600" : "text-red-500"}`}>{msg.text}</div>
        )}
      </div>
      <p className="text-xs text-[var(--color-text-muted)] mt-3">
        说明:仅教师账号可执行此操作;每次开通都会写入审计记录,可追溯。
      </p>
    </div>
  );
}

