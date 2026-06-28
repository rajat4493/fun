import Link from "next/link";

export default function TermsPage() {
  return (
    <main className="min-h-screen bg-[#030303] px-6 py-10 text-white">
      <section className="mx-auto max-w-3xl">
        <Link href="/" className="text-sm text-white/46 hover:text-white">Back to F.U.N</Link>
        <h1 className="mt-8 font-serif text-5xl text-white">Terms</h1>
        <div className="mt-8 space-y-5 text-white/60">
          <p>F.U.N provides entertainment recommendations and availability guidance for discovery purposes. It does not sell, rent, host, or stream movies or shows.</p>
          <p>Availability is verified where possible, but catalogues vary by country, plan, provider, and time. Always confirm availability inside your streaming service before making a purchase or starting a subscription.</p>
          <p>Third-party names, posters, and provider references belong to their respective owners. F.U.N is not affiliated with any streaming platform unless stated separately.</p>
          <p>F.U.N does not claim that any platform intentionally hides titles. Discovery insights are product commentary about catalogue fit and user taste.</p>
        </div>
      </section>
    </main>
  );
}
