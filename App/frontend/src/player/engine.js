// The trial rules of the task engine (R30, R31), free of React and audio so
// they can be tested on their own. The TaskPlayer plays the feedback sound a
// step names and renders the resulting state.

// Fisher–Yates. The importer stores the correct option first, so the player
// shuffles every trial (docs/csv-mapping.md §2).
export function shuffle(list, random = Math.random) {
  const copy = [...list];
  for (let i = copy.length - 1; i > 0; i -= 1) {
    const j = Math.floor(random() * (i + 1));
    [copy[i], copy[j]] = [copy[j], copy[i]];
  }
  return copy;
}

export const DEFAULT_ATTEMPTS = 2;

export function startTrial() {
  return { wrong: [], found: [], solved: null, revealed: [] };
}

export function isFinished(state) {
  return state.solved !== null || state.revealed.length > 0;
}

// The child taps `option`. Returns the next state, the feedback key to play
// (`correct`, `incorrectFirst`, `incorrectSecond` in trial.feedback) and the
// outcome: 'correct' once every correct option is found, 'found' for one of
// several (U: three objects), 'retry' after a wrong tap, or 'failed' once the
// attempts are used up and the remaining correct options are shown. A tap
// that changes nothing returns outcome null.
export function pick(state, option, trial, maxAttempts = DEFAULT_ATTEMPTS) {
  const none = { state, sound: null, outcome: null };
  if (isFinished(state) || state.wrong.includes(option.id) || state.found.includes(option.id)) {
    return none;
  }
  const correctIds = trial.options.filter((o) => o.correct).map((o) => o.id);
  if (option.correct) {
    const found = [...state.found, option.id];
    if (found.length < correctIds.length) {
      return { state: { ...state, found }, sound: 'correct', outcome: 'found' };
    }
    return { state: { ...state, found, solved: option.id }, sound: 'correct', outcome: 'correct' };
  }
  const wrong = [...state.wrong, option.id];
  if (wrong.length < maxAttempts) {
    return { state: { ...state, wrong }, sound: 'incorrectFirst', outcome: 'retry' };
  }
  const revealed = correctIds.filter((id) => !state.found.includes(id));
  return { state: { ...state, wrong, revealed }, sound: 'incorrectSecond', outcome: 'failed' };
}

// R35: the state of each trial rebuilt from the taps the server recorded,
// in the order they were made. Taps on unknown trials or options are ignored.
export function resumeStates(trials, taps, maxAttempts = DEFAULT_ATTEMPTS) {
  const states = new Map();
  for (const tap of taps) {
    const trial = trials.find((t) => t.id === tap.trialId);
    const option = trial?.options.find((o) => o.id === tap.optionId);
    if (!option) continue;
    states.set(
      trial.id,
      pick(states.get(trial.id) || startTrial(), option, trial, maxAttempts).state
    );
  }
  return states;
}

// Where a resumed task continues: at the first unfinished question, together
// with the screens just before it (the story leading up to it). With every
// question answered, trials.length (straight to the goodbye); with nothing
// answered yet, the start.
export function resumeIndex(trials, states) {
  const open = trials.findIndex(
    (t) => t.kind === 'question' && !isFinished(states.get(t.id) || startTrial())
  );
  if (open === -1) return states.size > 0 ? trials.length : 0;
  let start = open;
  while (start > 0 && trials[start - 1].kind !== 'question') start -= 1;
  return start;
}
