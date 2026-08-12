"use client";
import { useEffect, useState } from "react";
import Link from "next/link";

interface Me { id: string; email: string; name: string; role: string; avatar: string | null }

function getAuthToken(): string | null {
  try { return localStorage.getItem("aicourse-token"); } catch { return null; }
}

export default function ProfilePage() {
  const [me, setMe] = useState<Me | null>(null);
  const [msg, setMsg] = useState<{ text: string; ok: boolean } | null>(null);
  const [name, setName] = useState("");
  const [oldPw, setOldPw] = useState("");
  const [newPw, setNewPw] = useState("");
  const [newPw2, setNewPw2] = useState("");
  const [avatarData, setAvatarData] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    const token = getAuthToken();
    if (!token) { location.href = "/login"; return; }
    fetch("/api/auth/me", { headers: { Authorization: `Bearer ${token}` } })
      .then(r => r.json())
      .then(d => { if (d?.user) { setMe(d.user); setName(d.user.name); } else { location.href = "/login"; } })
      .catch(() => location.href = "/login");
  }, []);

  const flash = (text: string, ok: boolean) => { setMsg({ text, ok }); setTimeout(() => setMsg(null), 4000); };
  const api = async (path: string, method: string, body: any) => {
    const res = await fetch(path, { method, headers: { "Content-Type": "application/json", Authorization: `Bearer ${getAuthToken()}` }, body: JSON.stringify(body) });
    const d = await res.json().catch(() => ({}));
    return { ok: res.ok, d };
  };

  const saveName = async () => {
    if (!name.trim()) return flash("姓名不能为空", false);
    setBusy(true);
    const { ok, d } = await api("/api/auth/me", "PATCH", { name: name.trim() });
    setBusy(false);
    if (ok) { setMe(m => m ? { ...m, name: name.trim() } : m); flash("姓名已更新 ✓", true); }
    else flash(d.error || "保存失败", false);
  };

  const savePassword = async () => {
    if (newPw.length < 6) return flash("新密码至少 6 位", false);
    if (newPw !== newPw2) return flash("两次新密码不一致", false);
    setBusy(true);
    const { ok, d } = await api("/api/auth/password", "PUT", { oldPassword: oldPw, newPassword: newPw });
    setBusy(false);
    if (ok) { setOldPw(""); setNewPw(""); setNewPw2(""); flash("密码已修改 ✓", true); }
    else flash(d.error || "修改失败", false);
  };

  const onFile = (f: File | undefined) => {
    if (!f) return;
    if (!["image/png", "image/jpeg", "image/webp"].includes(f.type)) return flash("仅支持 png/jpeg/webp", false);
    if (f.size > 2 * 1024 * 1024) return flash("图片不能超过 2MB", false);
    const reader = new FileReader();
    reader.onload = () => setAvatarData(String(reader.result));
    reader.readAsDataURL(f);
  };

  const saveAvatar = async () => {
    if (!avatarData) return flash("请先选择图片", false);
    setBusy(true);
    const { ok, d } = await api("/api/auth/avatar", "POST", { dataURL: avatarData });
    setBusy(false);
    if (ok) { setMe(m => m ? { ...m, avatar: d.avatar } : m); setAvatarData(null); flash("头像已更新 ✓", true); }
    else flash(d.error || "上传失败", false);
  };

  return (
    <div className="min-h-screen bg-black text-gray-200 flex items-center justify-center p-4">
      <div className="w-full max-w-md bg-gray-950 border border-gray-800 rounded-xl p-6 shadow-2xl">
        <div className="flex items-center justify-between mb-5">
          <h1 className="text-lg font-bold text-amber-400">👤 个人中心</h1>
          <Link href="/" className="text-xs text-gray-500 hover:text-gray-300">← 返回</Link>
        </div>

        {!me ? (
          <div className="text-center text-sm text-gray-500 py-8">加载中…</div>
        ) : (
          <>
            {/* 基本信息 */}
            <div className="flex items-center gap-3 mb-5">
              {avatarData
                ? <img src={avatarData} alt="预览" className="w-14 h-14 rounded-full object-cover border border-gray-600" />
                : me.avatar
                  ? <img src={me.avatar} alt="头像" className="w-14 h-14 rounded-full object-cover border border-gray-600" />
                  : <div className="w-14 h-14 rounded-full bg-gray-800 border border-gray-600 flex items-center justify-center text-xl">👤</div>}
              <div>
                <div className="font-bold">{me.name}</div>
                <div className="text-xs text-gray-500">{me.email}</div>
                <div className="text-[10px] mt-0.5 text-amber-400/80">{me.role === "teacher" ? "教师账号" : "学生账号"}</div>
              </div>
            </div>

            {msg && <div className={`mb-3 text-xs text-center py-1.5 rounded ${msg.ok ? "bg-green-950 text-green-400" : "bg-red-950 text-red-400"}`}>{msg.text}</div>}

            {/* 姓名 */}
            <div className="mb-4">
              <div className="text-xs text-gray-400 mb-1">修改姓名</div>
              <div className="flex gap-2">
                <input value={name} onChange={e => setName(e.target.value)} maxLength={30} placeholder="姓名"
                  className="flex-1 bg-gray-900 border border-gray-700 rounded px-2 py-1.5 text-sm outline-none focus:border-amber-500" />
                <button onClick={saveName} disabled={busy} className="px-3 py-1.5 bg-amber-600 hover:bg-amber-500 rounded text-sm font-bold text-black disabled:opacity-50">保存</button>
              </div>
            </div>

            {/* 密码 */}
            <div className="mb-4">
              <div className="text-xs text-gray-400 mb-1">修改密码</div>
              <input type="password" value={oldPw} onChange={e => setOldPw(e.target.value)} placeholder="旧密码"
                className="w-full bg-gray-900 border border-gray-700 rounded px-2 py-1.5 text-sm outline-none focus:border-amber-500 mb-2" />
              <input type="password" value={newPw} onChange={e => setNewPw(e.target.value)} placeholder="新密码(至少 6 位)"
                className="w-full bg-gray-900 border border-gray-700 rounded px-2 py-1.5 text-sm outline-none focus:border-amber-500 mb-2" />
              <input type="password" value={newPw2} onChange={e => setNewPw2(e.target.value)} placeholder="确认新密码"
                className="w-full bg-gray-900 border border-gray-700 rounded px-2 py-1.5 text-sm outline-none focus:border-amber-500 mb-2" />
              <button onClick={savePassword} disabled={busy} className="w-full py-1.5 bg-gray-800 hover:bg-gray-700 rounded text-sm font-bold disabled:opacity-50">修改密码</button>
            </div>

            {/* 头像 */}
            <div>
              <div className="text-xs text-gray-400 mb-1">更换头像(png/jpeg/webp,≤2MB)</div>
              <div className="flex gap-2">
                <label className="flex-1 text-center py-1.5 bg-gray-800 hover:bg-gray-700 rounded text-sm font-bold cursor-pointer">
                  选择图片
                  <input type="file" accept="image/png,image/jpeg,image/webp" className="hidden" onChange={e => onFile(e.target.files?.[0])} />
                </label>
                <button onClick={saveAvatar} disabled={busy || !avatarData} className="px-3 py-1.5 bg-amber-600 hover:bg-amber-500 rounded text-sm font-bold text-black disabled:opacity-40">上传</button>
              </div>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
