"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import {
  AudioLines,
  LayoutDashboard,
  Music2,
  ListMusic,
  Settings2,
  ChevronDown,
  ArrowUpRight,
  X,
  Headphones,
  Disc3,
} from "lucide-react";
import { useStudio } from "./studio-provider";
import { Player } from "./player";

const navigation = [
  { href: "/", name: "Dashboard", icon: LayoutDashboard },
  { href: "/practice", name: "Practice Studio", icon: AudioLines },
  { href: "/recordings", name: "Recordings", icon: Disc3 },
  { href: "/playlists", name: "Playlists", icon: ListMusic },
  { href: "/settings", name: "Settings", icon: Settings2 },
];
export function AppShell({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const studio = useStudio();
  const page =
    navigation.find((item) => item.href === pathname)?.name ?? "Studio";
  return (
    <div className="app-shell">
      <a className="skip-link" href="#main">
        Skip to content
      </a>
      <aside className="sidebar">
        <Link href="/" className="brand" aria-label="StringMentor AI dashboard">
          <span className="brand-icon">
            <AudioLines size={25} />
          </span>
          <span>
            StringMentor<span className="brand-ai">AI</span>
          </span>
        </Link>
        <div className="workspace-label">YOUR PRACTICE SPACE</div>
        <nav aria-label="Main navigation">
          {navigation.map(({ href, name, icon: Icon }) => (
            <Link
              key={href}
              href={href}
              aria-current={pathname === href ? "page" : undefined}
              className={`nav-link ${pathname === href ? "active" : ""}`}
            >
              <Icon size={19} strokeWidth={1.7} />
              <span>{name}</span>
              {pathname === href && <span className="nav-dot" />}
            </Link>
          ))}
        </nav>
        <div className="sidebar-bottom">
          <div className="quiet-card">
            <Headphones size={23} />
            <h3>
              A little practice.
              <br />A little progress.
            </h3>
            <p>Make space for your music.</p>
            <Link href="/practice">
              Find your focus <ArrowUpRight size={15} />
            </Link>
          </div>
          <div className="profile">
            <span className="avatar">
              <Music2 size={19} />
            </span>
            <span>
              My music space<small>Personal studio</small>
            </span>
            <span className="online-dot" />
          </div>
        </div>
      </aside>
      <div className="main-shell">
        <header className="topbar">
          <div className="breadcrumb">
            My workspace <span>/</span> <strong>{page}</strong>
          </div>
          <div className="instrument-picker">
            <span className="instrument-dot" />
            <label htmlFor="instrument">Instrument</label>
            <select
              id="instrument"
              disabled={!studio.ready}
              value={studio.instrument}
              onChange={(event) =>
                studio.setInstrument(event.target.value as "cello" | "violin")
              }
            >
              <option value="cello">Cello</option>
              <option value="violin">Violin</option>
            </select>
            <ChevronDown size={14} aria-hidden="true" />
          </div>
        </header>
        <main id="main" className="main-content">
          {studio.error && (
            <div className="error-banner" role="alert">
              <span>{studio.error}</span>
              <button aria-label="Dismiss message" onClick={studio.clearError}>
                <X size={17} />
              </button>
            </div>
          )}
          {children}
        </main>
        <footer className="player-footer">
          <Player compact />
        </footer>
      </div>
    </div>
  );
}
