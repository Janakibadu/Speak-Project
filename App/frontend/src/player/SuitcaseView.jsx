import { useEffect, useState } from 'react';
import { useI18n } from '../i18n/I18nContext.jsx';
import { playAudio } from './audio.js';
import { shuffle } from './engine.js';

// Format U, the suitcase game (R27), following Skript W10_G2:
// 1. remember: after a second, the three objects appear in the suitcase one
//    by one (appear sound), description_images says what they are, and after
//    three more seconds they disappear (disappear sound);
// 2. find: the question plays and the child taps objects among all five.
//    Each one found goes back into the suitcase. The TaskPlayer judges the
//    taps and plays every sound after that.
const FIRST_PAUSE_MS = 1000;
const MIN_APPEAR_MS = 500;
const REMEMBER_MS = 3000;

const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

// Options o1–o3 are items 1–3 (both are built in CSV order).
const itemIndex = (optionId) => Number(optionId.slice(1)) - 1;

export default function SuitcaseView({ trial, config, resolve, state, onPick }) {
  const { t } = useI18n();
  const { stimulus } = trial;
  const items = stimulus.items || [];
  const [step, setStep] = useState('remember'); // remember | find
  const [shown, setShown] = useState(0);
  const [options] = useState(() => shuffle(trial.options));

  useEffect(() => {
    let cancelled = false;
    async function remember() {
      await wait(FIRST_PAUSE_MS);
      for (let n = 1; n <= items.length; n += 1) {
        if (cancelled) return;
        setShown(n);
        await Promise.all([playAudio(resolve(stimulus.appearAudio)), wait(MIN_APPEAR_MS)]);
      }
      if (cancelled) return;
      await playAudio(resolve(stimulus.audio));
      await wait(REMEMBER_MS);
      if (cancelled) return;
      setStep('find');
      await playAudio(resolve(stimulus.disappearAudio));
      if (!cancelled) await playAudio(resolve(stimulus.question));
    }
    remember();
    return () => {
      cancelled = true;
    };
    // Runs once per trial; the view is keyed by trial id.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const inSuitcase =
    step === 'remember'
      ? items.slice(0, shown)
      : state.found.map((id) => items[itemIndex(id)]).filter(Boolean);
  const background = resolve(config.bg_lower);
  const done = state.solved !== null || state.revealed.length > 0;

  return (
    <>
      <div
        className="player-suitcase"
        style={background ? { backgroundImage: `url(${background})` } : undefined}
      >
        {!background && (
          <span className="player-suitcase-icon" aria-hidden="true">
            🧳
          </span>
        )}
        {inSuitcase.map((item) => (
          <img key={item.image} src={resolve(item.suitcaseImage) || resolve(item.image)} alt="" />
        ))}
      </div>

      {step === 'find' && (
        <>
          <button
            className="player-sound"
            type="button"
            onClick={() => playAudio(resolve(stimulus.question))}
            aria-label={t('player.replay')}
          >
            🔊
          </button>
          <div className="player-options">
            {options
              .filter((option) => !state.found.includes(option.id))
              .map((option) => {
                const cls = state.revealed.includes(option.id)
                  ? ' revealed'
                  : state.wrong.includes(option.id)
                    ? ' wrong'
                    : '';
                return (
                  <div key={option.id} className={`player-option${cls}`}>
                    <button
                      className="player-option-pick"
                      type="button"
                      onClick={() => onPick(option)}
                      disabled={done}
                      aria-label={option.id}
                    >
                      <img src={resolve(option.image)} alt="" />
                    </button>
                  </div>
                );
              })}
          </div>
        </>
      )}
    </>
  );
}
