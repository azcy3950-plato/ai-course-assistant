import { beforeEach, expect, it, vi } from "vitest";
import { NextRequest, NextResponse } from "next/server";
const m = vi.hoisted(() => ({ auth: vi.fn(), pair: vi.fn(), insert: vi.fn(), notification: vi.fn(), email: vi.fn() }));
vi.mock("@/lib/auth-server", () => ({ requireUser: m.auth }));
vi.mock("@/lib/dm-auth", () => ({ authorizeDmPair: m.pair }));
vi.mock("@/lib/dm-email", () => ({ sendDirectMessageEmail: m.email }));
vi.mock("@/lib/learning-db", () => ({ ensureLearningSchema: vi.fn(), addDirectMessage: m.insert, addNotification: m.notification }));
import { POST } from "@/app/api/messages/route";
const request = (body = "作业已批阅") => new NextRequest("https://school.example.com/api/messages", { method: "POST", body: JSON.stringify({ with: "student@example.com", body }) });
beforeEach(() => {
  vi.resetAllMocks();
  m.auth.mockResolvedValue({ auth: { role: "teacher", email: "teacher@example.com" }, resp: null });
  m.pair.mockResolvedValue({ pair: { studentEmail: "student@example.com", teacherEmail: "teacher@example.com" }, resp: null });
  m.insert.mockResolvedValue({ id: 42, body: "作业已批阅" });
  m.notification.mockResolvedValue(undefined);
  m.email.mockResolvedValue("sent");
});
it("saves the teacher's message before sending one email notification", async () => {
  const response = await POST(request());
  expect(await response.json()).toMatchObject({ ok: true, emailNotification: "sent", message: { id: 42 } });
  expect(m.email).toHaveBeenCalledTimes(1);
  expect(m.insert.mock.invocationCallOrder[0]).toBeLessThan(m.email.mock.invocationCallOrder[0]);
});
it("keeps the saved message successful if email fails", async () => {
  m.email.mockResolvedValue("failed");
  const response = await POST(request());
  expect(response.status).toBe(200);
  expect(await response.json()).toMatchObject({ ok: true, emailNotification: "failed" });
});
it("does not send emails for student replies", async () => {
  m.auth.mockResolvedValue({ auth: { role: "student", email: "student@example.com" }, resp: null });
  expect(await (await POST(request())).json()).toMatchObject({ emailNotification: "not_applicable" });
  expect(m.email).not.toHaveBeenCalled();
});
it("does not send mail when authorization or validation fails", async () => {
  expect((await POST(request(""))).status).toBe(400);
  m.pair.mockResolvedValue({ resp: NextResponse.json({}, { status: 403 }), pair: null });
  expect((await POST(request())).status).toBe(403);
  expect(m.insert).not.toHaveBeenCalled();
  expect(m.email).not.toHaveBeenCalled();
});
