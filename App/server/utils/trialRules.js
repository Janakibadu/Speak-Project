// The engine's rules on the server (Design §5.3): the same two-attempt rule
// the player applies (frontend/src/player/engine.js), so every recorded
// response is judged here and the score can't be set by the client (R34).

const DEFAULT_ATTEMPTS = 2;

// The correct option ids of a trial ("o1" or "o1,o2,o3").
function correctIds(trial) {
  return (trial.correct_option || '').split(',').filter(Boolean);
}

// The state of one question after its recorded taps, in order:
// solved once every correct option was tapped, failed once the wrong taps
// reach the tries allowed.
function trialState(trial, taps, maxAttempts = DEFAULT_ATTEMPTS) {
  const correct = correctIds(trial);
  const found = new Set(taps.filter((t) => correct.includes(t.optionId)).map((t) => t.optionId));
  const wrongTaps = taps.filter((t) => !correct.includes(t.optionId)).length;
  const solved = correct.length > 0 && correct.every((id) => found.has(id));
  const failed = !solved && wrongTaps >= maxAttempts;
  return { solved, failed, finished: solved || failed, wrongTaps };
}

// R34: score = share of questions answered correctly within the tries;
// first-try score = share solved without a wrong tap; mistakes = every wrong
// tap (R32, as the SRS words it). Null scores for a task without questions.
function scoreTask(questions, tapsByTrial, maxAttempts = DEFAULT_ATTEMPTS) {
  let solved = 0;
  let firstTry = 0;
  let mistakes = 0;
  for (const trial of questions) {
    const state = trialState(trial, tapsByTrial.get(trial.id) || [], maxAttempts);
    if (state.solved) solved += 1;
    if (state.solved && state.wrongTaps === 0) firstTry += 1;
    mistakes += state.wrongTaps;
  }
  const percent = (n) => (questions.length ? Math.round((100 * n) / questions.length) : null);
  return { score: percent(solved), firstTryScore: percent(firstTry), mistakes };
}

module.exports = { DEFAULT_ATTEMPTS, correctIds, trialState, scoreTask };
