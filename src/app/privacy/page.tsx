import Link from "next/link";

export default function PrivacyPage() {
  return (
    <main className="min-h-screen bg-[#030303] px-6 py-10 text-white">
      <section className="mx-auto max-w-3xl">
        <Link href="/" className="text-sm text-white/46 hover:text-white">Back to F.U.N</Link>
        <h1 className="mt-8 font-serif text-5xl text-white">Privacy</h1>
        <div className="mt-8 space-y-5 text-white/60">
          <p>F.U.N is currently designed without user accounts. Recommendation sessions, seen titles, region, language preference, and recent feedback are stored locally in your browser for the MVP experience.</p>
          <p>A request draft is kept in this tab while a recommendation is pending or has failed, so you can retry without retyping. It is cleared after a successful request, when you clear memory, or when the tab session ends.</p>
          <p>F.U.N retains recommendation activity for product learning. This can include mood tags, avoidances, time, energy, language preference, country, selected platforms, interpreted intent, recommended title, availability result, confidence score, and a pseudonymous device ID. These learning records currently have no automatic expiry.</p>
          <p>Your request is processed by our AI providers to generate recommendations. When server-side prompt collection is enabled, free-text requests are also stored with recommendation runs for product improvement. Your current request can remain in browser memory regardless of that setting. Avoid entering sensitive personal information.</p>
          <p>When you tap a feedback button, F.U.N may store that feedback and link it to the recommendation run so we can learn what worked and what missed.</p>
          <p>If you leave an email to unlock more recommendations or request Premium updates, we store it for that purpose. Email records currently have no automatic expiry. F.U.N does not need your streaming-service password.</p>
          <p>Memory lets you clear browser memory and request deletion of the anonymous profile associated with this device. Profile recommendation and feedback lists hold up to 500 entries each and expire after a year without updates; the profile title set also expires after a year without updates. Separate recommendation, feedback and activity records are retained for product learning. They are pseudonymous records, not fully anonymous aggregates, and are not removed by the Memory control.</p>
        </div>
      </section>
    </main>
  );
}
