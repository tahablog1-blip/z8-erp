import type { Metadata } from "next";
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

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="ar" dir="rtl" suppressHydrationWarning>
      <head>
        <link rel="preconnect" href="https://fonts.googleapis.com" />
        <link rel="preconnect" href="https://fonts.gstatic.com" crossOrigin="anonymous" />
        <link rel="stylesheet"
              href="https://fonts.googleapis.com/css2?family=Material+Symbols+Rounded:opsz,wght,FILL,GRAD@20..24,400,0..1,0" />
        {/* خطوط بديلة لإعداد «الخط» في التصميم (عربي + إنجليزي) — المتصفح ما بيحمّلش إلا الخط المُستخدَم فعلياً */}
        <link rel="stylesheet"
              href="https://fonts.googleapis.com/css2?family=Tajawal:wght@400;500;700;900&family=IBM+Plex+Sans+Arabic:wght@400;500;600;700&family=Almarai:wght@400;700;800&family=Noto+Kufi+Arabic:wght@400;600;700&family=Changa:wght@400;600;700;800&family=El+Messiri:wght@400;500;600;700&family=Readex+Pro:wght@400;500;600;700&family=Reem+Kufi:wght@400;500;600;700&family=Markazi+Text:wght@400;500;600;700&family=Lalezar&family=Harmattan:wght@400;700&family=Inter:wght@400;500;600;700;800&family=Roboto:wght@400;500;700;900&family=Poppins:wght@400;500;600;700&family=Montserrat:wght@400;500;600;700;800&family=Lato:wght@400;700;900&family=Open+Sans:wght@400;500;600;700&family=Nunito:wght@400;600;700;800&family=Work+Sans:wght@400;500;600;700&family=Source+Sans+3:wght@400;500;600;700&family=Manrope:wght@400;500;600;700;800&family=DM+Sans:wght@400;500;700&family=Outfit:wght@400;500;600;700&display=swap" />
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
