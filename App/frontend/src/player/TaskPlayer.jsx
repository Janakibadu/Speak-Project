import { useCallback, useEffect, useRef, useState } from 'react';
import StudentTopBar from '../components/StudentTopBar.jsx';
import { useI18n } from '../i18n/I18nContext.jsx';
import { playAudio, stopAudio } from './audio.js';
import { DEFAULT_ATTEMPTS, pick, startTrial } from './engine.js';
import { ChoiceView, ExampleView, screenViewFor } from './views.jsx';
import SuitcaseView from './SuitcaseView.jsx';

// How long an answer stays marked before the next question: the right one
// briefly (its sound may be missing, client question 12), the revealed one
// after the tries are used up a little longer.
const PAUSE_MS = { correct: 600, failed: 1500 };

const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

// Played once a question is over, right or revealed: the whole sentence the
// answer completes (V_3: whole_sentence, H_X4: full_and_correct_sentence).
const ANSWER_AUDIO = ['sentenceAudio', 'fullSentenceAudio'];

// Formats whose view runs its own opening sounds (U: objects appear in the
// suitcase while their description plays, Skript W10_G2), and where a tapped
// object says its name before the feedback.
const OWN_SOUNDS = new Set(['U']);

// The generic task engine (D-04, NFR21): intro → trials → goodbye. It owns
// the trial loop and all sound; the views only draw and report taps. Every
// format runs through this one loop, because every trial is stimulus +
// options + correct option + feedback media (Design §3.2). The rules for a
// tap (R30, R31) live in engine.js; each counted tap is handed to onAnswer,
// which records it (R33). A resumed task starts at `initialIndex` with the
// trial states rebuilt from the recorded taps (R35).
export default function TaskPlayer({
  task,
  resolve,
  title,
  backTo,
  initialIndex = 0,
  initialStates = new Map(),
  onAnswer,
  onDone,
}) {
  const { t } = useI18n();
  const stateAt = (i) => initialStates.get(task.trials[i]?.id) || startTrial();
  const [phase, setPhase] = useState(() =>
    initialIndex === 0 ? 'intro' : initialIndex < task.trials.length ? 'trial' : 'outro'
  ); // intro | trial | outro
  const [index, setIndex] = useState(() => Math.min(initialIndex, task.trials.length - 1));
  const [trialState, setTrialState] = useState(() => stateAt(initialIndex));
  const alive = useRef(true);

  const trial = task.trials[index];
  const { config } = task;
  const maxAttempts = task.attemptsPerTrial || DEFAULT_ATTEMPTS;

  // Stop any sound, and any pending step, when the player goes away.
  useEffect(() => {
    alive.current = true;
    return () => {
      alive.current = false;
      stopAudio();
    };
  }, []);

  const ownSounds = OWN_SOUNDS.has(task.format);

  // Each step starts its own sound: instruction, trial stimulus, goodbye.
  const stepAudio =
    phase === 'intro'
      ? config.explanation_audio
      : phase === 'outro'
        ? config.goodbye_audio
        : ownSounds
          ? null
          : trial?.stimulus.audio;
  const replay = useCallback(() => playAudio(resolve(stepAudio)), [resolve, stepAudio]);
  useEffect(() => {
    replay();
  }, [phase, index, replay]);

  function nextTrial() {
    setTrialState(stateAt(index + 1));
    if (index + 1 < task.trials.length) setIndex(index + 1);
    else setPhase('outro');
  }

  async function onPick(option) {
    const step = pick(trialState, option, trial, maxAttempts);
    if (!step.outcome) return;
    setTrialState(step.state);
    onAnswer(trial.id, option.id);
    if (ownSounds) await playAudio(resolve(option.audio));
    await playAudio(resolve(trial.feedback[step.sound]));
    if (step.outcome !== 'correct' && step.outcome !== 'failed') return;
    const answer = ANSWER_AUDIO.map((key) => trial.stimulus[key]).find(Boolean);
    if (answer) await playAudio(resolve(answer));
    await wait(PAUSE_MS[step.outcome]);
    if (alive.current) nextTrial();
  }

  const progress =
    phase === 'intro' ? 0 : phase === 'outro' ? 100 : (index / task.trials.length) * 100;
  const ScreenView = screenViewFor(task.format);

  return (
    <>
      <StudentTopBar title={title} progress={progress} backTo={backTo} />
      <div className="player-stage">
        {phase === 'intro' && (
          <div className="player-card" style={{ textAlign: 'center' }}>
            {resolve(config.explanation_image || config.welcome_image) && (
              <img
                className="player-image"
                src={resolve(config.explanation_image || config.welcome_image)}
                alt=""
              />
            )}
            <div className="player-actions">
              <button
                className="player-sound"
                type="button"
                onClick={replay}
                aria-label={t('player.replay')}
              >
                🔊
              </button>
              <button
                className="btn btn-lg btn-coral"
                type="button"
                onClick={() => setPhase('trial')}
              >
                {t('tasks.next')} ▶
              </button>
            </div>
          </div>
        )}

        {phase === 'trial' && trial.kind === 'question' && ownSounds && (
          <SuitcaseView
            key={trial.id}
            trial={trial}
            config={config}
            resolve={resolve}
            state={trialState}
            onPick={onPick}
          />
        )}

        {phase === 'trial' && trial.kind === 'question' && !ownSounds && (
          <ChoiceView
            key={trial.id}
            trial={trial}
            resolve={resolve}
            state={trialState}
            onPick={onPick}
            onReplay={replay}
          />
        )}

        {phase === 'trial' && trial.kind === 'example' && trial.options.length > 0 && (
          <ExampleView
            key={trial.id}
            trial={trial}
            resolve={resolve}
            onReplay={replay}
            onNext={() => nextTrial()}
          />
        )}

        {phase === 'trial' &&
          trial.kind !== 'question' &&
          !(trial.kind === 'example' && trial.options.length > 0) && (
            <ScreenView
              key={trial.id}
              trial={trial}
              resolve={resolve}
              onReplay={replay}
              onNext={() => nextTrial()}
            />
          )}

        {phase === 'outro' && (
          <div className="player-card" style={{ textAlign: 'center' }}>
            <div style={{ fontSize: 96 }} aria-hidden="true">
              ⭐
            </div>
            <div className="h2" style={{ margin: '10px 0 22px' }}>
              {t('player.taskDone')}
            </div>
            <button className="btn btn-lg btn-mint" type="button" onClick={onDone}>
              {t('tasks.next')} ▶
            </button>
          </div>
        )}
      </div>
    </>
  );
}
