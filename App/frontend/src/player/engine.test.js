import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { isFinished, pick, resumeIndex, resumeStates, shuffle, startTrial } from './engine.js';

// R30, R31: the rules for one tap on an answer option.
const trial = {
  options: [{ id: 'o1', correct: true }, { id: 'o2' }, { id: 'o3' }, { id: 'o4' }],
};
const [right, wrong1, wrong2, wrong3] = trial.options;

describe('pick', () => {
  it('a correct first tap solves the trial with the correct sound', () => {
    const step = pick(startTrial(), right, trial);
    assert.equal(step.outcome, 'correct');
    assert.equal(step.sound, 'correct');
    assert.equal(step.state.solved, 'o1');
    assert.ok(isFinished(step.state));
  });

  it('a first wrong tap allows another try', () => {
    const step = pick(startTrial(), wrong1, trial);
    assert.equal(step.outcome, 'retry');
    assert.equal(step.sound, 'incorrectFirst');
    assert.deepEqual(step.state.wrong, ['o2']);
    assert.ok(!isFinished(step.state));
  });

  it('correct on the second try still solves it', () => {
    const first = pick(startTrial(), wrong1, trial);
    const second = pick(first.state, right, trial);
    assert.equal(second.outcome, 'correct');
    assert.deepEqual(second.state.wrong, ['o2']);
  });

  it('a second wrong tap shows the answer and ends the trial', () => {
    const first = pick(startTrial(), wrong1, trial);
    const second = pick(first.state, wrong2, trial);
    assert.equal(second.outcome, 'failed');
    assert.equal(second.sound, 'incorrectSecond');
    assert.deepEqual(second.state.revealed, ['o1']);
    assert.ok(isFinished(second.state));
  });

  it('follows attemptsPerTrial', () => {
    let state = startTrial();
    state = pick(state, wrong1, trial, 3).state;
    const second = pick(state, wrong2, trial, 3);
    assert.equal(second.outcome, 'retry');
    assert.equal(pick(second.state, wrong3, trial, 3).outcome, 'failed');
    assert.equal(pick(startTrial(), wrong1, trial, 1).outcome, 'failed');
  });

  it('ignores a repeated wrong tap and any tap after the end', () => {
    const first = pick(startTrial(), wrong1, trial);
    const again = pick(first.state, wrong1, trial);
    assert.equal(again.outcome, null);
    assert.equal(again.state, first.state);

    const solved = pick(startTrial(), right, trial).state;
    assert.equal(pick(solved, wrong1, trial).outcome, null);
  });
});

describe('pick with several correct options (U)', () => {
  const suitcase = {
    options: [
      { id: 'o1', correct: true },
      { id: 'o2', correct: true },
      { id: 'o3', correct: true },
      { id: 'o4' },
      { id: 'o5' },
    ],
  };
  const [a, b, c, d, e] = suitcase.options;

  it('needs every correct option, each tap plays the correct sound', () => {
    let step = pick(startTrial(), a, suitcase);
    assert.equal(step.outcome, 'found');
    assert.equal(step.sound, 'correct');
    step = pick(step.state, c, suitcase);
    assert.equal(step.outcome, 'found');
    assert.equal(pick(step.state, a, suitcase).outcome, null); // already in the suitcase
    step = pick(step.state, b, suitcase);
    assert.equal(step.outcome, 'correct');
    assert.deepEqual(step.state.found, ['o1', 'o3', 'o2']);
  });

  it('after the tries are used up, shows only the objects not yet found', () => {
    let state = pick(startTrial(), a, suitcase).state;
    state = pick(state, d, suitcase).state;
    const step = pick(state, e, suitcase);
    assert.equal(step.outcome, 'failed');
    assert.deepEqual(step.state.revealed, ['o2', 'o3']);
  });
});

describe('resume (R35)', () => {
  const q = (id) => ({ id, kind: 'question', options: trial.options });
  const screen = (id) => ({ id, kind: 'screen', options: [] });
  const trials = [screen(1), q(2), screen(3), screen(4), q(5)];

  it('rebuilds each trial from the recorded taps', () => {
    const states = resumeStates(trials, [
      { trialId: 2, optionId: 'o2' },
      { trialId: 2, optionId: 'o1' },
      { trialId: 5, optionId: 'o3' },
      { trialId: 9, optionId: 'o1' },
    ]);
    assert.equal(states.get(2).solved, 'o1');
    assert.deepEqual(states.get(5).wrong, ['o3']);
    assert.ok(!states.has(9));
  });

  it('continues at the first open question, with the screens before it', () => {
    assert.equal(resumeIndex(trials, new Map()), 0);
    const afterFirst = resumeStates(trials, [{ trialId: 2, optionId: 'o1' }]);
    assert.equal(resumeIndex(trials, afterFirst), 2);
    const midSecond = resumeStates(trials, [
      { trialId: 2, optionId: 'o1' },
      { trialId: 5, optionId: 'o2' },
    ]);
    assert.equal(resumeIndex(trials, midSecond), 2);
    const all = resumeStates(trials, [
      { trialId: 2, optionId: 'o1' },
      { trialId: 5, optionId: 'o1' },
    ]);
    assert.equal(resumeIndex(trials, all), trials.length);
    assert.equal(resumeIndex([screen(1), screen(2)], new Map()), 0);
  });
});

describe('shuffle', () => {
  it('keeps every option and leaves the input alone', () => {
    const input = [1, 2, 3, 4];
    const out = shuffle(input, () => 0);
    assert.deepEqual([...out].sort(), input);
    assert.deepEqual(input, [1, 2, 3, 4]);
    assert.notDeepEqual(out, input);
  });
});
