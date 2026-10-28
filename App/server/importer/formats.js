// Format adapters: map one CSV row of a given format onto the single trial
// model (Design §3.2): stimulus, options, correct option(s), feedback media.
// Every adapter also keeps the whole row in `data`, so nothing in the source
// is lost even where the engine does not use it yet. See docs/csv-mapping.md.

const present = (value) =>
  value !== undefined && value !== null && value !== '' && !(Array.isArray(value) && !value.length);

function compact(object) {
  return Object.fromEntries(Object.entries(object).filter(([, value]) => present(value)));
}

function first(row, ...names) {
  for (const name of names) if (row[name]) return row[name];
  return '';
}

// options: [{ image?, audio?, text?, correct? }] → ids o1, o2, … (empty ones dropped)
function options(list) {
  return list
    .map((option, index) =>
      compact({ id: `o${index + 1}`, ...option, correct: option.correct || undefined })
    )
    .filter((option) => option.image || option.audio || option.text);
}

function feedback(row, { correct, first: firstTry, second }) {
  return compact({
    correct: first(row, ...correct),
    incorrectFirst: first(row, ...firstTry),
    incorrectSecond: first(row, ...second),
  });
}

const FEEDBACK = {
  correct: ['fb_correct', 'followup_audio_correct_answer', 'follow_up_correct'],
  first: [
    'fb_incorrect_first_try',
    'followup_audio_false_answer',
    'followup_audio_first_false_answer',
    'incorrect_first_time',
    'follow_up_incorrect_first_time',
    'fb_incorrect',
  ],
  second: [
    'fb_incorrect_second_try',
    'followup_audio_second_false_answer',
    'incorrect_second_time',
    'follow_up_incorrect_second_time',
    'follow_up_if_not_correct',
  ],
};

const screen = (stimulus) => ({ kind: 'screen', stimulus: compact(stimulus), options: [] });
const question = (stimulus, opts, row) => ({
  kind: 'question',
  stimulus: compact(stimulus),
  options: options(opts),
  feedback: feedback(row, FEEDBACK),
});

// Two spoken answers, the first correct (F_1, F_2, G2).
const twoAudios = (row) => [
  { audio: row.audio_target, text: row.writing_target, correct: true },
  { audio: row.audio_distractor, text: row.writing_distractor },
];

// V_3 article choice. W6 names the articles and has one audio per article
// (den_audio, der_audio); W10/W12 give article1/2 with their audio and name
// the correct one in correct_article ("article1").
function articleOptions(row) {
  if (row.article_correct) {
    const audioFor = (article) => row[`${article.toLowerCase()}_audio`];
    return [
      { text: row.article_correct, audio: audioFor(row.article_correct), correct: true },
      { text: row.article_incorrect, audio: audioFor(row.article_incorrect) },
    ];
  }
  return [1, 2].map((n) => ({
    text: row[`article${n}`],
    audio: row[`article${n}_audio`],
    correct: row.correct_article === `article${n}`,
  }));
}

