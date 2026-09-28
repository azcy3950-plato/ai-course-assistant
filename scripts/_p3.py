# 1) /api/tasks/[id] 学生分支也返回 attachments
p = 'src/app/api/tasks/[id]/route.ts'
s = open(p, encoding='utf-8').read()
old = """    const st = await getStudentTask(taskId, auth.email);
    if (!st) return NextResponse.json({ error: "你未被分配该任务" }, { status: 403 });
    const submissions = await listStudentSubmissions(taskId, auth.email);
    return NextResponse.json({
      task: { ...task, questions: maskQuestions(task.questions || []) },
      studentTask: st,
      submissions,
    });"""
new = """    const st = await getStudentTask(taskId, auth.email);
    if (!st) return NextResponse.json({ error: "你未被分配该任务" }, { status: 403 });
    const [submissions, attachments] = await Promise.all([
      listStudentSubmissions(taskId, auth.email),
      listTaskAttachments(taskId),
    ]);
    return NextResponse.json({
      task: { ...task, questions: maskQuestions(task.questions || []) },
      studentTask: st,
      submissions,
      attachments,
    });"""
assert old in s
s = s.replace(old, new, 1)
open(p, 'w', encoding='utf-8').write(s)
print('api ok')

# 2) 学生任务页：附件状态 + 上传 + 提交携带 + 展示
p = 'src/app/tasks/[id]/page.tsx'
s = open(p, encoding='utf-8').read()

old_state = "  // 标记完成弹窗（必填\"我的收获\"，教师可见）"
new_state = """  // 附件（仿真任务提交证据；≤10MB/个，≤5 个）
  const [attFiles, setAttFiles] = useState<{ fileKey: string; fileName: string; fileSize: number; mime: string }[]>([]);
  const [attUploading, setAttUploading] = useState(false);
  const [attachments, setAttachments] = useState<any[]>([]);

  const pickAttachments = async (fileList: FileList | null) => {
    if (!fileList?.length) return;
    const remaining = 5 - attFiles.length;
    const picked = Array.from(fileList).slice(0, Math.max(0, remaining));
    if (picked.length === 0) { alert("每次提交最多 5 个附件"); return; }
    setAttUploading(true);
    try {
      for (const file of picked) {
        if (file.size > 10 * 1024 * 1024) { alert(`「${file.name}」超过 10MB，已跳过`); continue; }
        const presign = await fetch("/api/attachments", {
          method: "POST",
          headers: { "Content-Type": "application/json", Authorization: "Bearer " + getAuthToken() },
          body: JSON.stringify({ fileName: file.name, fileType: file.type, fileSize: file.size }),
        });
        if (!presign.ok) { alert("附件上传通道不可用"); continue; }
        const { uploadUrl, fileKey, contentType } = await presign.json();
        await new Promise<void>((resolve, reject) => {
          const xhr = new XMLHttpRequest();
          xhr.open("PUT", uploadUrl);
          xhr.setRequestHeader("Content-Type", contentType || file.type || "application/octet-stream");
          xhr.onload = () => (xhr.status >= 200 && xhr.status < 300 ? resolve() : reject(new Error("上传失败")));
          xhr.onerror = () => reject(new Error("网络错误"));
          xhr.send(file);
        });
        setAttFiles((prev) => [...prev, { fileKey, fileName: file.name, fileSize: file.size, mime: file.type }]);
      }
    } catch (e: any) { alert(e.message || "附件上传失败"); }
    setAttUploading(false);
  };

  const downloadAttachment = async (fileKey: string) => {
    try {
      const r = await fetch(`/api/attachments?key=${encodeURIComponent(fileKey)}`, { headers: { Authorization: "Bearer " + getAuthToken() } });
      if (!r.ok) { alert("下载失败"); return; }
      window.open((await r.json()).url, "_blank");
    } catch { alert("下载失败"); }
  };

  // 标记完成弹窗（必填\"我的收获\"，教师可见）"""
assert old_state in s
s = s.replace(old_state, new_state, 1)

# load 时保存 attachments
old_load = """      setTask(data.task);
      setSt(data.studentTask);
      setSubmissions(data.submissions || []);"""
new_load = """      setTask(data.task);
      setSt(data.studentTask);
      setSubmissions(data.submissions || []);
      setAttachments(data.attachments || []);"""
