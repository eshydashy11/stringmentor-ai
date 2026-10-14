"use client";

import Link from "next/link";
import {
  ArrowRight,
  ArrowUpRight,
  Disc3,
  ListMusic,
  Music2,
  Leaf,
  AudioLines,
} from "lucide-react";
import { useStudio } from "@/components/studio-provider";
import { UploadButton, Player } from "@/components/player";
import { AnalysisCards } from "@/components/analysis-cards";
import { trackTitle } from "@/lib/audio";

export default function Dashboard() {
  const studio = useStudio();
  return (
    <>
      <div className="page-title">
        <div>
          <div className="eyebrow muted">A SPACE TO GROW</div>
          <h1>
            Welcome to your studio<span className="teal">.</span>
          </h1>
          <p>One note, one session, one step forward.</p>
        </div>
        <span className="version-badge">
          FIRST EDITION <span>v0.1</span>
        </span>
      </div>
      <section className="hero">
        <div className="hero-copy">
          <span className="hero-kicker">
            <span className="tiny-dot" /> YOUR MUSIC. YOUR PACE.
          </span>
          <h2>
            Great music begins
            <br />
            with a little practice.
          </h2>
          <p>
            Your personal space to listen closely, build confidence,
            <br className="desktop-break" /> and fall in love with the process.
          </p>
          <div className="hero-actions">
            <Link className="button primary" href="/practice">
              Enter Practice Studio <ArrowRight size={17} />
            </Link>
            <UploadButton secondary />
          </div>
          <span className="hero-footnote">
            <Leaf size={14} /> A thoughtful companion for your musical journey
          </span>
        </div>
        <div
          className="hero-art"
          role="img"
          aria-label="Illustration of a cello in a softly lit music studio"
        >
          <div className="art-rings" />
          <div className="art-staff" />
          <svg viewBox="0 0 280 420" aria-hidden="true">
            <defs>
              <linearGradient id="wood" x1="0" x2="1">
                <stop stopColor="#4e2c1c" />
                <stop offset=".25" stopColor="#b78652" />
                <stop offset=".55" stopColor="#cfab70" />
                <stop offset=".8" stopColor="#875837" />
                <stop offset="1" stopColor="#4b2b1d" />
              </linearGradient>
              <linearGradient id="neck" x1="0" x2="1">
                <stop stopColor="#1c1713" />
                <stop offset=".6" stopColor="#534137" />
                <stop offset="1" stopColor="#161716" />
              </linearGradient>
              <filter id="shadow">
                <feDropShadow
                  dx="7"
                  dy="12"
                  stdDeviation="9"
                  floodOpacity=".6"
                />
              </filter>
            </defs>
            <g transform="rotate(12 140 220)" filter="url(#shadow)">
              <path d="M141 357v56" stroke="#827b6b" strokeWidth="3" />
              <path
                d="M117 139C95 133 67 147 66 175C65 197 84 204 85 216C85 230 57 230 52 262C44 315 84 357 140 357C199 357 235 315 228 262C224 230 195 230 195 216C195 204 217 197 215 175C214 147 185 133 163 139Z"
                fill="url(#wood)"
                stroke="#dbb578"
                strokeWidth="2"
              />
              <path
                d="M117 144C95 137 73 152 72 176C71 196 91 204 91 216C91 235 65 237 59 263C53 307 84 349 140 349C193 349 227 311 220 263C216 237 189 235 189 216C189 204 210 195 209 176C207 152 184 137 163 144"
                fill="none"
                stroke="#493522"
                strokeWidth="1.8"
              />
              <path
                d="M131 68L126 233Q140 241 153 233L147 68Z"
                fill="url(#neck)"
              />
              <path
                d="M133 78L129 34Q123 13 139 11Q158 13 150 28L147 78Z"
                fill="#9c7148"
                stroke="#d1a16b"
                strokeWidth="1"
              />
              <path
                d="M136 20q-2-10 8-4q6 5-1 9"
                fill="none"
                stroke="#483122"
                strokeWidth="3"
              />
              <path
                d="M124 39h-10m10 14h-10m40-6h11m-11 14h11"
                stroke="#3b3026"
                strokeWidth="6"
                strokeLinecap="round"
              />
              <path
                d="M107 237q-13 4-11 18q6 15-4 25m-1-32q-7 0-3-7m8 39q7 3 9-4M174 237q13 4 11 18q-6 15 4 25m1-32q7 0 3-7m-8 39q-7 3-9-4"
                fill="none"
                stroke="#29241c"
                strokeWidth="3.5"
                strokeLinecap="round"
              />
              <path
                d="M122 263q18-9 36 0l-4 13h-28z"
                fill="#dfc68a"
                stroke="#61492f"
              />
              <path d="M128 319h24l-8 25h-9z" fill="#29251f" />
              <g stroke="#d7d0ae" strokeWidth=".7" opacity=".9">
                <path d="M134 53L131 320M138 53l-1 267M142 53l1 267M146 53l3 267" />
              </g>
              <path
                d="M75 175q-9 17 13 29M64 273q-2 43 48 67"
                fill="none"
                stroke="#f7deab"
                strokeWidth="2"
                opacity=".45"
              />
            </g>
            <path d="M239 68L185 376" stroke="#b08956" strokeWidth="3" />
            <path d="M242 68L188 376" stroke="#e7d9ba" strokeWidth="1" />
          </svg>
          <span className="art-caption">FIND YOUR RESONANCE</span>
        </div>
      </section>
      <div className="stat-grid">
        <Link href="/recordings" className="stat-card panel">
          <span className="stat-icon">
            <Disc3 size={21} />
          </span>
          <div>
            <span>Your recordings</span>
            <strong>
              {studio.ready
                ? String(studio.recordings.length).padStart(2, "0")
                : "—"}
              <small>in your library</small>
            </strong>
          </div>
          <ArrowUpRight size={17} />
        </Link>
        <Link href="/playlists" className="stat-card panel">
          <span className="stat-icon">
            <ListMusic size={21} />
          </span>
          <div>
            <span>Practice playlists</span>
            <strong>
              {studio.ready
                ? String(studio.playlists.length).padStart(2, "0")
                : "—"}
              <small>made by you</small>
            </strong>
          </div>
          <ArrowUpRight size={17} />
        </Link>
        <Link href="/settings" className="stat-card panel">
          <span className="stat-icon">
            <Music2 size={21} />
          </span>
          <div>
            <span>Your instrument</span>
            <strong className="instrument-stat">
              {studio.instrument === "cello" ? "Cello" : "Violin"}
              <small>your voice, in strings</small>
            </strong>
          </div>
          <ArrowUpRight size={17} />
        </Link>
      </div>
      <div className="dashboard-lower">
        <div>
          <div className="section-heading">
            <h2>Pick up where you are</h2>
            <Link href="/practice">
              Open studio <ArrowUpRight size={14} />
            </Link>
          </div>
          <Player />
        </div>
        <aside className="practice-aside">
          <div className="section-heading">
            <h2>Your practice, simplified</h2>
          </div>
          <div className="panel getting-started">
            <span className="eyebrow muted">A GOOD PLACE TO START</span>
            {[
              {
                number: "01",
                title: "Bring your music",
                text: "Upload a recording or a practice track.",
              },
              {
                number: "02",
                title: "Listen with intention",
                text: "Play, pause, and revisit the details.",
              },
              {
                number: "03",
                title: "Make it your own",
                text: "Collect your tracks into a practice playlist.",
              },
            ].map((step) => (
              <div className="practice-step" key={step.number}>
                <span>{step.number}</span>
                <div>
                  <h3>{step.title}</h3>
                  <p>{step.text}</p>
                </div>
              </div>
            ))}
            <div className="privacy-note">
              <Leaf size={16} />
              <p>
                Your recordings stay in this browser.
                <br />
                Your music is yours.
              </p>
            </div>
          </div>
          <div className="recent-mini">
            <AudioLines size={19} />
            <div>
              <strong>
                {studio.recordings.length
                  ? trackTitle(studio.recordings[0].name)
                  : "A fresh start sounds good"}
              </strong>
              <p>
                {studio.recordings.length
                  ? "Your most recently uploaded recording"
                  : "Your library is ready for its first recording."}
              </p>
            </div>
          </div>
        </aside>
      </div>
      <AnalysisCards />
      <div className="page-footnote">
        Made for the practice. And the progress that follows.
        <span>StringMentor AI</span>
      </div>
    </>
  );
}
