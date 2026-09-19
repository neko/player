import type { Metadata } from "next";
import "./globals.css";
import { Inter } from "next/font/google";
import { AppProviders } from "@/components/app-providers";
import { cn } from "@/lib/utils";

const inter = Inter({
  subsets: ["latin"],
  variable: "--font-sans",
});

export const metadata: Metadata = {
  title: "player",
  description: "Navidrome music library.",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html
      lang="en"
      className={cn("dark", inter.variable, inter.className)}
      suppressHydrationWarning
    >
      <body className={cn("min-h-screen antialiased", inter.className)}>
        <AppProviders>{children}</AppProviders>
      </body>
    </html>
  );
}
