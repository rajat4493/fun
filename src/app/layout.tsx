import type { Metadata, Viewport } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "F.U.N — One perfect pick tonight",
  description: "A classy streaming decision engine that gives one pick, with availability verified where possible.",
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  maximumScale: 1,
  viewportFit: "cover",
  themeColor: "#030303",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>
        {children}
        <div className="border-t border-white/[0.06] bg-[#030303] px-6 py-4 text-center text-xs leading-5 text-white/28">
          Availability is verified where possible and may vary by region or provider catalogue changes.
          {" · "}F.U.N does not host, sell, or stream content.
          {" · "}No claim is made that any platform intentionally hides titles.
          {" · "}
          <a href="/terms" className="hover:text-white/50">Terms</a>
          {" · "}
          <a href="/privacy" className="hover:text-white/50">Privacy</a>
          {" · "}
          <a href="/methodology" className="hover:text-white/50">Methodology</a>
        </div>
      </body>
    </html>
  );
}
