/**
 * 课程公告:表结构 + 查询/发布/删除(全部参数化)。
 */
import { Pool } from "pg";

const pool = new Pool({ connectionString: process.env.DATABASE_URL });

export async function ensureAnnouncementsSchema(): Promise<void> {
  if (!pool) return;
  await pool.query(
    `CREATE TABLE IF NOT EXISTS announcements (
       id SERIAL PRIMARY KEY,
       title TEXT NOT NULL,
       content TEXT NOT NULL DEFAULT '',
       author_email TEXT NOT NULL,
       created_at TIMESTAMPTZ NOT NULL DEFAULT now()
     )`,
  );
}

export interface Announcement {
  id: number;
  title: string;
  content: string;
  author_email: string;
  created_at: string;
}

export async function listAnnouncements(limit = 5): Promise<Announcement[]> {
  if (!pool) return [];
  await ensureAnnouncementsSchema();
  const { rows } = await pool.query(
    `SELECT id, title, content, author_email, created_at
     FROM announcements
     ORDER BY id DESC
     LIMIT ${Math.max(1, Math.min(50, Math.floor(limit) || 5))}`,
  );
  return rows;
}

export async function createAnnouncement(title: string, content: string, authorEmail: string): Promise<Announcement | null> {
  if (!pool) return null;
  await ensureAnnouncementsSchema();
  const safeTitle = String(title || "").slice(0, 120);
  const safeContent = String(content || "").slice(0, 2000);
  if (!safeTitle) return null;
  const { rows } = await pool.query(
    `INSERT INTO announcements (title, content, author_email) VALUES ($1, $2, $3)
     RETURNING id, title, content, author_email, created_at`,
    [safeTitle, safeContent, authorEmail],
  );
  return rows[0] || null;
}

export async function deleteAnnouncement(id: number): Promise<boolean> {
  if (!pool) return false;
  await ensureAnnouncementsSchema();
  const { rowCount } = await pool.query(`DELETE FROM announcements WHERE id = $1`, [Number(id) || 0]);
  return (rowCount || 0) > 0;
}
