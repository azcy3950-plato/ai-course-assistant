import type { Metadata } from "next";
import "./globals.css";
import { AppProvider } from "@/contexts/AppContext";
import { ChatProvider } from "@/contexts/ChatContext";
import { LearningProvider } from "@/contexts/LearningContext";
import Navbar from "@/components/Navbar";

export const metadata: Metadata = {
  title: "AI 课程助教 — 城市排水与内涝防治",
  description: "统一知识库智能体、引导思考智能体、电子沙盘三位一体的AI课程助教平台",
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
