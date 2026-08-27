import type { EffectiveTaskStatus, TaskType } from "@/types";

export const TASK_TYPE_META: Record<TaskType, { label: string; icon: string; cls: string }> = {
  KNOWLEDGE: { label: "知识学习", icon: "📚", cls: "bg-blue-50 text-blue-700" },
  PRACTICE: { label: "专项练习", icon: "✏️", cls: "bg-green-50 text-green-700" },
  GUIDED: { label: "引导学习", icon: "💡", cls: "bg-purple-50 text-purple-700" },
  SIMULATION: { label: "仿真任务", icon: "🗺️", cls: "bg-amber-50 text-amber-700" },
  REMEDIAL: { label: "补充学习", icon: "🔁", cls: "bg-rose-50 text-rose-700" },
};

export const TASK_STATUS_META: Record<EffectiveTaskStatus, { label: string; cls: string }> = {
  TODO: { label: "未开始", cls: "bg-gray-100 text-gray-600" },
  IN_PROGRESS: { label: "进行中", cls: "bg-blue-50 text-blue-700" },
  SUBMITTED: { label: "待教师反馈", cls: "bg-amber-50 text-amber-700" },
  REVISION_REQUIRED: { label: "需要修改", cls: "bg-red-50 text-red-600" },
  COMPLETED: { label: "已完成", cls: "bg-green-50 text-green-700" },
  OVERDUE: { label: "已逾期", cls: "bg-orange-50 text-orange-700" },
};

export function formatDate(iso: string | null | undefined): string {
  if (!iso) return "—";
  const d = new Date(iso);
  if (isNaN(d.getTime())) return "—";
  return d.toLocaleDateString("zh-CN", { month: "numeric", day: "numeric" }) + " " +
    d.toLocaleTimeString("zh-CN", { hour: "2-digit", minute: "2-digit" });
}

export function formatDeadline(iso: string | null | undefined): string {
  if (!iso) return "无截止时间";
  const d = new Date(iso);
  if (isNaN(d.getTime())) return "无截止时间";
  return d.toLocaleDateString("zh-CN", { year: "numeric", month: "long", day: "numeric" });
}
