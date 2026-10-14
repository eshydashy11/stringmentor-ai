import { SlidersHorizontal, Waves, Sparkles, LockKeyhole } from "lucide-react";

const features = [
  {
    title: "Intonation",
    description: "A closer look at your pitch and accuracy.",
    icon: SlidersHorizontal,
  },
  {
    title: "Tone quality",
    description: "Explore the colour and clarity of your sound.",
    icon: Waves,
  },
  {
    title: "AI practice feedback",
    description: "Thoughtful guidance for your next session.",
    icon: Sparkles,
  },
];
export function AnalysisCards() {
  return (
    <section aria-labelledby="analysis-heading" className="analysis-section">
      <div className="section-heading">
        <div>
          <h2 id="analysis-heading">A little more insight, coming soon</h2>
          <p>Your future practice companion.</p>
        </div>
        <span className="outline-badge">ON THE HORIZON</span>
      </div>
      <div className="analysis-grid">
        {features.map(({ title, description, icon: Icon }) => (
          <article className="panel analysis-card" key={title}>
            <span className="feature-icon">
              <Icon size={21} strokeWidth={1.5} />
            </span>
            <h3>{title}</h3>
            <p>{description}</p>
            <span className="not-implemented">
              <LockKeyhole size={12} /> Not yet implemented
            </span>
          </article>
        ))}
      </div>
    </section>
  );
}
