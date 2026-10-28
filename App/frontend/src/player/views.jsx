import { useI18n } from '../i18n/I18nContext.jsx';
import { playAudio } from './audio.js';

// Thin presentation views for the TaskPlayer: no flow, scoring or saving.
// Format-specific views (A, B, F, …) replace these from W6 on.

const STIMULUS_IMAGES = ['image', 'secondImage', 'thirdImage'];

function stimulusImages(stimulus, resolve) {
  const names = [
    ...STIMULUS_IMAGES.map((key) => stimulus[key]),
    ...(stimulus.items || []).map((item) => item.image),
  ];
  return names.map(resolve).filter(Boolean);
}

function SoundButton({ onClick, big = false }) {
  const { t } = useI18n();
  return (
    <button
      className={`player-sound${big ? ' big' : ''}`}
      type="button"
      onClick={onClick}
      aria-label={t('player.replay')}
    >
      🔊
    </button>
  );
}

export function ScreenView({ trial, resolve, onReplay, onNext }) {
  const { t } = useI18n();
  const images = stimulusImages(trial.stimulus, resolve);
  return (
    <div className="player-card" style={{ textAlign: 'center' }}>
      {images.map((src) => (
        <img key={src} className="player-image" src={src} alt="" />
      ))}
      {(trial.stimulus.texts || []).map((text) => (
        <div key={text} className="h2" style={{ margin: '12px 0' }}>
          {text}
        </div>
      ))}
      <div className="player-actions">
        {trial.stimulus.audio && <SoundButton onClick={onReplay} />}
        <button className="btn btn-lg btn-coral" type="button" onClick={onNext}>
          {t('tasks.next')} ▶
        </button>
      </div>
    </div>
  );
}

export function ChoiceView({ trial, resolve, wrong, solved, onPick, onReplay }) {
  const images = stimulusImages(trial.stimulus, resolve);
  return (
    <>
      <div className="player-prompt">
        {images.map((src) => (
          <img key={src} className="player-image small" src={src} alt="" />
        ))}
        {trial.stimulus.audio && <SoundButton big onClick={onReplay} />}
      </div>
      <div className="player-options">
        {trial.options.map((option) => {
          const image = resolve(option.image);
          const audio = resolve(option.audio);
          const state =
            solved === option.id ? ' correct' : wrong.includes(option.id) ? ' wrong' : '';
          // Tapping the option (picture or word) is the answer; the speaker
          // beside it only plays the option's sound (F_2: hear both words,
          // AH: hear what each picture is).
          return (
            <div key={option.id} className={`player-option${state}`}>
              <button
                className="player-option-pick"
                type="button"
                onClick={() => onPick(option)}
                aria-label={option.text || option.id}
              >
                {image ? <img src={image} alt="" /> : <span>{option.text || '•'}</span>}
              </button>
              {audio && <SoundButton onClick={() => playAudio(audio)} />}
            </div>
          );
        })}
      </div>
    </>
  );
}
