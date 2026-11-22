import { apiRequest } from '../api/client.js';

// Sends every tap to the server as it happens, in order (R33). A send that
// fails on the network or the server is retried with a growing pause, so a
// short drop loses nothing (NFR20); a refused tap (4xx, e.g. "already
// answered") is dropped, since the server's record already decides. flush()
// resolves once everything queued is stored, and rejects if it can't be.
const RETRIES = 4;

const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const refused = (err) => err.status >= 400 && err.status < 500;

export function createRecorder(token, send = (body) => post(body, token)) {
  const queue = [];
  let running = null;

  async function sendWithRetry(item) {
    for (let attempt = 0; ; attempt += 1) {
      try {
        return await send(item);
      } catch (err) {
        if (refused(err) || attempt >= RETRIES) throw err;
        await wait(500 * 2 ** attempt);
      }
    }
  }

  async function run() {
    while (queue.length > 0) {
      try {
        await sendWithRetry(queue[0]);
      } catch (err) {
        if (!refused(err)) throw err;
      }
      queue.shift();
    }
  }

  function pump() {
    if (!running) running = run().finally(() => (running = null));
    return running;
  }

  return {
    record(item) {
      queue.push(item);
      pump().catch(() => {}); // flush() reports the failure
    },
    flush() {
      return queue.length > 0 ? pump() : running || Promise.resolve();
    },
  };
}

function post(body, token) {
  return apiRequest('/responses', { method: 'POST', body, token });
}