// `scored`: mistakes count towards the remediation threshold (R32).
// `playable: false`: imported and kept, but not yet offered to children.
const FORMATS = {
  A: {
    scored: false,
    trial: (row) =>
      screen({
        audio: row.story_audio,
        image: first(row, 'show_on_screen', 'schow_on_screen'),
        targetImage: row.target,
        targetAudio: row.target_audio,
        definitionAudio: row.definition_audio,
      }),
  },
  N: {
    scored: false,
    trial: (row) =>
      screen({
        audio: first(row, 'story_audio', 'audio'),
        image: first(row, 'show_on_screen', 'image'),
        texts: [row.writing1, row.writing2].filter(Boolean),
      }),
  },
  C: {
    scored: false,
    trial: (row) => screen({ audio: row.audio, image: first(row, 'image', 'target') }),
  },
  B: {
    scored: true,
    trial: (row) =>
      question(
        { audio: row.audio },
        [
          { image: first(row, 'target_image', 'target'), correct: true },
          { image: first(row, 'distractor_1', 'image2', 'image_2') },
          { image: first(row, 'distractor_2', 'image3', 'image_3') },
          { image: first(row, 'distractor_3', 'image4', 'image_4') },
        ],
        row
      ),
  },
  F_1: {
    scored: true,
    trial: (row) => question({ image: row.image1, audio: row.question }, twoAudios(row), row),
  },
  F_2: {
    scored: true,
    trial: (row) => question({ image: row.image1 }, twoAudios(row), row),
  },
  AH: {
    scored: true,
    // Skript W12_V6: the question plays from a speaker; the answers are the
    // pictures image1 (correct) and image2, each with its word as audio.
    trial: (row) =>
      question(
        { audio: row.question },
        [
          { image: row.image1, audio: row.audio_target, correct: true },
          { image: row.image2, audio: row.audio_distractor },
        ],
        row
      ),
  },
  T: {
    scored: true,
    trial: (row) =>
      question(
        { audio: row.audio_target },
        [{ image: row.image1, correct: true }, { image: row.distractor }],
        row
      ),
  },
  R: {
    scored: true,
    trial: (row) => {
      if (row.correct_answer) {
        // Vocabulary: two answer images (yes/no); correct_answer names one.
        return question(
          { image: row.image, audio: row.question },
          [row.image_answer1, row.image_answer2].map((image) => ({
            image,
            correct: image === row.correct_answer,
          })),
          row
        );
      }
      // Grammar: is the statement about the target image right or wrong?
      return question(
        { image: row.target_image, audio: row.question },
        [{ image: row.correct_image, correct: true }, { image: row.wrong_image }],
        row
      );
    },
  },
  G1: {
    scored: false,
    trial: (row) => screen({ audio: row.audio, image: row.image, position: row.location_of_image }),
  },
  G2: {
    scored: true,
    trial: (row) => question({ image: row.image1, audio: row.question }, twoAudios(row), row),
  },
  V_3: {
    scored: true,
    trial: (row) =>
      question(
        {
          audio: row.pre_sentence,
          image: row.image1,
          imageAudio: row.image1_audio,
          secondImage: first(row, 'image2'),
          secondImageAudio: row.image2_audio,
          thirdImage: row.image3,
          thirdImageAudio: row.image3_audio,
          sentenceAudio: row.whole_sentence,
        },
        articleOptions(row),
        row
      ),
  },
  U: {
    scored: true,
    // Three objects go into the suitcase (images 1–3, named in audio); the
    // child then picks what was inside from all five. Answer: images 1–3.
    trial: (row) =>
      question(
        {
          audio: row.description_images,
          question: row.question,
          items: [1, 2, 3].map((n) =>
            compact({ image: row[`image${n}`], audio: row[`audio_image${n}`] })
          ),
        },
        [1, 2, 3, 4, 5].map((n) => ({
          image: row[`image${n}`],
          audio: row[`audio_image${n}`],
          correct: n <= 3,
        })),
        row
      ),
  },
  H_X4: {
    scored: true,
    // Story pages, some ending in a sentence to complete from two audios.
    trial: (row) => {
      if (!row.target_audio) return screen({ audio: row.story_audio, image: row.show_on_screen });
      return question(
        {
          audio: row.story_audio,
          image: row.show_on_screen,
          lastSentenceAudio: row.audio_last_sentence,
          fullSentenceAudio: row.full_and_correct_sentence,
        },
        [
          { audio: row.target_audio, text: row.target_writing, correct: true },
          { audio: row.distractor_audio, text: row.distractor_writing },
        ],
        row
      );
    },
  },
  // Teaching and reflection screens (R28): content is in `data`. Their column
  // labels don't always match the values (e.g. W6), so nothing is mapped yet.
  AT: { scored: false, trial: () => screen({}) },
  AV: { scored: false, trial: () => screen({}) },
  AX: { scored: false, trial: () => screen({}) },
  // Pending client decision / engine design: kept in `data`, not offered yet.
  AD: { scored: true, playable: false, trial: () => screen({}) },
  AF: { scored: true, playable: false, trial: () => screen({}) },
  AM: { scored: false, playable: false, trial: () => screen({}) },
};

// Normalises one CSV row. `kind` 'example' marks demonstration rows from
// *_example.csv files, which are shown before the scored trials.
function normaliseRow(format, values, { example = false } = {}) {
  const adapter = FORMATS[format];
  const trial = adapter.trial(values);
  return {
    kind: example ? 'example' : trial.kind,
    stimulus: trial.stimulus,
    options: trial.options,
    correctOption:
      trial.options
        .filter((o) => o.correct)
        .map((o) => o.id)
        .join(',') || null,
    feedback: trial.feedback || {},
    data: values,
  };
}

module.exports = { FORMATS, normaliseRow };
