import Link from "next/link";

export default function PrivacyPage() {
  return (
    <main className="min-h-screen bg-[#030303] px-6 py-10 text-white">
      <section className="mx-auto max-w-3xl">
        <Link href="/" className="text-sm text-white/46 hover:text-white">Back to F.U.N</Link>
        <h1 className="mt-8 font-serif text-5xl text-white">Privacy</h1>
        <div className="mt-8 space-y-5 text-white/60">
          <p>F.U.N is currently designed without user accounts. Recommendation sessions, seen titles, region, language preference, and recent feedback are stored locally in your browser for the MVP experience.</p>
          <p>For private preview, F.U.N may store recommendation runs so we can improve matching quality. This can include your mood tags, avoidances, time, energy, language preference, country, selected platforms, interpreted intent, recommended title, availability result, confidence score, and pseudonymous session id.</p>
          <p>When prompt collection is enabled, free-text mood descriptions may also be stored with the recommendation result and later feedback. Do not enter sensitive personal information into free-text mood fields.</p>
          <p>When you tap a feedback button, F.U.N may store that feedback and link it to the recommendation run so we can learn what worked and what missed.</p>
          <p>F.U.N does not host or stream content and does not need your streaming-service password.</p>
        </div>
      </section>
    </main>
  );
}
