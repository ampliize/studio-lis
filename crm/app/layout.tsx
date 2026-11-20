import "./globals.css";
import type { Metadata } from "next";
import { Italiana, Jost } from "next/font/google";

const jost = Jost({ subsets: ["latin"], variable: "--font-jost", display: "swap" });
const italiana = Italiana({ subsets: ["latin"], weight: "400", variable: "--font-italiana", display: "swap" });

export const metadata: Metadata = { title: "Studio Lis Cazais — Atendimento", description: "Conversas, agenda e indicadores da assistente Laura" };

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="pt-BR" className={`${jost.variable} ${italiana.variable}`}>
      <body>{children}</body>
    </html>
  );
}
