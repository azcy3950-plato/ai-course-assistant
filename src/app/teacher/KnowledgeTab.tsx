"use client";

import React, { useState, useEffect, useRef, useCallback } from "react";
import { useApp, getAuthToken } from "@/contexts/AppContext";
import { supabase } from "@/lib/supabase";

const STATUS_META: Record<string, { label: string; cls: string }> = {
  UPLOADING: { label: "上传中", cls: "bg-blue-50 text-blue-600" },
  PARSING: { label: "解析中", cls: "bg-amber-50 text-amber-700" },
  INDEXING: { label: "入库中", cls: "bg-purple-50 text-purple-700" },
  READY: { label: "已入库", cls: "bg-green-50 text-green-700" },
  FAILED: { label: "失败", cls: "bg-red-50 text-red-600" },
};

function mapType(name: string): string {
  const ext = name.split(".").pop()?.toLowerCase() || "";
  if (ext === "pdf") return "pdf";
  if (["ppt", "pptx"].includes(ext)) return "ppt";
  if (["doc", "docx"].includes(ext)) return "docx";
  return "other";
}
const fileIcon = (name: string) => ({ pdf: "📄", ppt: "📊", docx: "📝" }[mapType(name)] || "📁");

/** 知识库（合并资料上传 + 知识库管理）：上传 → 解析状态机 → 重试/删除/重复检测 + 真实概览 */
export default function KnowledgeTab() {
  const { state } = useApp();
  const [files, setFiles] = useState<any[]>([]);
  const [docs, setDocs] = useState<any[]>([]);
  const [graphCounts, setGraphCounts] = useState({ nodes: 0, networks: 0 });
  const [uploading, setUploading] = useState(false);
  const [progress, setProgress] = useState(0);
  const [loading, setLoading] = useState(true);
  const [busyKey, setBusyKey] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const headers = { Authorization: `Bearer ${getAuthToken()}` };
      const [fRes, dRes, gRes] = await Promise.all([
        fetch("/api/storage", { headers }),
        fetch("/api/documents-status", { headers }).catch(() => null),
        fetch("/api/knowledge-graph", { headers }),
      ]);
      if (fRes.ok) setFiles(await fRes.json());
      if (dRes && dRes.ok) setDocs((await dRes.json()).items || []);
      if (gRes.ok) {
        const d = await gRes.json();
        setGraphCounts({
          nodes: d.graph?.nodes?.length ?? 0,
          networks: Array.isArray(d.networks) ? d.networks.length : 0,
        });
      }
    } catch (e) { /* 静默 */ }
    setLoading(false);
  }, []);

  useEffect(() => { load(); }, [load]);

  const handleFiles = async (fileList: FileList | null) => {
    if (!fileList?.length) return;
    const file = fileList[0];
    if (file.size > 200 * 1024 * 1024) { alert("文件不能超过 200MB"); return; }

    // 重复文件检测（同名 + 同大小）
    const dup = docs.find((d) => d.file_name === file.name);
    if (dup) {
      if (!confirm(`知识库中已存在同名文件「${file.name}」（${dup.status === "READY" ? "已入库" : dup.status}），仍要再次上传吗？`)) return;
    }

    setUploading(true);
    setProgress(0);
    const headers = { "Content-Type": "application/json", Authorization: `Bearer ${getAuthToken()}` };
    try {
      // 1) 预签名
      const urlRes = await fetch("/api/storage", {
        method: "POST", headers,
        body: JSON.stringify({ fileName: file.name, fileType: file.type }),
      });
      if (!urlRes.ok) { alert("获取上传链接失败"); return; }
      const { uploadUrl, fileKey, contentType } = await urlRes.json();

      // 2) 状态：上传中
      await fetch("/api/documents-status", {
        method: "POST", headers,
        body: JSON.stringify({ fileKey, fileName: file.name, status: "UPLOADING", uploadedBy: state.userName || "" }),
      });

      // 3) OSS 直传
      await new Promise<void>((resolve, reject) => {
        const xhr = new XMLHttpRequest();
        xhr.open("PUT", uploadUrl);
        xhr.setRequestHeader("Content-Type", contentType || file.type || "application/octet-stream");
        xhr.upload.onprogress = (e) => { if (e.lengthComputable) setProgress(Math.round((e.loaded / e.total) * 100)); };
        xhr.onload = () => (xhr.status >= 200 && xhr.status < 300 ? resolve() : reject(new Error(`HTTP ${xhr.status}`)));
        xhr.onerror = () => reject(new Error("网络错误"));
        xhr.send(file);
      });

      // 4) 元数据（supabase documents，历史兼容）
      try {
        await supabase.from("documents").insert({
          name: file.name, type: mapType(file.name), size: file.size,
          r2_key: fileKey, uploaded_by: state.userName || "unknown",
        });
      } catch (e) { /* 非致命 */ }

      // 5) 解析入库（状态机：PARSING → READY/FAILED）
      await fetch("/api/documents-status", {
        method: "POST", headers,
        body: JSON.stringify({ fileKey, fileName: file.name, status: "PARSING", uploadedBy: state.userName || "" }),
      });
      try {
        const pRes = await fetch("/api/process-file", {
          method: "POST", headers,
          body: JSON.stringify({ fileName: file.name, fileKey }),
        });
        const pData = await pRes.json().catch(() => ({}));
        if (pRes.ok) {
          await fetch("/api/documents-status", {
            method: "POST", headers,
            body: JSON.stringify({
              fileKey, fileName: file.name, status: "READY",
              chunkCount: Number(pData.chunks || 0), uploadedBy: state.userName || "",
            }),
          });
        } else {
          await fetch("/api/documents-status", {
            method: "POST", headers,
            body: JSON.stringify({
              fileKey, fileName: file.name, status: "FAILED",
              error: pData.error || "解析失败", uploadedBy: state.userName || "",
            }),
          });
        }
      } catch (err: any) {
        await fetch("/api/documents-status", {
          method: "POST", headers,
          body: JSON.stringify({
            fileKey, fileName: file.name, status: "FAILED",
            error: err?.message || "解析异常", uploadedBy: state.userName || "",
          }),
        });
      }
      await load();
    } catch (err: any) {
      alert("上传失败: " + (err.message || "未知错误"));
    } finally {
      setUploading(false);
      setProgress(0);
    }
  };

  const retryParse = async (d: any) => {
    setBusyKey(d.file_key);
    try {
      const headers = { "Content-Type": "application/json", Authorization: `Bearer ${getAuthToken()}` };
      await fetch("/api/documents-status", {
        method: "POST", headers,
        body: JSON.stringify({ fileKey: d.file_key, fileName: d.file_name, status: "PARSING", uploadedBy: d.uploaded_by }),
      });
      const pRes = await fetch("/api/process-file", {
        method: "POST", headers,
        body: JSON.stringify({ fileName: d.file_name, fileKey: d.file_key }),
      });
      const pData = await pRes.json().catch(() => ({}));
      await fetch("/api/documents-status", {
        method: "POST", headers,
        body: JSON.stringify({
          fileKey: d.file_key, fileName: d.file_name,
          status: pRes.ok ? "READY" : "FAILED",
          chunkCount: Number(pData.chunks || 0),
          error: pRes.ok ? "" : pData.error || "解析失败",
          uploadedBy: d.uploaded_by,
        }),
      });
      await load();
    } catch (e) { alert("重试失败"); }
    setBusyKey(null);
  };

  const removeDoc = async (d: any) => {
    if (!confirm(`删除「${d.file_name}」及其解析记录？`)) return;
    setBusyKey(d.file_key);
    try {
      await fetch("/api/storage", {
        method: "DELETE",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${getAuthToken()}` },
        body: JSON.stringify({ fileKey: d.file_key }),
      });
      await supabase.from("documents").delete().eq("r2_key", d.file_key);
      await fetch("/api/documents-status", {
        method: "DELETE",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${getAuthToken()}` },
        body: JSON.stringify({ fileKey: d.file_key }),
      });
      await load();
    } catch (e) { alert("删除失败"); }
    setBusyKey(null);
  };

  return (
    <div>
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-5">
        {[
          ["文档总数", docs.length, "bg-blue-50 text-blue-700"],
          ["知识网络", graphCounts.networks, "bg-green-50 text-green-700"],
          ["图谱节点", graphCounts.nodes, "bg-purple-50 text-purple-700"],
          ["已入库", docs.filter((d) => d.status === "READY").length, "bg-amber-50 text-amber-700"],
        ].map(([label, val, cls]) => (
          <div key={String(label)} className={`${cls} rounded-lg p-4 text-center`}>
            <div className="text-2xl font-bold">{String(val)}</div>
            <div className="text-xs opacity-70 mt-1">{String(label)}</div>
          </div>
        ))}
      </div>

      {/* 上传区 */}
      <div onDragOver={(e) => e.preventDefault()} onDrop={(e) => { e.preventDefault(); handleFiles(e.dataTransfer.files); }}
        className={`border-2 border-dashed rounded-2xl p-8 text-center transition-colors mb-6 ${uploading ? "border-[var(--color-primary)] bg-[var(--color-primary-bg)]" : "border-gray-300 hover:border-gray-400"}`}>
        <div className="text-4xl mb-3">📤</div>
        <h3 className="text-lg font-bold text-[var(--color-text)] mb-1">拖拽文件到此处上传</h3>
        <p className="text-sm text-[var(--color-text-secondary)] mb-4">支持 PDF、PPT、DOCX 等，上传后自动解析入库，状态实时可见</p>
        <button onClick={() => fileInputRef.current?.click()} disabled={uploading}
          className="inline-flex items-center gap-1.5 px-5 py-2.5 bg-[var(--color-primary)] text-white rounded-lg text-sm font-medium hover:opacity-90 disabled:opacity-50">
          + {uploading ? `上传中 ${progress}%` : "选择文件"}
        </button>
        <input ref={fileInputRef} type="file" accept=".pdf,.ppt,.pptx,.doc,.docx,.png,.jpg,.jpeg,.gif,.webp" className="hidden"
          onChange={(e) => handleFiles(e.target.files)} />
      </div>

      {/* 解析状态列表 */}
      <div className="bg-white rounded-xl border border-[var(--color-border)] overflow-hidden">
        <div className="px-5 py-3 border-b border-[var(--color-border)] flex items-center justify-between">
          <h3 className="text-sm font-bold">文档解析状态</h3>
          <button onClick={load} className="text-xs text-[var(--color-primary)] hover:underline">🔄 刷新</button>
        </div>
        {loading ? (
          <div className="p-8 text-center text-sm text-[var(--color-text-muted)]">加载中…</div>
        ) : docs.length === 0 ? (
          <div className="p-8 text-center text-sm text-[var(--color-text-muted)]">暂无上传文档</div>
        ) : (
          <div className="divide-y divide-[var(--color-border)]">
            {docs.map((d) => {
              const meta = STATUS_META[d.status] || STATUS_META.UPLOADING;
              return (
                <div key={d.file_key} className="flex items-center gap-4 px-5 py-3.5 hover:bg-gray-50">
                  <span className="text-2xl">{fileIcon(d.file_name)}</span>
                  <div className="flex-1 min-w-0">
                    <div className="text-sm font-medium truncate">{d.file_name}</div>
                    <div className="text-[10px] text-[var(--color-text-muted)] mt-0.5">
                      {maskUploader(d.uploaded_by)} · {new Date(d.created_at).toLocaleString("zh-CN", { hour12: false })}
                      {d.status === "READY" && d.chunk_count > 0 && ` · ${d.chunk_count} 分块`}
                    </div>
                    {d.status === "FAILED" && d.error && (
                      <div className="text-[10px] text-red-500 mt-0.5">⚠️ {d.error}</div>
                    )}
                  </div>
                  <span className={`text-[10px] px-2 py-0.5 rounded-full font-medium ${meta.cls}`}>{meta.label}</span>
                  <div className="flex items-center gap-2 shrink-0">
                    {d.status === "FAILED" && (
                      <button onClick={() => retryParse(d)} disabled={busyKey === d.file_key}
                        className="text-xs px-2 py-1 rounded border border-[var(--color-primary)] text-[var(--color-primary)] hover:bg-[var(--color-primary-bg)] disabled:opacity-50">重试解析</button>
                    )}
                    <button onClick={() => removeDoc(d)} disabled={busyKey === d.file_key}
                      className="text-xs text-[var(--color-text-muted)] hover:text-red-500">删除</button>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>
      <p className="text-[11px] text-[var(--color-text-muted)] mt-2">文档数来自真实上传记录；知识网络/图谱节点计数来自课程知识图谱（实时）。</p>
    </div>
  );
}

function maskUploader(s: string): string {
  if (!s) return "未知";
  return s.includes("@") ? s.split("@")[0] + "***" : s;
}
