import { useCallback, useEffect, useState } from 'react';
import StudentTopBar from '../components/StudentTopBar.jsx';
import { useI18n } from '../i18n/I18nContext.jsx';
import { playAudio, stopAudio } from './audio.js';
import { ChoiceView, ScreenView } from './views.jsx';

// The generic task engine (D-04, NFR21), part 1: intro → trials → goodbye.
// It owns the trial loop and all sound; the views only draw and report taps.
// Every format runs through this one loop, because every trial is stimulus +
// options + correct option + feedback media (Design §3.2).
//
// Not yet (W6–W9): the two-attempt rule with 1st/2nd-try feedback, posting
// responses, adaption, and the special modes for A (story) and U (memory).
// Until then a wrong answer can simply be tried again.
export default function TaskPlayer({ task, resolve, title, backTo, onDone }) {
  const { t } = useI18n();
  const [phase, setPhase] = useState('intro'); // intro | trial | outro
  const [index, setIndex] = useState(0);
  const [wrong, setWrong] = useState([]);
  const [solved, setSolved] = useState(null);

  const trial = task.trials[index];
  const { config } = task;

  // Stop any sound when the player goes away.
  useEffect(() => stopAudio, []);

  // Each step starts its own sound: instruction, trial stimulus, goodbye.
  const stepAudio =
    phase === 'intro'
      ? config.explanation_audio
      : phase === 'outro'
        ? config.goodbye_audio
        : trial?.stimulus.audio;
  const replay = useCallback(() => playAudio(resolve(stepAudio)), [resolve, stepAudio]);
  useEffect(() => {
    replay();
  }, [phase, index, replay]);

  function nextTrial() {
    setWrong([]);
    setSolved(null);
    if (index + 1 < task.trials.length) setIndex(index + 1);
    else setPhase('outro');
  }

  async function pick(option) {
    if (solved) return;
    if (option.correct) {
      setSolved(option.id);
      await playAudio(resolve(trial.feedback.correct));
      nextTrial();
    } else {
      setWrong((ids) => (ids.includes(option.id) ? ids : [...ids, option.id]));
      playAudio(resolve(trial.feedback.incorrectFirst));
    }
  }

  const progress =
    phase === 'intro' ? 0 : phase === 'outro' ? 100 : (index / task.trials.length) * 100;

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

        {phase === 'trial' && trial.kind === 'question' && (
          <ChoiceView
            trial={trial}
            resolve={resolve}
            wrong={wrong}
            solved={solved}
            onPick={pick}
            onReplay={replay}
          />
        )}

        {phase === 'trial' && trial.kind !== 'question' && (
          <ScreenView trial={trial} resolve={resolve} onReplay={replay} onNext={nextTrial} />
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
