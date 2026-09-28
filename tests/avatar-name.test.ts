import { describe, it, expect } from "vitest";
import { avatarFileName } from "../src/lib/avatar-name";

describe("avatarFileName", () => {
  it("同 email 同格式文件名稳定(幂等)", () => {
    const a = avatarFileName("stu@x.com", "image/png");
    const b = avatarFileName("stu@x.com", "image/png");
    expect(a).toBe(b);
    expect(a).toMatch(/^avatar-[0-9a-f]{20}\.png$/);
  });

  it("不同 email 产生不同文件名;扩展名按格式映射", () => {
    expect(avatarFileName("a@x.com", "image/png")).not.toBe(avatarFileName("b@x.com", "image/png"));
    expect(avatarFileName("a@x.com", "image/jpeg")).toBe(avatarFileName("a@x.com", "image/jpeg"));
    expect(avatarFileName("a@x.com", "image/jpeg")).toMatch(/\.jpg$/);
    expect(avatarFileName("a@x.com", "image/webp")).toMatch(/\.webp$/);
  });

  it("不含路径分隔符/斜杠(防路径穿越)", () => {
    const n = avatarFileName("../etc/passwd@evil.com", "image/png");
    expect(n).not.toMatch(/[/\\]/);
    expect(n).toMatch(/^avatar-[0-9a-f]{20}\.png$/);
  });
});
