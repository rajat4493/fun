import Link from "next/link";

export default function PrivacyPage() {
  return (
    <main className="min-h-screen bg-[#030303] px-6 py-10 text-white">
      <section className="mx-auto max-w-3xl">
        <Link href="/" className="text-sm text-white/46 hover:text-white">Back to F.U.N</Link>
        <h1 className="mt-8 font-serif text-5xl text-white">Privacy</h1>
        <div className="mt-8 space-y-5 text-white/60">
          <p>F.U.N is currently designed without user accounts. Recommendation sessions, seen titles, region, language preference, and recent feedback are stored locally in your browser for the MVP experience.</p>
          <p>When you tap a feedback button, F.U.N may also store a lightweight feedback event so we can improve recommendation quality and understand overall product performance. This can include the feedback reason, recommended title, country, selected mood tags, language preference, taste-risk level, availability mode, confidence score, and anonymous session id.</p>
          <p>Free-text mood descriptions are not sent with feedback events. Do not enter sensitive personal information into free-text mood fields.</p>
          <p>F.U.N does not host or stream content and does not need your streaming-service password.</p>
        </div>
      </section>
    </main>
  );
}
