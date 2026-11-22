"use client";

import { useEffect } from "react";

export default function Error({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  useEffect(() => {
    // Keep details in platform logs; customers should never see an internal error message.
    console.error("[FUN route error]", { digest: error.digest });
  }, [error.digest]);

  return (
    <main className="grid min-h-screen place-items-center bg-[#030303] px-6 text-center text-white">
      <section className="max-w-md">
        <p className="text-xs font-semibold uppercase tracking-[0.24em] text-amber-200/75">F.U.N</p>
        <h1 className="mt-4 font-serif text-4xl">That didn&apos;t land.</h1>
        <p className="mt-4 text-white/58">Please try again. Your saved preferences are still here.</p>
        <div className="mt-8 flex justify-center gap-3">
          <button type="button" onClick={reset} className="rounded-lg bg-white px-4 py-2.5 text-sm font-medium text-black">Try again</button>
          <a href="/" className="rounded-lg border border-white/15 px-4 py-2.5 text-sm text-white/75">Start over</a>
        </div>
      </section>
    </main>
  );
}
