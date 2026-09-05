import { NextRequest, NextResponse } from "next/server";
import { requireTeacher } from "@/lib/auth-server";
import { ensureKnowledgeGraphSchema } from "@/lib/knowledge-graph";
import {
  ensureLearningSchema,
  ensureAnalyticsIndexes,
  listClasses,
  listTeacherStudentEmails,
  listTeacherTasks,
  dashboardTaskStats,
  dashboardPendingSubmissions,
  dashboardActiveStudents,
  dashboardTrend,
  dashboardClassProgress,
  dashboardQuizTopicAccuracy,
  dashboardWeakStudents,
  dashboardRecentEvents,
} from "@/lib/learning-db";

/**
 * 教师仪表盘（真实数据库聚合，不做大屏）：
 * 所有统计限定在教师负责班级的学生范围内；无数据显示空数组/0，前端按空态呈现。
 */
export async function GET(req: NextRequest) {
  const { auth, resp } = requireTeacher(req);
  if (resp) return resp;
  try {
    await ensureLearningSchema();
    await ensureKnowledgeGraphSchema().catch(() => {});
    ensureAnalyticsIndexes().catch(() => {});

    const [classes, studentEmails, taskStats, pending, classProgress] = await Promise.all([
      listClasses(auth.email),
      listTeacherStudentEmails(auth.email),
      dashboardTaskStats(auth.email),
      dashboardPendingSubmissions(auth.email),
      dashboardClassProgress(auth.email),
    ]);
    const [active7d, trend, quizTopics, weakStudents, recentEvents, tasks] = await Promise.all([
      dashboardActiveStudents(auth.email, 7),
      dashboardTrend(auth.email, 14),
      dashboardQuizTopicAccuracy(auth.email),
      dashboardWeakStudents(auth.email, 5),
      dashboardRecentEvents(auth.email, 20),
      listTeacherTasks(auth.email),
    ]);

    const overdueTasks = tasks
      .filter((t: any) => (t.overdue ?? 0) > 0)
      .slice(0, 5)
      .map((t: any) => ({
        id: t.id, title: t.title, class_name: t.class_name, deadline: t.deadline,
        overdue: t.overdue, submitted: t.submitted, type: t.type,
      }));

    return NextResponse.json({
      stats: {
        classCount: classes.length,
        studentCount: studentEmails.length,
        taskTotal: taskStats.total,
        taskDone: taskStats.done,
        submitted: taskStats.submitted,
        revision: taskStats.revision,
        overdue: taskStats.overdue,
        pending: pending,
        active7d,
      },
      classProgress,
      trend,
      quizTopics,
      weakStudents,
      overdueTasks,
      recentEvents: recentEvents.slice(0, 15),
    });
  } catch (err: any) {
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}
