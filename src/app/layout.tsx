/** Root layout: fonts, metadata, page background. */
import type { Metadata, Viewport } from "next";
import { Atkinson_Hyperlegible, Lilita_One } from "next/font/google";
import "./globals.css";

const lilita = Lilita_One({ weight: "400", subsets: ["latin"], variable: "--font-lilita" });
const atkinson = Atkinson_Hyperlegible({ weight: ["400", "700"], subsets: ["latin"], variable: "--font-atkinson" });

export const metadata: Metadata = {
  title: { default: "Tagalingo — learn Tagalog in five minutes a day", template: "%s | Tagalingo" },
  description:
    "Short, playful Tagalog lessons for English speakers. Keep a streak, earn XP and climb the weekly Barkada League.",
  icons: { icon: "/icon.svg" },
};

export const viewport: Viewport = {
  themeColor: "#0b6e75",
  width: "device-width",
  initialScale: 1,
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html lang="en" className={`${lilita.variable} ${atkinson.variable} h-full antialiased`}>
      <body className="min-h-full">{children}</body>
    </html>
  );
}
