import { useState } from 'react';
import { useI18n } from '../i18n/I18nContext.jsx';
import { playAudio } from './audio.js';
import { shuffle } from './engine.js';

// Thin presentation views for the TaskPlayer: no flow, scoring or saving.
// Formats that need their own layout get their own view (StoryView for A,
// ReflectionView for AT/AV/AX, SuitcaseView for U); the rest share
// ChoiceView and ScreenView.

// Stimulus pictures, each with the sound that names it (V_3: the pictures
// of the sentence, image1_audio …).
const STIMULUS_IMAGES = [
  ['image', 'imageAudio'],
  ['secondImage', 'secondImageAudio'],
  ['thirdImage', 'thirdImageAudio'],
];

function stimulusImages(stimulus, resolve) {
  return STIMULUS_IMAGES.map(([image, audio]) => ({
    src: resolve(stimulus[image]),
    audio: resolve(stimulus[audio]),
  })).filter((picture) => picture.src);
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

function NextButton({ onNext }) {
  const { t } = useI18n();
  return (
    <button className="btn btn-lg btn-coral" type="button" onClick={onNext}>
      {t('tasks.next')} ▶
    </button>
  );
}

export function ScreenView({ trial, resolve, onReplay, onNext }) {
  const images = stimulusImages(trial.stimulus, resolve);
  return (
    <div className="player-card" style={{ textAlign: 'center' }}>
      {images.map(({ src }) => (
        <img key={src} className="player-image" src={src} alt="" />
      ))}
      {(trial.stimulus.texts || []).map((text) => (
        <div key={text} className="h2" style={{ margin: '12px 0' }}>
          {text}
        </div>
      ))}
      <div className="player-actions">
        {trial.stimulus.audio && <SoundButton onClick={onReplay} />}
        <NextButton onNext={onNext} />
      </div>
    </div>
  );
}

// Format A, one storybook page (R21): the page picture with its story audio.
// Pages that introduce a word also show that word's picture; tapping it plays
// the word, then what it means.
export function StoryView({ trial, resolve, onReplay, onNext }) {
  const { t } = useI18n();
  const { stimulus } = trial;
  const page = resolve(stimulus.image);
  const target = resolve(stimulus.targetImage);

  async function playWord() {
    await playAudio(resolve(stimulus.targetAudio));
    await playAudio(resolve(stimulus.definitionAudio));
  }

  return (
    <div className="player-card player-story">
      {page && <img className="player-image" src={page} alt="" />}
      {target && (
        <button
          className="player-story-word"
          type="button"
          onClick={playWord}
          aria-label={t('player.hearWord')}
        >
          <img src={target} alt="" />
          <span aria-hidden="true">🔊</span>
        </button>
      )}
      <div className="player-actions">
        {stimulus.audio && <SoundButton onClick={onReplay} />}
        <NextButton onNext={onNext} />
      </div>
    </div>
  );
}

// Formats AT, AV, AX: a teaching screen (R28). Each picture is heard with
// two articles (der Hund → den Hund); tapping an article plays it. The
// light bulb plays the question and the explanation, where the CSV has them.
export function ReflectionView({ trial, resolve, onReplay, onNext }) {
  const { t } = useI18n();
  const { stimulus } = trial;
  const panels = stimulus.panels || [];

  async function explain() {
    await playAudio(resolve(stimulus.questionAudio));
    await playAudio(resolve(stimulus.explanationAudio));
  }

  return (
    <div className="player-card">
      <div className="player-reflection">
        {panels.map((panel) => (
          <div key={panel.image} className="player-reflection-panel">
            <img src={resolve(panel.image)} alt="" />
            {[panel.first, panel.second].map((form, i) => (
              <button
                key={i}
                className="player-reflection-form"
                type="button"
                onClick={() => playAudio(resolve(form.audio))}
                disabled={!resolve(form.audio)}
              >
                <span>{form.article || '…'}</span>
                <span aria-hidden="true">🔊</span>
              </button>
            ))}
          </div>
        ))}
      </div>
      <div className="player-actions">
        {stimulus.audio && <SoundButton onClick={onReplay} />}
        {(stimulus.questionAudio || stimulus.explanationAudio) && (
          <button
            className="player-sound"
            type="button"
            onClick={explain}
            aria-label={t('player.explain')}
          >
            💡
          </button>
        )}
        <NextButton onNext={onNext} />
      </div>
    </div>
  );
}

const SCREEN_VIEWS = { A: StoryView, AT: ReflectionView, AV: ReflectionView, AX: ReflectionView };

export function screenViewFor(format) {
  return SCREEN_VIEWS[format] || ScreenView;
}

function optionClass(option, state) {
  if (state.solved === option.id) return ' correct';
  if (state.revealed.includes(option.id)) return ' revealed';
  if (state.wrong.includes(option.id)) return ' wrong';
  return '';
}

// The prompt and the answer options of one question. Options are shuffled
// once per trial (the importer stores the correct one first). Tapping the
// option (picture or word) is the answer; the speaker beside it only plays
// the option's sound (F_2: hear both words, AH: hear what each picture is).
export function ChoiceView({ trial, resolve, state, onPick, onReplay }) {
  const [options] = useState(() => shuffle(trial.options));
  const images = stimulusImages(trial.stimulus, resolve);
  const done = state.solved !== null || state.revealed.length > 0;
  return (
    <>
      <div className="player-prompt">
        {images.map(({ src, audio }) =>
          audio ? (
            <button
              key={src}
              className="player-prompt-picture"
              type="button"
              onClick={() => playAudio(audio)}
            >
              <img className="player-image small" src={src} alt="" />
            </button>
          ) : (
            <img key={src} className="player-image small" src={src} alt="" />
          )
        )}
        {trial.stimulus.audio && <SoundButton big onClick={onReplay} />}
      </div>
      <div className="player-options">
        {options.map((option, position) => {
          const image = resolve(option.image);
          const audio = resolve(option.audio);
          return (
            <div key={option.id} className={`player-option${optionClass(option, state)}`}>
              <button
                className="player-option-pick"
                type="button"
                onClick={() => onPick(option)}
                disabled={done}
                aria-label={option.text || option.id}
              >
                {/* A sound-only answer (F_2 without writing_*) shows its place. */}
                {image ? <img src={image} alt="" /> : <span>{option.text || position + 1}</span>}
              </button>
              {audio && <SoundButton onClick={() => playAudio(audio)} />}
            </div>
          );
        })}
      </div>
    </>
  );
}

// A demonstration row (*_example.csv): the same question with the answer
// already marked, so the child sees how the task works before trying it.
export function ExampleView({ trial, resolve, onReplay, onNext }) {
  const { t } = useI18n();
  const state = {
    wrong: [],
    found: [],
    solved: null,
    revealed: trial.options.filter((o) => o.correct).map((o) => o.id),
  };
  return (
    <>
      <div className="pill pill-sky">👀 {t('player.example')}</div>
      <ChoiceView
        trial={trial}
        resolve={resolve}
        state={state}
        onPick={() => {}}
        onReplay={onReplay}
      />
      <NextButton onNext={onNext} />
    </>
  );
}