assert old_load in s
s = s.replace(old_load, new_load, 1)

# submitSim 携带附件
old_sim = """      const res = await fetch(`/api/tasks/${id}/submissions`, {
        method: "POST", headers,
        body: JSON.stringify({ judgment: judgment.trim(), explanation: explanation.trim(), reflection: reflection.trim() }),
      });"""
new_sim = """      const res = await fetch(`/api/tasks/${id}/submissions`, {
        method: "POST", headers,
        body: JSON.stringify({ judgment: judgment.trim(), explanation: explanation.trim(), reflection: reflection.trim(), attachments: attFiles }),
      });"""
assert old_sim in s
s = s.replace(old_sim, new_sim, 1)
# 提交成功后清空附件
old_ok = "      if (!res.ok) alert(data.error || \"提交失败\");\n      else await load();\n    } catch {\n      alert(\"网络错误\");\n    } finally {\n      setBusy(false);\n    }\n    // eslint-disable-next-line react-hooks/exhaustive-deps\n  }, [judgment, explanation, reflection, id, load]);"
new_ok = "      if (!res.ok) alert(data.error || \"提交失败\");\n      else { setAttFiles([]); await load(); }\n    } catch {\n      alert(\"网络错误\");\n    } finally {\n      setBusy(false);\n    }\n    // eslint-disable-next-line react-hooks/exhaustive-deps\n  }, [judgment, explanation, reflection, attFiles, id, load]);"
assert old_ok in s
s = s.replace(old_ok, new_ok, 1)

# SIMULATION 表单：反思 textarea 后插入附件区
old_ref = """                  <button onClick={submitSim} disabled={busy}"""
new_ref = """                  <div>
                    <label className="text-xs font-semibold text-[var(--color-text-secondary)] mb-1.5 block">📎 附件（可选，≤10MB/个 · ≤5 个，如沙盘截图/分析图）</label>
                    <input type="file" multiple accept=".pdf,.png,.jpg,.jpeg,.doc,.docx"
                      onChange={(e) => { pickAttachments(e.target.files); e.target.value = ""; }}
                      className="block w-full text-xs text-[var(--color-text-muted)]" />
                    {attUploading && <p className="text-xs text-amber-600 mt-1">上传中…</p>}
                    {attFiles.length > 0 && (
                      <div className="flex flex-wrap gap-1.5 mt-2">
                        {attFiles.map((f) => (
                          <span key={f.fileKey} className="flex items-center gap-1 text-[10px] px-2 py-0.5 rounded-full bg-blue-50 text-blue-700">
                            📎 {f.fileName}
                            <button onClick={() => setAttFiles((prev) => prev.filter((x) => x.fileKey !== f.fileKey))} className="hover:text-red-500">✕</button>
                          </span>
                        ))}
                      </div>
                    )}
                  </div>
                  <button onClick={submitSim} disabled={busy}"""
assert old_ref in s
s = s.replace(old_ref, new_ref, 1)

# 最近提交展示附件（提交历史块内）
old_hist = """                  {latest.reflection && (
                    <div className="rounded-lg bg-purple-50 p-3">
                      <div className="text-xs font-semibold text-purple-800 mb-1">我的反思</div>
                      <p className="text-xs text-purple-900 leading-5 whitespace-pre-wrap">{latest.reflection}</p>
                    </div>
                  )}"""
new_hist = old_hist + """
                  {attachments.filter((a) => a.submission_id === latest.id).length > 0 && (
                    <div className="rounded-lg bg-gray-50 p-3">
                      <div className="text-xs font-semibold text-[var(--color-text)] mb-1">📎 附件</div>
                      <div className="flex flex-wrap gap-2">
                        {attachments.filter((a) => a.submission_id === latest.id).map((a) => (
                          <button key={a.id} onClick={() => downloadAttachment(a.file_key)}
                            className="text-[10px] px-2 py-1 rounded-full bg-white border border-[var(--color-border)] hover:border-[var(--color-primary)]">
                            📎 {a.file_name}（{(a.file_size / 1024).toFixed(0)}KB）
                          </button>
                        ))}
                      </div>
                    </div>
                  )}"""
assert old_hist in s
s = s.replace(old_hist, new_hist, 1)
open(p, 'w', encoding='utf-8').write(s)
print('student page ok')
