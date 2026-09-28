import type { Metadata } from "next";
import "./globals.css";
import { AppProvider } from "@/contexts/AppContext";
import { ChatProvider } from "@/contexts/ChatContext";
import { LearningProvider } from "@/contexts/LearningContext";
import Navbar from "@/components/Navbar";

export const metadata: Metadata = {
  title: "基规智学 — 基础设施规划 AI 教学平台",
  description: "面向《基础设施规划》课程，融合知识库、知识图谱、引导学习、电子沙盘与 SWMM 仿真的智能教学平台",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="zh-CN">
      <body className="min-h-screen bg-[var(--color-surface-alt)]">
        <AppProvider>
          <ChatProvider>
            <LearningProvider>
              <Navbar />
              <main>{children}</main>
            </LearningProvider>
          </ChatProvider>
        </AppProvider>
      </body>
    </html>
  );
}
