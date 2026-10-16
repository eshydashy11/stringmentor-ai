import "fake-indexeddb/auto";
import { test } from "node:test";
import assert from "node:assert/strict";
import { recordingFile } from "../src/lib/microphone.ts";
import {
  saveRecording,
  loadRecordings,
  deleteRecording,
  savePreferences,
  loadPreferences,
} from "../src/lib/storage.ts";

test("microphone files round-trip through existing IndexedDB storage and playlist IDs", async () => {
  const file = recordingFile(
    new Blob(["captured AAC"], { type: "audio/mp4" }),
    "violin",
    new Date(),
  );
  const id = crypto.randomUUID();
  await saveRecording({
    id,
    name: file.name,
    file,
    size: file.size,
    addedAt: Date.now(),
    instrument: "violin",
  });
  await savePreferences({
    instrument: "cello",
    volume: 0.6,
    notes: "Keep existing notes",
    playlists: [{ id: "practice-list", name: "Warm-up", trackIds: [id] }],
  });
  const saved = (await loadRecordings()).find((track) => track.id === id)!;
  assert.equal(saved.name, file.name);
  assert.equal(saved.instrument, "violin");
  assert.equal(saved.file.type, "audio/mp4");
  assert.equal(await saved.file.text(), "captured AAC");
  const preferences = await loadPreferences();
  assert.deepEqual(preferences?.playlists[0].trackIds, [saved.id]);
  assert.equal(preferences?.notes, "Keep existing notes");
  await deleteRecording(id);
  assert.ok(!(await loadRecordings()).some((track) => track.id === id));
});
