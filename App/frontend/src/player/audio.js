// One shared audio element for every sound in the player. iPad Safari only
// lets an element play after it has played once inside a user gesture, so
// the start gate calls unlockAudio() from its tap handler; every later
// playAudio() reuses that unlocked element.

let element = null;
let unlocked = false;
let finishCurrent = null;

function audioElement() {
  if (!element) {
    element = new Audio();
    element.preload = 'auto';
  }
  return element;
}

// 50 ms of 8-bit mono silence as a WAV object URL.
let silenceUrl = null;
function silence() {
  if (silenceUrl) return silenceUrl;
  const samples = 400;
  const buffer = new ArrayBuffer(44 + samples);
  const view = new DataView(buffer);
  const text = (offset, s) => [...s].forEach((c, i) => view.setUint8(offset + i, c.charCodeAt(0)));
  text(0, 'RIFF');
  view.setUint32(4, 36 + samples, true);
  text(8, 'WAVEfmt ');
  view.setUint32(16, 16, true);
  view.setUint16(20, 1, true); // PCM
  view.setUint16(22, 1, true); // mono
  view.setUint32(24, 8000, true);
  view.setUint32(28, 8000, true);
  view.setUint16(32, 1, true);
  view.setUint16(34, 8, true);
  text(36, 'data');
  view.setUint32(40, samples, true);
  for (let i = 0; i < samples; i += 1) view.setUint8(44 + i, 128);
  silenceUrl = URL.createObjectURL(new Blob([buffer], { type: 'audio/wav' }));
  return silenceUrl;
}

export function isAudioUnlocked() {
  return unlocked;
}

// Call synchronously from a tap/click handler.
export function unlockAudio() {
  const audio = audioElement();
  audio.src = silence();
  const played = audio.play();
  unlocked = true;
  return played ? played.catch(() => {}) : Promise.resolve();
}

// Plays one sound, stopping any other. Resolves when it ends, fails or is
// stopped, so callers can simply await it. A missing url resolves at once.
export function playAudio(url) {
  stopAudio();
  if (!url) return Promise.resolve();
  const audio = audioElement();
  return new Promise((resolve) => {
    const finish = () => {
      if (finishCurrent !== finish) return;
      finishCurrent = null;
      audio.onended = null;
      audio.onerror = null;
      resolve();
    };
    finishCurrent = finish;
    audio.onended = finish;
    audio.onerror = finish;
    audio.src = url;
    const played = audio.play();
    if (played) played.catch(finish);
  });
}

export function stopAudio() {
  if (!element) return;
  element.pause();
  if (finishCurrent) finishCurrent();
}
