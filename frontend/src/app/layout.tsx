import type { Metadata } from "next";
import { Roboto, Geist_Mono, Syne } from "next/font/google";
import { Toaster } from "@/components/ui/sonner";
import { TooltipProvider } from "@/components/ui/tooltip";
import { Providers } from "@/components/providers";
import { AppShell } from "@/components/layout/app-shell";
import { Analytics } from "@vercel/analytics/next";
import "./globals.css";

const roboto = Roboto({ subsets: ["latin"], variable: "--font-sans", weight: ["400", "500", "700"] });
const geistMono = Geist_Mono({ variable: "--font-geist-mono", subsets: ["latin"] });
const syne = Syne({ subsets: ["latin"], variable: "--font-syne", weight: ["400", "500", "600", "700", "800"] });

export const metadata: Metadata = {
  title: "Luray.ai",
  description: "LLM-powered database discovery and semantic layer generation",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" suppressHydrationWarning className={`${roboto.variable} ${syne.variable}`}>
      <body className={`${geistMono.variable} antialiased`}>
        <Providers>
          <TooltipProvider>
            <AppShell>{children}</AppShell>
            <Toaster richColors position="bottom-right" />
          </TooltipProvider>
        </Providers>
        <Analytics />
      </body>
    </html>
  );
}
