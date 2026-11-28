/* Shared by the foreground client and the push-only Service Worker. */
export async function claimAlert(id, expires, database = globalThis.indexedDB) {
  if (!database) throw new Error("IndexedDB unavailable");
  const db = await new Promise((resolve, reject) => {
    const request = database.open("alpha-radar-alert-dedup", 1);
    request.onupgradeneeded = () => {
      const store = request.result.createObjectStore("seen");
      store.createIndex("expires", "expires");
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
    request.onblocked = () =>
      reject(new Error("Deduplication database blocked"));
  });
  try {
    return await new Promise((resolve, reject) => {
      const transaction = db.transaction("seen", "readwrite");
      const store = transaction.objectStore("seen");
      const old = store
        .index("expires")
        .openCursor(IDBKeyRange.upperBound(Date.now()));
      old.onsuccess = () => {
        const cursor = old.result;
        if (cursor) {
          cursor.delete();
          cursor.continue();
        }
      };
      const claim = store.get(id);
      let fresh = false;
      claim.onsuccess = () => {
        if (claim.result || expires <= Date.now()) return;
        fresh = true;
        store.put({ expires }, id);
      };
      transaction.oncomplete = () => resolve(fresh);
      transaction.onabort = () => reject(transaction.error);
    });
  } finally {
    db.close();
  }
}
