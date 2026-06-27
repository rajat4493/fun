import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "F.U.N — One perfect pick tonight",
  description: "A classy streaming decision engine that gives one pick and tells you if your apps fit your taste.",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>
        {children}
        <div className="border-t border-white/[0.06] bg-[#030303] px-6 py-4 text-center text-xs text-white/28">
          Streaming availability data provided by{" "}
          <a href="https://www.justwatch.com" className="underline underline-offset-2 hover:text-white/50" target="_blank" rel="noreferrer">
            JustWatch
          </a>
          {" · "}Poster images provided by{" "}
          <a href="https://www.omdbapi.com" className="underline underline-offset-2 hover:text-white/50" target="_blank" rel="noreferrer">
            OMDB/IMDB
          </a>
          {" · "}F.U.N does not host or stream any content
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
