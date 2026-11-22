"use client";

import "./globals.css";

export default function GlobalError({ reset }: { error: Error & { digest?: string }; reset: () => void }) {
  return (
    <html lang="en">
      <body className="m-0 grid min-h-screen place-items-center bg-[#030303] px-6 font-sans text-center text-white">
        <main className="max-w-md">
          <p className="text-xs font-semibold uppercase tracking-[0.24em] text-amber-200/75">F.U.N</p>
          <h1 className="mt-4 font-serif text-4xl">We need a fresh take.</h1>
          <p className="mt-4 text-white/58">Refresh this page, or try again in a moment.</p>
          <button type="button" onClick={reset} className="mt-8 rounded-lg bg-white px-4 py-2.5 text-sm font-medium text-black">Try again</button>
        </main>
      </body>
    </html>
  );
}
