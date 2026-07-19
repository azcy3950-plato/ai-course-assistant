"use client";

import React, { useState, useEffect } from "react";
import { useRouter } from "next/navigation";
import { useApp } from "@/contexts/AppContext";
import { UploadedDocument, StudentStats } from "@/types";

// Mock data
const mockDocuments: UploadedDocument[] = [
  {
    id: 'doc-1',
    name: '城市排水系统工程.pdf',
    type: 'pdf',
    size: 15.6 * 1024 * 1024,
    uploadDate: Date.now() - 7 * 86400000,
    chunks: 42,
    status: 'ready',
  },
  {
    id: 'doc-2',
    name: '海绵城市案例集.pdf',
    type: 'pdf',
    size: 8.2 * 1024 * 1024,
    uploadDate: Date.now() - 5 * 86400000,
    chunks: 28,
    status: 'ready',
  },
  {
    id: 'doc-3',
    name: '城市内涝防治技术指南.pdf',
    type: 'pdf',
    size: 22.1 * 1024 * 1024,
    uploadDate: Date.now() - 3 * 86400000,
    chunks: 56,
    status: 'ready',
  },
  {
    id: 'doc-4',
    name: '排水系统设计基础.pptx',
    type: 'ppt',
    size: 5.4 * 1024 * 1024,
    uploadDate: Date.now() - 2 * 86400000,
    chunks: 18,
    status: 'processing',
  },
  {
    id: 'doc-5',
    name: '深圳内涝调查报告.docx',
    type: 'docx',
    size: 3.1 * 1024 * 1024,
    uploadDate: Date.now() - 1 * 86400000,
    chunks: 0,
    status: 'error',
  },
];

const mockStudents: StudentStats[] = [
  {
    id: 'stu-1',
    name: '张同学',
    totalSessions: 24,
    knowledgeQueries: 35,
    guidedCompleted: 2,
    sandboxSessions: 5,
    lastActive: Date.now() - 3600000,
  },
  {
    id: 'stu-2',
    name: '王同学',
    totalSessions: 18,
    knowledgeQueries: 22,
    guidedCompleted: 1,
    sandboxSessions: 3,
    lastActive: Date.now() - 7200000,
  },
  {
    id: 'stu-3',
    name: '李同学',
    totalSessions: 31,
    knowledgeQueries: 48,
    guidedCompleted: 3,
    sandboxSessions: 8,
    lastActive: Date.now() - 1800000,
  },
  {
    id: 'stu-4',
    name: '赵同学',
    totalSessions: 8,
    knowledgeQueries: 12,
    guidedCompleted: 0,
    sandboxSessions: 1,
    lastActive: Date.now() - 86400000 * 3,
  },
];

type TabKey = 'upload' | 'knowledge' | 'students';

