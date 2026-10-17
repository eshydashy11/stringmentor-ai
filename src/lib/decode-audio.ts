import { MAX_FILE_SIZE } from "./audio.ts";
import { MAX_ANALYSIS_SECONDS } from "./pitch.ts";

export type DecodedAudio = Pick<
  AudioBuffer,
  "sampleRate" | "duration" | "length" | "numberOfChannels" | "getChannelData"
>;
export type AudioDecoder = {
  decodeAudioData: (bytes: ArrayBuffer) => Promise<DecodedAudio>;
};
/** Decode a copy; neither the persisted Blob nor playback's audio element is changed. */
export async function decodeRecording(
  file: Blob,
  sampleRate: number,
  signal: AbortSignal,
  createDecoder: (rate: number) => AudioDecoder = (rate) =>
    new OfflineAudioContext(1, 1, rate),
): Promise<DecodedAudio> {
  signal.throwIfAborted();
  if (!file.size)
    throw new Error("This recording is empty. Choose another recording.");
  if (file.size > MAX_FILE_SIZE)
    throw new Error("This recording exceeds the 100 MB limit.");
  try {
    const bytes = await file.arrayBuffer();
    signal.throwIfAborted();
    const audio = await createDecoder(sampleRate).decodeAudioData(bytes);
    signal.throwIfAborted();
    if (
      !Number.isFinite(audio.duration) ||
      audio.duration <= 0 ||
      !audio.length ||
      !audio.numberOfChannels
    )
      throw new Error("The recording contains no readable audio samples.");
    if (audio.duration > MAX_ANALYSIS_SECONDS)
      throw new Error(
        "Analysis currently supports recordings up to ten minutes. Choose a shorter recording; the original is unchanged.",
      );
    return audio;
  } catch (error) {
    signal.throwIfAborted();
    if (
      error instanceof Error &&
      (error.message.startsWith("Analysis currently") ||
        error.message.startsWith("The recording contains"))
    )
      throw error;
    throw new Error(
      "This recording could not be decoded for analysis. It may be damaged or use an unsupported codec. Try a WAV or MP3 file.",
    );
  }
}
