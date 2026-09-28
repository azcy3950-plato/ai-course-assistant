import { Pool } from "pg";

/**
 * 统一审计日志（audit_log 表由 learning-db 的 ensureLearningSchema 懒建）。
 * 只记录操作者/动作/目标，绝不记录密码、验证码明文、token。
 */
const pool = new Pool({ connectionString: process.env.DATABASE_URL });

export async function logAudit(input: {
  operatorEmail: string;
  action: string;
  targetType?: string;
  targetId?: string;
  detail?: string;
}): Promise<void> {
  try {
    await pool.query(
      "INSERT INTO audit_log (operator_email, action, target_type, target_id, detail) VALUES ($1,$2,$3,$4,$5)",
      [input.operatorEmail, input.action, input.targetType || "", input.targetId || "", input.detail || ""],
    );
  } catch (err) {
    console.error("[audit]", err);
  }
}
