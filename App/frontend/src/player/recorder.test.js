import assert from 'node:assert/strict';
import { describe, it, mock } from 'node:test';
import { setImmediate } from 'node:timers';
import { createRecorder } from './recorder.js';

const error = (status) => Object.assign(new Error('x'), { status });

// R33, NFR20: taps reach the server in order, survive short network drops,
// and a refused tap does not block the ones after it.
describe('recorder', () => {
  it('sends taps in order', async () => {
    const sent = [];
    const recorder = createRecorder(null, async (item) => sent.push(item));
    recorder.record(1);
    recorder.record(2);
    recorder.record(3);
    await recorder.flush();
    assert.deepEqual(sent, [1, 2, 3]);
  });

  it('retries after a network error', async () => {
    mock.timers.enable({ apis: ['setTimeout'] });
    try {
      let calls = 0;
      const recorder = createRecorder(null, async () => {
        calls += 1;
        if (calls < 3) throw error(undefined);
      });
      recorder.record('tap');
      const done = recorder.flush();
      for (let i = 0; i < 5; i += 1) {
        await Promise.resolve();
        mock.timers.tick(2000);
        await new Promise((resolve) => setImmediate(resolve));
      }
      await done;
      assert.equal(calls, 3);
    } finally {
      mock.timers.reset();
    }
  });

  it('drops a refused tap and goes on', async () => {
    const sent = [];
    const recorder = createRecorder(null, async (item) => {
      if (item === 'bad') throw error(409);
      sent.push(item);
    });
    recorder.record('bad');
    recorder.record('good');
    await recorder.flush();
    assert.deepEqual(sent, ['good']);
  });

  it('flush rejects when the server stays unreachable, and can be tried again', async () => {
    mock.timers.enable({ apis: ['setTimeout'] });
    let online = false;
    const sent = [];
    const recorder = createRecorder(null, async (item) => {
      if (!online) throw error(503);
      sent.push(item);
    });
    try {
      recorder.record('tap');
      const first = recorder.flush();
      for (let i = 0; i < 8; i += 1) {
        await Promise.resolve();
        mock.timers.tick(10000);
        await new Promise((resolve) => setImmediate(resolve));
      }
      await assert.rejects(first);
    } finally {
      mock.timers.reset();
    }
    online = true;
    await recorder.flush();
    assert.deepEqual(sent, ['tap']);
  });
});