export default function TeacherPage() {
  const { state } = useApp();
  const router = useRouter();
  const [authorized, setAuthorized] = useState(false);

  // ── Role guard ──
  useEffect(() => {
    if (state.authLoading) return;
    if (!state.role) {
      router.replace(
        "/login?redirect=" + encodeURIComponent("/teacher")
      );
    } else if (state.role !== "teacher") {
      router.replace("/");
    } else {
      setAuthorized(true);
    }
  }, [state.authLoading, state.role, router]);

  if (state.authLoading || !authorized) {
    return (
      <div className="flex items-center justify-center min-h-[60vh] text-[var(--color-text-muted)]">
        加载中...
      </div>
    );
  }

  const [activeTab, setActiveTab] = useState<TabKey>('upload');
  const [dragOver, setDragOver] = useState(false);
  const [documents, setDocuments] = useState(mockDocuments);

  const tabs: { key: TabKey; label: string; icon: string }[] = [
    { key: 'upload', label: '资料上传', icon: '📤' },
    { key: 'knowledge', label: '知识库管理', icon: '📚' },
    { key: 'students', label: '学生统计', icon: '📊' },
  ];

  const formatSize = (bytes: number) => {
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
    return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  };

  const formatDate = (ts: number) => {
    return new Date(ts).toLocaleDateString('zh-CN', {
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
    });
  };

  const statusBadge = (status: UploadedDocument['status']) => {
    const config = {
      ready: { bg: 'bg-green-100', text: 'text-green-700', label: '已就绪' },
      processing: { bg: 'bg-yellow-100', text: 'text-yellow-700', label: '处理中' },
      error: { bg: 'bg-red-100', text: 'text-red-700', label: '失败' },
    };
    const c = config[status];
    return (
      <span className={`text-[10px] px-2 py-0.5 rounded-full font-medium ${c.bg} ${c.text}`}>
        {c.label}
      </span>
    );
  };

  const handleDeleteDoc = (id: string) => {
    setDocuments(prev => prev.filter(d => d.id !== id));
  };

  return (
    <div className="max-w-6xl mx-auto px-4 py-6">
      <div className="mb-6">
        <h1 className="text-2xl font-bold text-[var(--color-text)] mb-1">教学管理</h1>
        <p className="text-sm text-[var(--color-text-secondary)]">
          管理课程资料、知识库内容和学生使用数据
        </p>
      </div>

      {/* Tabs */}
      <div className="flex gap-1 mb-6 bg-gray-100 rounded-xl p-1 w-fit">
        {tabs.map(tab => (
          <button
            key={tab.key}
            onClick={() => setActiveTab(tab.key)}
            className={`px-4 py-2 rounded-lg text-sm font-medium transition-colors ${
              activeTab === tab.key
                ? 'bg-white text-[var(--color-text)] shadow-sm'
                : 'text-[var(--color-text-secondary)] hover:text-[var(--color-text)]'
            }`}
          >
            <span className="mr-1.5">{tab.icon}</span>
            {tab.label}
          </button>
        ))}
      </div>

      {/* Tab Content */}
      {activeTab === 'upload' && (
        <div>
          {/* Drop Zone */}
          <div
            onDragOver={e => { e.preventDefault(); setDragOver(true); }}
            onDragLeave={() => setDragOver(false)}
            onDrop={e => { e.preventDefault(); setDragOver(false); }}
            className={`border-2 border-dashed rounded-2xl p-12 text-center transition-colors mb-6 ${
              dragOver
                ? 'border-[var(--color-primary)] bg-[var(--color-primary-bg)]'
                : 'border-gray-300 hover:border-gray-400'
            }`}
          >
            <div className="text-4xl mb-3">📤</div>
            <h3 className="text-lg font-bold text-[var(--color-text)] mb-1">
              拖拽文件到此处上传
            </h3>
            <p className="text-sm text-[var(--color-text-secondary)] mb-4">
              支持 PDF、PPT、DOCX、图片等格式，单文件最大 50MB
            </p>
            <button
              className="inline-flex items-center gap-1.5 px-5 py-2.5 bg-[var(--color-primary)] text-white rounded-lg text-sm font-medium hover:bg-[var(--color-primary-dark)] transition-colors"
            >
              <span>+</span> 选择文件
            </button>
          </div>

          {/* File List */}
          <div className="bg-white rounded-xl border border-[var(--color-border)]">
            <div className="px-5 py-3 border-b border-[var(--color-border)] flex items-center justify-between">
              <h3 className="text-sm font-bold text-[var(--color-text)]">已上传文件</h3>
              <span className="text-xs text-[var(--color-text-muted)]">{documents.length} 个文件</span>
            </div>
            {documents.length === 0 ? (
              <div className="p-8 text-center text-sm text-[var(--color-text-muted)]">
                暂无上传文件
              </div>
            ) : (
              <div className="divide-y divide-[var(--color-border)]">
                {documents.map(doc => (
                  <div key={doc.id} className="flex items-center gap-4 px-5 py-3.5 hover:bg-gray-50 transition-colors">
                    <span className="text-2xl">
                      {doc.type === 'pdf' ? '📄' : doc.type === 'ppt' ? '📊' : doc.type === 'docx' ? '📝' : '🖼'}
                    </span>
                    <div className="flex-1 min-w-0">
                      <div className="text-sm font-medium text-[var(--color-text)] truncate">
                        {doc.name}
                      </div>
                      <div className="text-xs text-[var(--color-text-muted)] flex gap-3 mt-0.5">
                        <span>{formatSize(doc.size)}</span>
                        <span>{formatDate(doc.uploadDate)}</span>
                        {doc.status === 'ready' && <span>{doc.chunks} 个分块</span>}
                      </div>
                    </div>
                    <div className="flex items-center gap-2">
                      {statusBadge(doc.status)}
                      <button
                        onClick={() => handleDeleteDoc(doc.id)}
                        className="text-[var(--color-text-muted)] hover:text-[var(--color-danger)] transition-colors text-sm"
                        title="删除"
                      >
                        🗑
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      )}

      {activeTab === 'knowledge' && (
        <div>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
            {/* Knowledge Stats */}
            <div className="bg-white rounded-xl border border-[var(--color-border)] p-6">
              <h3 className="text-sm font-bold text-[var(--color-text)] mb-4">📊 知识库概览</h3>
              <div className="grid grid-cols-2 gap-4">
                <div className="bg-blue-50 rounded-lg p-4 text-center">
                  <div className="text-2xl font-bold text-blue-700">3</div>
                  <div className="text-xs text-blue-600 mt-1">文档总数</div>
                </div>
                <div className="bg-green-50 rounded-lg p-4 text-center">
                  <div className="text-2xl font-bold text-green-700">126</div>
                  <div className="text-xs text-green-600 mt-1">向量分块</div>
                </div>
                <div className="bg-purple-50 rounded-lg p-4 text-center">
                  <div className="text-2xl font-bold text-purple-700">8</div>
                  <div className="text-xs text-purple-600 mt-1">章节数</div>
                </div>
                <div className="bg-amber-50 rounded-lg p-4 text-center">
                  <div className="text-2xl font-bold text-amber-700">42</div>
                  <div className="text-xs text-amber-600 mt-1">引用页数</div>
                </div>
              </div>
            </div>

            {/* Document Chunk Details */}
            <div className="bg-white rounded-xl border border-[var(--color-border)] p-6">
              <h3 className="text-sm font-bold text-[var(--color-text)] mb-4">📑 文档分块详情</h3>
              <div className="space-y-3">
                {mockDocuments.filter(d => d.status === 'ready').map(doc => (
                  <div key={doc.id} className="flex items-center justify-between bg-gray-50 rounded-lg p-3">
                    <div className="flex items-center gap-3">
                      <span>📄</span>
                      <div>
                        <div className="text-xs font-medium text-[var(--color-text)]">{doc.name}</div>
                        <div className="text-[10px] text-[var(--color-text-muted)]">{doc.chunks} 个知识块</div>
                      </div>
                    </div>
                    <button className="text-xs text-[var(--color-primary)] hover:underline">
                      查看分块
                    </button>
                  </div>
                ))}
              </div>
            </div>
          </div>

          {/* Management Actions */}
          <div className="bg-white rounded-xl border border-[var(--color-border)] p-6 mt-6">
            <h3 className="text-sm font-bold text-[var(--color-text)] mb-4">⚙️ 管理操作</h3>
            <div className="flex flex-wrap gap-3">
              <button className="px-4 py-2 text-sm border border-[var(--color-border)] rounded-lg hover:bg-gray-50 transition-colors">
                🔄 重建向量索引
              </button>
              <button className="px-4 py-2 text-sm border border-[var(--color-border)] rounded-lg hover:bg-gray-50 transition-colors">
                📥 导出知识库
              </button>
              <button className="px-4 py-2 text-sm border border-[var(--color-danger)] text-[var(--color-danger)] rounded-lg hover:bg-red-50 transition-colors">
                🗑 清空知识库
              </button>
            </div>
          </div>
        </div>
      )}

      {activeTab === 'students' && (
        <div>
          {/* Summary Cards */}
          <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-6">
            <div className="bg-white rounded-xl border border-[var(--color-border)] p-4">
              <div className="text-2xl mb-1">👥</div>
              <div className="text-2xl font-bold text-[var(--color-text)]">{mockStudents.length}</div>
              <div className="text-xs text-[var(--color-text-muted)]">学生总数</div>
            </div>
            <div className="bg-white rounded-xl border border-[var(--color-border)] p-4">
              <div className="text-2xl mb-1">💬</div>
              <div className="text-2xl font-bold text-[var(--color-text)]">
                {mockStudents.reduce((s, st) => s + st.knowledgeQueries, 0)}
              </div>
              <div className="text-xs text-[var(--color-text-muted)]">知识查询总次数</div>
            </div>
            <div className="bg-white rounded-xl border border-[var(--color-border)] p-4">
              <div className="text-2xl mb-1">✅</div>
              <div className="text-2xl font-bold text-[var(--color-text)]">
                {mockStudents.reduce((s, st) => s + st.guidedCompleted, 0)}
              </div>
              <div className="text-xs text-[var(--color-text-muted)]">完成引导学习</div>
            </div>
            <div className="bg-white rounded-xl border border-[var(--color-border)] p-4">
              <div className="text-2xl mb-1">🗺️</div>
              <div className="text-2xl font-bold text-[var(--color-text)]">
                {mockStudents.reduce((s, st) => s + st.sandboxSessions, 0)}
              </div>
              <div className="text-xs text-[var(--color-text-muted)]">沙盘实验次数</div>
            </div>
          </div>

          {/* Student Table */}
          <div className="bg-white rounded-xl border border-[var(--color-border)] overflow-hidden">
            <div className="px-5 py-3 border-b border-[var(--color-border)]">
              <h3 className="text-sm font-bold text-[var(--color-text)]">学生详情</h3>
            </div>
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-[var(--color-border)] bg-gray-50">
                    <th className="text-left px-5 py-3 text-xs font-medium text-[var(--color-text-secondary)]">姓名</th>
                    <th className="text-center px-3 py-3 text-xs font-medium text-[var(--color-text-secondary)]">总访问</th>
                    <th className="text-center px-3 py-3 text-xs font-medium text-[var(--color-text-secondary)]">知识查询</th>
                    <th className="text-center px-3 py-3 text-xs font-medium text-[var(--color-text-secondary)]">完成引导</th>
                    <th className="text-center px-3 py-3 text-xs font-medium text-[var(--color-text-secondary)]">沙盘实验</th>
                    <th className="text-right px-5 py-3 text-xs font-medium text-[var(--color-text-secondary)]">最近活跃</th>
                  </tr>
                </thead>
                <tbody>
                  {mockStudents.map(stu => (
                    <tr key={stu.id} className="border-b border-[var(--color-border)] hover:bg-gray-50 transition-colors">
                      <td className="px-5 py-3 font-medium text-[var(--color-text)]">{stu.name}</td>
                      <td className="text-center px-3 py-3 text-[var(--color-text-secondary)]">{stu.totalSessions}</td>
                      <td className="text-center px-3 py-3 text-[var(--color-text-secondary)]">{stu.knowledgeQueries}</td>
                      <td className="text-center px-3 py-3">
                        <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${
                          stu.guidedCompleted >= 2
                            ? 'bg-green-100 text-green-700'
                            : stu.guidedCompleted >= 1
                            ? 'bg-yellow-100 text-yellow-700'
                            : 'bg-gray-100 text-gray-500'
                        }`}>
                          {stu.guidedCompleted}/3
                        </span>
                      </td>
                      <td className="text-center px-3 py-3 text-[var(--color-text-secondary)]">{stu.sandboxSessions}</td>
                      <td className="text-right px-5 py-3 text-xs text-[var(--color-text-muted)]">
                        {new Date(stu.lastActive).toLocaleDateString('zh-CN')}
                      </td>
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
