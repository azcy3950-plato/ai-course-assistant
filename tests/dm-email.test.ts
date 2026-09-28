import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ query: vi.fn(), name: vi.fn(), mail: vi.fn() }));
vi.mock("@/lib/learning-db", () => ({ pool: { query: mocks.query }, getUserName: mocks.name }));
vi.mock("@/lib/mailer", () => ({ getTransporter: () => ({ sendMail: mocks.mail }) }));
import { sendDirectMessageEmail } from "@/lib/dm-email";

const input = { studentIdentifier: "13800138000", teacherEmail: "teacher@example.com", body: "请完成作业。\n<script>不会执行</script>", messageId: 42 };
beforeEach(() => {
  vi.resetAllMocks();
  vi.stubEnv("SMTP_HOST", "smtp.example.com");
  vi.stubEnv("SMTP_FROM", "school@example.com");
  vi.stubEnv("SMTP_USER", "");
  vi.stubEnv("APP_URL", "https://school.example.com");
  mocks.query.mockResolvedValue({ rows: [{ email: "student@example.com" }] });
  mocks.name.mockResolvedValue("王老师");
  mocks.mail.mockResolvedValue({ accepted: ["student@example.com"] });
});
describe("private message email", () => {
  it("resolves a phone identifier to the student's stored email and sends plain text with a trusted conversation link", async () => {
    expect(await sendDirectMessageEmail(input)).toBe("sent");
    expect(mocks.query.mock.calls[0][1]).toEqual([input.studentIdentifier]);
    const sent = mocks.mail.mock.calls[0][0];
    expect(sent.to.address).toBe("student@example.com");
    expect(sent.text).toContain(input.body);
    expect(sent.text).toContain("王老师");
    expect(sent.text).toContain("https://school.example.com/messages/teacher%40example.com");
    expect(sent.html).toBeUndefined();
    expect(sent.disableFileAccess).toBe(true);
  });
  it.for([[], [{ email: null }], [{ email: "13800138000" }], [{ email: "one@example.com,two@example.com" }]])("does not send to a missing or invalid account email", async rows => {
    mocks.query.mockResolvedValue({ rows });
    expect(await sendDirectMessageEmail(input)).toBe("no_email");
    expect(mocks.mail).not.toHaveBeenCalled();
  });
  it("reports SMTP rejection or failure without throwing and exposing message contents", async () => {
    const log = vi.spyOn(console, "error").mockImplementation(() => {});
    mocks.mail.mockRejectedValue(new Error("SMTP unavailable"));
    expect(await sendDirectMessageEmail(input)).toBe("failed");
    expect(log).toHaveBeenCalledWith("[dm-email] delivery failed for message", 42);
    log.mockRestore();
    mocks.mail.mockResolvedValue({ accepted: [], rejected: ["student@example.com"] });
    expect(await sendDirectMessageEmail(input)).toBe("failed");
  });
  it("does not pretend to send when SMTP is unconfigured", async () => {
    vi.stubEnv("SMTP_HOST", "");
    expect(await sendDirectMessageEmail(input)).toBe("failed");
    expect(mocks.mail).not.toHaveBeenCalled();
  });
});
