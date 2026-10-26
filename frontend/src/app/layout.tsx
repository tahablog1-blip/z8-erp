import type { Metadata, Viewport } from "next";
import { Cairo } from "next/font/google";
import "./globals.css";
import { AuthProvider } from "@/lib/auth";
import { LangProvider } from "@/lib/i18n";

const plex = Cairo({
  subsets: ["arabic", "latin"],
  weight: ["400", "600", "700", "800", "900"],
  variable: "--font-app",
});

export const metadata: Metadata = {
  title: "Z8 — منصة مصدر الزيوت",
  description: "منصة إدارة متكاملة لفروع خدمة الزيوت",
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  viewportFit: "cover",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="ar" dir="rtl" suppressHydrationWarning>
      <head>
        <link rel="preconnect" href="https://fonts.googleapis.com" />
        <link rel="preconnect" href="https://fonts.gstatic.com" crossOrigin="anonymous" />
        <link rel="stylesheet"
              href="https://fonts.googleapis.com/css2?family=Material+Symbols+Rounded:opsz,wght,FILL,GRAD@20..24,400,0..1,0&display=block" />
        <script dangerouslySetInnerHTML={{ __html:
          `try{
            var t=localStorage.getItem("z8_theme");
            if(t==="dark")document.documentElement.dataset.theme="dark";
            var l=localStorage.getItem("z8_lang");
            if(l==="en"){
              document.documentElement.lang="en";
              document.documentElement.dir="ltr";
            }
          }catch(e){}`,
        }} />
      </head>
      <body className={`${plex.className} bg-ink text-text antialiased`}>
        <LangProvider><AuthProvider>{children}</AuthProvider></LangProvider>
      </body>
    </html>
  );
}
