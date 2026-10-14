export type Recording = {
  id: string;
  name: string;
  file: Blob;
  size: number;
  addedAt: number;
  instrument: "cello" | "violin";
};
export type Playlist = { id: string; name: string; trackIds: string[] };
let database: Promise<IDBDatabase> | undefined;
function getDatabase(): Promise<IDBDatabase> {
  if (!database)
    database = new Promise((resolve, reject) => {
      const request = indexedDB.open("stringmentor-studio", 1);
      request.onupgradeneeded = () => {
        request.result.createObjectStore("recordings", { keyPath: "id" });
        request.result.createObjectStore("preferences");
      };
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => {
        database = undefined;
        reject(request.error);
      };
      request.onblocked = () => {
        database = undefined;
        reject(new Error("Browser storage is blocked by another tab."));
      };
    });
  return database;
}
async function transact<T>(
  store: string,
  mode: IDBTransactionMode,
  action: (store: IDBObjectStore) => IDBRequest<T>,
): Promise<T> {
  const db = await getDatabase();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(store, mode);
    const request = action(tx.objectStore(store));
    tx.oncomplete = () => resolve(request.result);
    tx.onerror = () => reject(tx.error);
    tx.onabort = () => reject(tx.error);
  });
}
export const loadRecordings = () =>
  transact<Recording[]>("recordings", "readonly", (store) => store.getAll());
export const saveRecording = (recording: Recording) =>
  transact("recordings", "readwrite", (store) => store.put(recording));
export const deleteRecording = (id: string) =>
  transact("recordings", "readwrite", (store) => store.delete(id));
export type Preferences = {
  instrument: "cello" | "violin";
  volume: number;
  playlists: Playlist[];
  notes: string;
};
export const loadPreferences = () =>
  transact<Preferences | undefined>("preferences", "readonly", (store) =>
    store.get("settings"),
  );
export const savePreferences = (preferences: Preferences) =>
  transact("preferences", "readwrite", (store) =>
    store.put(preferences, "settings"),
  );
