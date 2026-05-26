import "./globals.css";
import type { Metadata } from "next";
import type { ReactNode } from "react";
import { Toaster } from "sonner";
import { ModalStackProvider } from "@/components/modal-stack";

export const metadata: Metadata = {
  title: "PRD-Lab",
  description: "AI 产品经理方案交付平台",
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="zh-CN" suppressHydrationWarning>
      <body suppressHydrationWarning>
        <ModalStackProvider>
          {children}
          <Toaster position="bottom-right" richColors />
        </ModalStackProvider>
      </body>
    </html>
  );
}
