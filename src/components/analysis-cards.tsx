import Link from "next/link";
import { SlidersHorizontal, Waves, Sparkles, LockKeyhole } from "lucide-react";

const features = [
  {
    title: "Intonation",
    description: "Measure cello pitch locally in Practice Studio.",
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
export function AnalysisCards({
  hideIntonation = false,
}: {
  hideIntonation?: boolean;
}) {
  return (
    <section aria-labelledby="analysis-heading" className="analysis-section">
      <div className="section-heading">
        <div>
          <h2 id="analysis-heading">Your practice insights</h2>
          <p>Explore what’s available and what’s ahead.</p>
        </div>
        <span className="outline-badge">PRACTICE TOOLS</span>
      </div>
      <div className="analysis-grid">
        {features
          .filter(
            (feature) => !hideIntonation || feature.title !== "Intonation",
          )
          .map(({ title, description, icon: Icon }) => (
            <article className="panel analysis-card" key={title}>
              <span className="feature-icon">
                <Icon size={21} strokeWidth={1.5} />
              </span>
              <h3>{title}</h3>
              <p>{description}</p>
              {title === "Intonation" ? (
                <Link className="teal" href="/practice">
                  Open cello pitch analysis →
                </Link>
              ) : (
                <span className="not-implemented">
                  <LockKeyhole size={12} /> Not yet implemented
                </span>
              )}
            </article>
          ))}
      </div>
    </section>
  );
}
