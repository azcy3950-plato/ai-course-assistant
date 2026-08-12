import { createHash } from "crypto";

/** 头像文件名 = email 哈希 + 扩展名(防路径穿越/枚举;同 email 恒稳定) */
export function avatarFileName(email: string, mime: string): string {
  const ext = mime === "image/png" ? "png" : mime === "image/jpeg" ? "jpg" : "webp";
  const hash = createHash("sha256").update(String(email)).digest("hex").slice(0, 20);
  return `avatar-${hash}.${ext}`;
}
