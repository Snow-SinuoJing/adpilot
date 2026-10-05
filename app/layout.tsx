import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "AdPilot — 自修复智能体广告工作室",
  description: "发一张通告单，智能体剧组开机：三幕叙事、道具检索或 AI 生成、逐帧质检、单镜头自修复，交付竖版成片。",
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html lang="zh-CN" className="h-full antialiased">
      <body className="min-h-full flex flex-col bg-paper text-ink font-sans">{children}</body>
    </html>
  );
}
