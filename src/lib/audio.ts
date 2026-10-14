export const MAX_FILE_SIZE = 100 * 1024 * 1024;
const AUDIO_EXTENSION = /\.(mp3|wav|ogg|oga|m4a|aac|flac|webm|opus)$/i;
export function validateAudio(file: {
  name: string;
  type: string;
  size: number;
}): string | null {
  if (file.size === 0) return `${file.name} is empty.`;
  if (file.size > MAX_FILE_SIZE)
    return `${file.name} exceeds the 100 MB limit.`;
  if (
    !file.type.startsWith("audio/") &&
    !(
      AUDIO_EXTENSION.test(file.name) &&
      (!file.type || file.type === "application/octet-stream")
    )
  )
    return `${file.name} is not a supported audio file.`;
  return null;
}
export function formatTime(seconds: number): string {
  if (!Number.isFinite(seconds) || seconds < 0) return "0:00";
  const total = Math.floor(seconds);
  return `${Math.floor(total / 60)}:${String(total % 60).padStart(2, "0")}`;
}
export function trackTitle(name: string): string {
  return name.replace(/\.[^.]+$/, "").replace(/[_-]/g, " ");
}
