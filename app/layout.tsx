import type { Metadata } from "next";
import "./globals.css";
export const metadata: Metadata = {
  metadataBase: new URL("https://lucia-trend.github.io/trend-decision-radar/"),
  title: "趋势决策台",
  description: "市场状态、纪律信号、ETF 强度与云端观察池",
  openGraph: { title: "趋势决策台", description: "今日趋势，先看事实再决策。", images: ["/trend-decision-radar/og.png"] },
  twitter: { card: "summary_large_image", title: "趋势决策台", description: "今日趋势，先看事实再决策。", images: ["/trend-decision-radar/og.png"] },
};
export default function RootLayout({children}:{children:React.ReactNode}){return <html lang="zh-CN"><body>{children}</body></html>}
