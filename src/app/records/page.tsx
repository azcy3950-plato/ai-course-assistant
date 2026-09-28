"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";

/** 已并入统一学习档案 /history，保留旧 URL 重定向 */
export default function RedirectPage() {
  const router = useRouter();
  useEffect(() => {
    router.replace("/history");
  }, [router]);
  return <div className="p-10 text-center text-sm text-[var(--color-text-muted)]">正在跳转到学习档案…</div>;
}
