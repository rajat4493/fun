import Link from "next/link";

const sections = [
  {
    title: "Recommendation Method",
    body: "F.U.N combines the user's mood, reference titles, avoidances, time context, selected country, and selected subscriptions to produce one primary pick. Reference-title requests are matched on deeper traits such as emotional engine, character morality, social world, pacing, humor darkness, and relationship dynamics rather than genre labels alone.",
  },
  {
    title: "Availability",
    body: "Availability is verified where possible against F.U.N's current verified catalogue. Streaming catalogues change by country and over time, so unverified titles are labelled clearly. In subscription-only mode, F.U.N should only show picks verified for the selected subscription and region.",
  },
  {
    title: "Provider And Poster Data",
    body: "F.U.N does not scrape streaming services and does not host or stream any title. Provider and poster metadata may come from configured third-party services, but this metadata is not treated as verified regional subscription availability unless it is in the verified catalogue.",
  },
  {
    title: "Platform Language",
    body: "F.U.N does not claim that Netflix, Prime Video, Disney+, or any other platform intentionally hides titles. Hidden-layer language is intended as a tasteful discovery insight about catalogue fit and recommendation surfaces.",
  },
  {
    title: "Feedback",
    body: "Feedback controls are stored locally in the browser for the MVP. They help evaluate whether F.U.N is fulfilling its one-pick promise without requiring user accounts.",
  },
];

export default function MethodologyPage() {
  return (
    <main className="min-h-screen bg-[#030303] px-6 py-10 text-white">
      <section className="mx-auto max-w-3xl">
        <Link href="/" className="text-sm text-white/46 hover:text-white">Back to F.U.N</Link>
        <h1 className="mt-8 font-serif text-5xl text-white">Methodology</h1>
        <div className="mt-8 space-y-5">
          {sections.map((section) => (
            <article key={section.title} className="rounded-2xl border border-white/10 bg-white/[0.04] p-5">
              <h2 className="text-xl text-white">{section.title}</h2>
              <p className="mt-3 leading-7 text-white/58">{section.body}</p>
            </article>
          ))}
        </div>
      </section>
    </main>
  );
}
