import type { Metadata } from "next";
import "./globals.css";
export const metadata: Metadata = { title: "趋势决策台", description: "基于趋势动物 API 的移动端趋势投资巡检工具" };
export default function RootLayout({children}:{children:React.ReactNode}){return <html lang="zh-CN"><body>{children}</body></html>}
