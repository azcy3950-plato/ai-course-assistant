"use client";
import { useEffect } from "react";
import { useRouter } from "next/navigation";
export default function SimulateRedirect() {
  const router = useRouter();
  useEffect(() => { router.replace("/sandbox"); }, [router]);
  return <div className="h-screen flex items-center justify-center bg-black text-white text-sm">跳转中...</div>;
}
