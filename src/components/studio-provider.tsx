"use client";

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useRef,
  useState,
} from "react";
import { validateAudio } from "@/lib/audio";
import {
  deleteRecording,
  loadPreferences,
  loadRecordings,
  savePreferences,
  saveRecording,
  type Playlist,
  type Preferences,
  type Recording,
} from "@/lib/storage";

type Studio = {
  recordings: Recording[];
  current: Recording | null;
  playing: boolean;
  duration: number;
  position: number;
  instrument: "cello" | "violin";
  volume: number;
  notes: string;
  playlists: Playlist[];
  ready: boolean;
  uploading: boolean;
  error: string;
  loop: boolean;
  upload: (files: FileList | File[]) => Promise<void>;
  select: (track: Recording) => void;
  toggle: () => Promise<void>;
  seek: (seconds: number) => void;
  replay: () => Promise<void>;
  setInstrument: (value: "cello" | "violin") => void;
  setVolume: (value: number) => void;
  setNotes: (value: string) => void;
  setLoop: (value: boolean) => void;
  remove: (id: string) => Promise<void>;
  setPlaylists: (value: Playlist[]) => void;
  clearError: () => void;
};
const Context = createContext<Studio | null>(null);
const defaults: Preferences = {
  instrument: "cello",
  volume: 0.75,
  playlists: [],
  notes: "",
};

export function StudioProvider({ children }: { children: React.ReactNode }) {
  const [recordings, setRecordings] = useState<Recording[]>([]);
  const [current, setCurrent] = useState<Recording | null>(null);
  const [playing, setPlaying] = useState(false);
  const [duration, setDuration] = useState(0);
  const [position, setPosition] = useState(0);
  const [preferences, setPreferences] = useState<Preferences>(defaults);
  const [ready, setReady] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState("");
  const [loop, setLoop] = useState(false);
  const audioRef = useRef<HTMLAudioElement>(null);
  const sessionOnly = useRef(new Set<string>());

  useEffect(() => {
    let active = true;
    Promise.all([loadRecordings(), loadPreferences()])
      .then(([tracks, prefs]) => {
        if (!active) return;
        setRecordings(tracks.sort((a, b) => b.addedAt - a.addedAt));
        if (prefs) setPreferences({ ...defaults, ...prefs });
        setReady(true);
      })
      .catch(() => {
        if (active) {
          setError(
            "Browser storage is unavailable. Uploaded audio will only be available for this session.",
          );
          setReady(true);
        }
      });
    return () => {
      active = false;
    };
  }, []);

  useEffect(() => {
    if (!ready) return;
    const timer = setTimeout(() => {
      savePreferences(preferences).catch(() =>
        setError("Your settings could not be saved in this browser."),
      );
    }, 350);
    return () => clearTimeout(timer);
  }, [preferences, ready]);

  useEffect(() => {
    const audio = audioRef.current;
    if (!audio) return;
    if (!current) {
      audio.removeAttribute("src");
      audio.load();
      return;
    }
    const url = URL.createObjectURL(current.file);
    audio.src = url;
    audio.load();
    return () => {
      audio.pause();
      audio.removeAttribute("src");
      audio.load();
      URL.revokeObjectURL(url);
    };
  }, [current]);
  useEffect(() => {
    if (audioRef.current) audioRef.current.volume = preferences.volume;
  }, [preferences.volume]);
  useEffect(() => {
    if (audioRef.current) audioRef.current.loop = loop;
  }, [loop]);

  const currentId = current?.id;
  const select = useCallback(
    (track: Recording) => {
      if (track.id === currentId) return;
      setCurrent(track);
      setPlaying(false);
      setPosition(0);
      setDuration(0);
      setError("");
    },
    [currentId],
  );
  async function upload(files: FileList | File[]) {
    setUploading(true);
    setError("");
    const added: Recording[] = [];
    const problems: string[] = [];
    try {
      for (const file of Array.from(files)) {
        const invalid = validateAudio(file);
        if (invalid) {
          problems.push(invalid);
          continue;
        }
        const track: Recording = {
          id: crypto.randomUUID(),
          name: file.name,
          file,
          size: file.size,
          addedAt: Date.now(),
          instrument: preferences.instrument,
        };
        try {
          await saveRecording(track);
        } catch {
          sessionOnly.current.add(track.id);
          problems.push(
            `${file.name} is available for this session, but could not be saved. Browser storage may be full.`,
          );
        }
        added.push(track);
      }
      if (added.length) {
        setRecordings((previous) => [...added, ...previous]);
        select(added[0]);
      }
      setError(problems.join(" "));
    } finally {
      setUploading(false);
    }
  }
  async function play() {
    const audio = audioRef.current;
    if (!audio || !current) return;
    try {
      await audio.play();
      setError("");
    } catch {
      setPlaying(false);
      setError(
        "This file could not be played. Try an MP3 or WAV file supported by your browser.",
      );
    }
  }
  async function toggle() {
    if (playing) audioRef.current?.pause();
    else await play();
  }
  function seek(seconds: number) {
    if (audioRef.current && Number.isFinite(duration) && duration > 0) {
      const value = Math.max(0, Math.min(duration, seconds));
      audioRef.current.currentTime = value;
      setPosition(value);
    }
  }
  async function replay() {
    seek(0);
    await play();
  }
  async function remove(id: string) {
    if (!sessionOnly.current.has(id)) {
      try {
        await deleteRecording(id);
      } catch {
        setError(
          "This recording could not be removed from browser storage. Please try again.",
        );
        return;
      }
    }
    sessionOnly.current.delete(id);
    setRecordings((previous) => previous.filter((track) => track.id !== id));
    setPreferences((previous) => ({
      ...previous,
      playlists: previous.playlists.map((list) => ({
        ...list,
        trackIds: list.trackIds.filter((trackId) => trackId !== id),
      })),
    }));
    if (current?.id === id) {
      setCurrent(null);
      setDuration(0);
      setPosition(0);
      setPlaying(false);
    }
  }
  const patch = (value: Partial<Preferences>) =>
    setPreferences((previous) => ({ ...previous, ...value }));
  return (
    <Context.Provider
      value={{
        recordings,
        current,
        playing,
        duration,
        position,
        ...preferences,
        ready,
        uploading,
        error,
        loop,
        upload,
        select,
        toggle,
        seek,
        replay,
        remove,
        setInstrument: (instrument) => patch({ instrument }),
        setVolume: (volume) => patch({ volume }),
        setNotes: (notes) => patch({ notes }),
        setPlaylists: (playlists) => patch({ playlists }),
        setLoop,
        clearError: () => setError(""),
      }}
    >
      {children}
      <audio
        ref={audioRef}
        preload="metadata"
        onPlay={() => setPlaying(true)}
        onPause={() => setPlaying(false)}
        onEnded={() => setPlaying(false)}
        onLoadedMetadata={(event) => {
          const value = event.currentTarget.duration;
          setDuration(Number.isFinite(value) ? value : 0);
        }}
        onDurationChange={(event) => {
          const value = event.currentTarget.duration;
          setDuration(Number.isFinite(value) ? value : 0);
        }}
        onTimeUpdate={(event) => setPosition(event.currentTarget.currentTime)}
        onError={() => {
          if (audioRef.current?.getAttribute("src")) {
            setPlaying(false);
            setError(
              "Your browser cannot play this audio file. Try MP3 or WAV.",
            );
          }
        }}
      />
    </Context.Provider>
  );
}
export function useStudio() {
  const value = useContext(Context);
  if (!value) throw new Error("StudioProvider is required");
  return value;
}
