const DB_NAME = "mytv-epg";
const DB_VERSION = 1;
const STORE_NAME = "cache";
const PREFS_KEY = "mytv-channel-preferences-v1";

function openDatabase() {
  return new Promise((resolve, reject) => {
    if (!("indexedDB" in window)) {
      reject(new Error("IndexedDB indisponible"));
      return;
    }

    const request = indexedDB.open(DB_NAME, DB_VERSION);
    request.onupgradeneeded = () => {
      const database = request.result;
      if (!database.objectStoreNames.contains(STORE_NAME)) {
        database.createObjectStore(STORE_NAME);
      }
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

export async function getCachedEpg() {
  let database;
  try {
    database = await openDatabase();
    return await new Promise((resolve, reject) => {
      const transaction = database.transaction(STORE_NAME, "readonly");
      const request = transaction.objectStore(STORE_NAME).get("epg");
      request.onsuccess = () => resolve(request.result || null);
      request.onerror = () => reject(request.error);
    });
  } catch (error) {
    console.warn("Cache EPG illisible", error);
    return null;
  } finally {
    database?.close();
  }
}

export async function setCachedEpg(value) {
  let database;
  try {
    database = await openDatabase();
    await new Promise((resolve, reject) => {
      const transaction = database.transaction(STORE_NAME, "readwrite");
      transaction.objectStore(STORE_NAME).put(value, "epg");
      transaction.oncomplete = resolve;
      transaction.onerror = () => reject(transaction.error);
    });
    return true;
  } catch (error) {
    console.warn("Cache EPG non enregistré", error);
    return false;
  } finally {
    database?.close();
  }
}

export function loadChannelPreferences(defaultOrder) {
  try {
    const stored = JSON.parse(localStorage.getItem(PREFS_KEY));
    if (!stored || !Array.isArray(stored.order) || !Array.isArray(stored.hidden)) {
      throw new Error("Préférences invalides");
    }

    const known = new Set(defaultOrder);
    const order = stored.order.filter(id => known.has(id));
    defaultOrder.forEach(id => {
      if (!order.includes(id)) order.push(id);
    });
    return {
      order,
      hidden: stored.hidden.filter(id => known.has(id))
    };
  } catch {
    return { order: [...defaultOrder], hidden: [] };
  }
}

export function saveChannelPreferences(preferences) {
  localStorage.setItem(PREFS_KEY, JSON.stringify(preferences));
}
