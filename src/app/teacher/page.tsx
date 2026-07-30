"use client";

import React, { useState, useEffect, useRef, useCallback } from "react";
import { useRouter } from "next/navigation";
import { useApp } from "@/contexts/AppContext";
import { supabase } from "@/lib/supabase";
import { StudentStats } from "@/types";

const mockStudents: StudentStats[] = [
  { id: "stu-1", name: "张同学", totalSessions: 24, knowledgeQueries: 35, guidedCompleted: 2, sandboxSessions: 5, lastActive: Date.now() - 3600000 },
  { id: "stu-2", name: "王同学", totalSessions: 18, knowledgeQueries: 22, guidedCompleted: 1, sandboxSessions: 3, lastActive: Date.now() - 7200000 },
  { id: "stu-3", name: "李同学", totalSessions: 31, knowledgeQueries: 48, guidedCompleted: 3, sandboxSessions: 8, lastActive: Date.now() - 1800000 },
  { id: "stu-4", name: "赵同学", totalSessions: 8, knowledgeQueries: 12, guidedCompleted: 0, sandboxSessions: 1, lastActive: Date.now() - 86400000 * 3 },
];

interface OssFile {
  name: string;
  key: string;
  size: number;
  url: string;
  lastModified: string;
}

type TabKey = "upload" | "knowledge" | "students";

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

  const getAuthHeaders = useCallback(async () => {
    const { data } = await supabase.auth.getSession();
    return {
      "Content-Type": "application/json",
      Authorization: `Bearer ${data.session?.access_token || ""}`,
    };
  }, []);

  const loadFiles = useCallback(async () => {
    setLoadingFiles(true);
    try {
      const res = await fetch(API, { headers: await getAuthHeaders() });
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
      const headers = await getAuthHeaders();
      const urlRes = await fetch(API, {
        method: "POST",
        headers,
        body: JSON.stringify({ fileName: file.name, fileType: file.type }),
      });
      if (!urlRes.ok) { alert("获取上传链接失败"); return; }
      const { uploadUrl, fileKey, fileUrl } = await urlRes.json();

      // 2) Upload directly to OSS
      await new Promise<void>((resolve, reject) => {
        const xhr = new XMLHttpRequest();
        xhr.open("PUT", uploadUrl);
        xhr.setRequestHeader("Content-Type", file.type || "application/octet-stream");
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
        headers: await getAuthHeaders(),
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
        {[{ k: "upload" as TabKey, l: "资料上传", i: "📤" }, { k: "knowledge" as TabKey, l: "知识库管理", i: "📚" }, { k: "students" as TabKey, l: "学生统计", i: "📊" }].map(t => (
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
                {[["文档总数", files.length, "bg-blue-50 text-blue-700"], ["向量分块", 0, "bg-green-50 text-green-700"], ["章节数", 0, "bg-purple-50 text-purple-700"], ["引用页数", 0, "bg-amber-50 text-amber-700"]].map(([label, val, cls]) => (
                  <div key={String(label)} className={`${cls} rounded-lg p-4 text-center`}>
                    <div className="text-2xl font-bold">{String(val)}</div>
                    <div className="text-xs opacity-70 mt-1">{String(label)}</div>
                  </div>
                ))}
              </div>
            </div>
            <div className="bg-white rounded-xl border border-[var(--color-border)] p-6">
              <h3 className="text-sm font-bold mb-4">📑 文档列表</h3>
              {files.length === 0 ? <div className="text-center text-sm text-[var(--color-text-muted)] py-8">上传文件后显示</div>
              : <div className="space-y-3">{files.map(f => (
                <div key={f.key} className="flex items-center justify-between bg-gray-50 rounded-lg p-3">
                  <div className="flex items-center gap-3"><span>{fileIcon(f.name)}</span><div className="text-xs font-medium truncate max-w-[200px]">{f.name}</div></div>
                  <span className="text-[10px] text-[var(--color-text-muted)]">待向量化</span>
                </div>
              ))}</div>}
            </div>
          </div>
          <div className="bg-white rounded-xl border border-[var(--color-border)] p-6 mt-6">
            <h3 className="text-sm font-bold mb-4">⚙️ 管理操作</h3>
            <div className="flex flex-wrap gap-3">
              <button className="px-4 py-2 text-sm border border-[var(--color-border)] rounded-lg hover:bg-gray-50">🔄 重建向量索引</button>
              <button className="px-4 py-2 text-sm border border-[var(--color-border)] rounded-lg hover:bg-gray-50">📥 导出知识库</button>
              <button className="px-4 py-2 text-sm border border-red-200 text-red-600 rounded-lg hover:bg-red-50">🗑 清空知识库</button>
            </div>
          </div>
        </div>
      )}

      {activeTab === "students" && (
        <div>
          <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-6">
            {[["👥", mockStudents.length, "学生总数"], ["💬", mockStudents.reduce((s, st) => s + st.knowledgeQueries, 0), "知识查询"], ["✅", mockStudents.reduce((s, st) => s + st.guidedCompleted, 0), "完成引导"], ["🗺️", mockStudents.reduce((s, st) => s + st.sandboxSessions, 0), "沙盘实验"]].map(([icon, val, label]) => (
              <div key={String(label)} className="bg-white rounded-xl border border-[var(--color-border)] p-4">
                <div className="text-2xl mb-1">{icon}</div>
                <div className="text-2xl font-bold">{String(val)}</div>
                <div className="text-xs text-[var(--color-text-muted)]">{String(label)}</div>
              </div>
            ))}
          </div>
          <div className="bg-white rounded-xl border border-[var(--color-border)] overflow-hidden">
            <div className="px-5 py-3 border-b"><h3 className="text-sm font-bold">学生详情</h3></div>
            <div className="overflow-x-auto">
              <table className="w-full text-sm"><thead><tr className="border-b bg-gray-50">
                {["姓名","总访问","知识查询","完成引导","沙盘实验","最近活跃"].map(h => <th key={h} className="px-3 py-3 text-xs font-medium text-[var(--color-text-secondary)] text-center">{h}</th>)}
              </tr></thead><tbody>
              {mockStudents.map(stu => (
                <tr key={stu.id} className="border-b hover:bg-gray-50">
                  <td className="px-5 py-3 font-medium">{stu.name}</td>
                  <td className="text-center px-3 py-3 text-[var(--color-text-secondary)]">{stu.totalSessions}</td>
                  <td className="text-center px-3 py-3 text-[var(--color-text-secondary)]">{stu.knowledgeQueries}</td>
                  <td className="text-center px-3 py-3"><span className={`text-xs px-2 py-0.5 rounded-full font-medium ${stu.guidedCompleted >= 2 ? "bg-green-100 text-green-700" : stu.guidedCompleted >= 1 ? "bg-yellow-100 text-yellow-700" : "bg-gray-100 text-gray-500"}`}>{stu.guidedCompleted}/3</span></td>
                  <td className="text-center px-3 py-3 text-[var(--color-text-secondary)]">{stu.sandboxSessions}</td>
                  <td className="text-right px-5 py-3 text-xs text-[var(--color-text-muted)]">{new Date(stu.lastActive).toLocaleDateString("zh-CN")}</td>
                </tr>
              ))}</tbody></table>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
