"use client";
import { useState } from "react";
import { ListMusic, Plus, Trash2, Music2, Play, X } from "lucide-react";
import { useStudio } from "@/components/studio-provider";
import { trackTitle } from "@/lib/audio";
export default function Playlists() {
  const studio = useStudio();
  const [name, setName] = useState("");
  function create(event: React.FormEvent) {
    event.preventDefault();
    const title = name.trim();
    if (!title) return;
    studio.setPlaylists([
      ...studio.playlists,
      { id: crypto.randomUUID(), name: title, trackIds: [] },
    ]);
    setName("");
  }
  return (
    <>
      <div className="page-title">
        <div>
          <div className="eyebrow muted">A ROUTINE THAT’S YOURS</div>
          <h1>
            Playlists<span className="teal">.</span>
          </h1>
          <p>Gather the music you want to return to.</p>
        </div>
      </div>
      <form className="panel playlist-form" onSubmit={create}>
        <label htmlFor="playlist-name">Create a practice playlist</label>
        <div>
          <input
            id="playlist-name"
            value={name}
            onChange={(event) => setName(event.target.value)}
            placeholder="e.g. Slow scales & warm-ups"
            maxLength={80}
            required
            disabled={!studio.ready}
          />
          <button
            className="button primary"
            disabled={!studio.ready || !name.trim()}
          >
            <Plus size={17} />
            Create playlist
          </button>
        </div>
      </form>
      {!studio.ready ? (
        <p className="loading-text">Opening your playlists…</p>
      ) : !studio.playlists.length ? (
        <section className="panel empty-state">
          <span className="empty-icon">
            <ListMusic size={38} strokeWidth={1.2} />
          </span>
          <h2>A little structure. A lot of possibility.</h2>
          <p>
            Create a playlist above, then add audio from your recording library.
          </p>
        </section>
      ) : (
        <div className="playlist-grid">
          {studio.playlists.map((list) => (
            <section className="panel playlist-card" key={list.id}>
              <div className="panel-heading">
                <div className="playlist-heading">
                  <span className="feature-icon">
                    <ListMusic size={21} />
                  </span>
                  <div>
                    <h2>{list.name}</h2>
                    <small>{list.trackIds.length} tracks</small>
                  </div>
                </div>
                <button
                  className="icon-button delete-button"
                  aria-label={`Delete playlist ${list.name}`}
                  onClick={() =>
                    studio.setPlaylists(
                      studio.playlists.filter((item) => item.id !== list.id),
                    )
                  }
                >
                  <Trash2 size={17} />
                </button>
              </div>
              <label className="sr-only" htmlFor={`add-${list.id}`}>
                Add a recording to {list.name}
              </label>
              <select
                id={`add-${list.id}`}
                className="track-select"
                value=""
                onChange={(event) => {
                  if (event.target.value)
                    studio.setPlaylists(
                      studio.playlists.map((item) =>
                        item.id === list.id
                          ? {
                              ...item,
                              trackIds: [...item.trackIds, event.target.value],
                            }
                          : item,
                      ),
                    );
                }}
              >
                <option value="">
                  {studio.recordings.length
                    ? "+ Add a recording"
                    : "Upload audio in Recordings first"}
                </option>
                {studio.recordings
                  .filter((track) => !list.trackIds.includes(track.id))
                  .map((track) => (
                    <option key={track.id} value={track.id}>
                      {trackTitle(track.name)}
                    </option>
                  ))}
              </select>
              {!list.trackIds.length && (
                <p className="playlist-empty">
                  A fresh playlist, ready for your music.
                </p>
              )}
              {list.trackIds.map((id) => {
                const track = studio.recordings.find((item) => item.id === id);
                if (!track) return null;
                return (
                  <div className="playlist-track" key={id}>
                    <Music2 size={17} />
                    <strong>{trackTitle(track.name)}</strong>
                    <button
                      className="icon-button"
                      aria-label={`Load ${track.name}`}
                      onClick={() => studio.select(track)}
                    >
                      <Play size={16} />
                    </button>
                    <button
                      className="icon-button"
                      aria-label={`Remove ${track.name} from ${list.name}`}
                      onClick={() =>
                        studio.setPlaylists(
                          studio.playlists.map((item) =>
                            item.id === list.id
                              ? {
                                  ...item,
                                  trackIds: item.trackIds.filter(
                                    (trackId) => trackId !== id,
                                  ),
                                }
                              : item,
                          ),
                        )
                      }
                    >
                      <X size={16} />
                    </button>
                  </div>
                );
              })}
            </section>
          ))}
        </div>
      )}
    </>
  );
}
