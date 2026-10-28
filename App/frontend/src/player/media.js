import http from '../api/client.js';

// Media come only from the authorised controller (NFR13), which needs the
// session token, so <img>/<audio> cannot point at it directly. Each asset is
// fetched once as a blob and played from an object URL. That is also the
// preload (NFR19): once a task's assets are here, it runs without the network.

const cache = new Map(); // assetId → Promise<object URL>
const ready = new Map(); // assetId → object URL, once loaded

function load(id, token) {
  if (!cache.has(id)) {
    const promise = http
      .get(`/media/${id}`, {
        responseType: 'blob',
        headers: { Authorization: `Bearer ${token}` },
      })
      .then((res) => {
        const url = URL.createObjectURL(res.data);
        ready.set(id, url);
        return url;
      })
      .catch((err) => {
        cache.delete(id); // let a later retry try again
        throw err;
      });
    cache.set(id, promise);
  }
  return cache.get(id);
}

// The object URL of an asset that has already been loaded, else null.
export function loadedUrl(id) {
  return ready.get(id) || null;
}

// Loads every asset, a few at a time. Resolves with the ids that failed
// (after one retry each); onProgress(done, total) reports each finished file.
export async function preload(ids, token, onProgress = () => {}) {
  const queue = [...new Set(ids)];
  const total = queue.length;
  const failed = [];
  let done = 0;
  onProgress(done, total);

  async function worker() {
    while (queue.length > 0) {
      const id = queue.shift();
      try {
        await load(id, token).catch(() => load(id, token));
      } catch {
        failed.push(id);
      }
      done += 1;
      onProgress(done, total);
    }
  }
  await Promise.all(Array.from({ length: Math.min(6, total) }, worker));
  return failed;
}

// Frees every object URL (on logout, so a shared iPad starts clean).
export function clearMedia() {
  for (const url of ready.values()) URL.revokeObjectURL(url);
  ready.clear();
  cache.clear();
}

// Every media file a task refers to: any string in its config or trials that
// names a file of this version. Text values ("der", "Hund") don't match.
export function taskAssetIds(task, media) {
  const ids = [];
  const visit = (value) => {
    if (typeof value === 'string') {
      if (media[value]) ids.push(media[value].id);
    } else if (Array.isArray(value)) {
      value.forEach(visit);
    } else if (value && typeof value === 'object') {
      Object.values(value).forEach(visit);
    }
  };
  visit(task.config);
  task.trials.forEach((trial) => visit([trial.stimulus, trial.options, trial.feedback]));
  return [...new Set(ids)];
}
