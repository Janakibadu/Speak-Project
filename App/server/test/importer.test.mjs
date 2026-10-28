import { createRequire } from 'node:module';
import { describe, expect, it } from 'vitest';
import { fixtureBundle } from './fixtures.mjs';

const require = createRequire(import.meta.url);
const { parseCsv } = require('../importer/csv.js');
const { analyseBundle, resolveMedia } = require('../importer/analyse.js');
const { normaliseRow } = require('../importer/formats.js');

const NO_CORRECTIONS = { corrections: [] };

describe('CSV reader (TR07)', () => {
  it('reads Windows-1252 text and old-Mac line endings', () => {
    const buffer = Buffer.concat([
      Buffer.from('writing_target;Image \r'),
      Buffer.from([0x64, 0x65, 0x6e, 0x20, 0x42, 0xe4, 0x72]), // "den Bär" in cp1252
      Buffer.from(';i_1.jpg\r'),
    ]);
    const { header, rows, encoding } = parseCsv(buffer);
    expect(encoding).toBe('windows-1252');
    expect(header).toEqual(['writing_target', 'image']);
    expect(rows[0].values).toEqual({ writing_target: 'den Bär', image: 'i_1.jpg' });
  });

  it('keeps repeated column names apart and drops empty trailing columns', () => {
    const { header, rows } = parseCsv(Buffer.from('a;b;a;;;\n1;2;3;;;\n;;;;;\n'));
    expect(header).toEqual(['a', 'b', 'a__2']);
    expect(rows).toHaveLength(1);
    expect(rows[0].values).toEqual({ a: '1', b: '2', a__2: '3' });
  });

  it('strips a UTF-8 byte-order mark from the first header', () => {
    const buffer = Buffer.concat([Buffer.from([0xef, 0xbb, 0xbf]), Buffer.from('FEFF;b\nx;y\n')]);
    const { header, encoding } = parseCsv(buffer);
    expect(encoding).toBe('utf-8');
    expect(header).toEqual(['feff', 'b']);
  });

  it('counts values beyond the header', () => {
    const { rows } = parseCsv(Buffer.from('a;b\n1;2;3\n'));
    expect(rows[0].extraCells).toBe(1);
  });
});

describe('format adapters', () => {
  it('B: one correct image out of four, with both feedback levels', () => {
    const trial = normaliseRow('B', {
      audio: 'at_1.mp3',
      target_image: 'i_1.jpg',
      distractor_1: 'i_2.jpg',
      distractor_2: 'i_3.jpg',
      distractor_3: 'i_4.jpg',
      followup_audio_correct_answer: 'stars.mp3',
      followup_audio_false_answer: 'at_9.mp3',
      followup_audio_second_false_answer: 'at_10.mp3',
    });
    expect(trial).toMatchObject({
      kind: 'question',
      stimulus: { audio: 'at_1.mp3' },
      correctOption: 'o1',
      feedback: { correct: 'stars.mp3', incorrectFirst: 'at_9.mp3', incorrectSecond: 'at_10.mp3' },
    });
    expect(trial.options.map((o) => o.image)).toEqual(['i_1.jpg', 'i_2.jpg', 'i_3.jpg', 'i_4.jpg']);
  });

  it('V_3: finds the correct article in both CSV layouts', () => {
    const w6 = normaliseRow('V_3', {
      article_correct: 'den',
      article_incorrect: 'der',
      den_audio: 'at_1477.mp3',
      der_audio: 'at_3242.mp3',
    });
    expect(w6.options).toEqual([
      { id: 'o1', text: 'den', audio: 'at_1477.mp3', correct: true },
      { id: 'o2', text: 'der', audio: 'at_3242.mp3' },
    ]);
    const w10 = normaliseRow('V_3', {
      correct_article: 'article2',
      article1: 'den',
      article2: 'das',
      article1_audio: 'a.mp3',
      article2_audio: 'b.mp3',
    });
    expect(w10.correctOption).toBe('o2');
  });

  it('AH: the two pictures are the answers, image1 correct, each with its word', () => {
    const trial = normaliseRow('AH', {
      image1: 'i_531.jpg',
      image2: 'i_423.jpg',
      audio_target: 'at_2845.mp3',
      audio_distractor: 'at_2849.mp3',
      question: 'at_2847.mp3',
      fb_correct: 'stars_correct.mp3',
      fb_incorrect_second_try: 'at_2893.mp3',
    });
    expect(trial.stimulus).toEqual({ audio: 'at_2847.mp3' });
    expect(trial.options).toEqual([
      { id: 'o1', image: 'i_531.jpg', audio: 'at_2845.mp3', correct: true },
      { id: 'o2', image: 'i_423.jpg', audio: 'at_2849.mp3' },
    ]);
    expect(trial.correctOption).toBe('o1');
    expect(trial.feedback).toEqual({
      correct: 'stars_correct.mp3',
      incorrectSecond: 'at_2893.mp3',
    });
  });

  it('R (vocabulary): the correct answer is the image named in correct_answer', () => {
    const trial = normaliseRow('R', {
      image: 'i_113.jpg',
      question: 'at_309.mp3',
      image_answer1: 'i_024.jpg',
      image_answer2: 'i_025.png',
      correct_answer: 'i_025.png',
    });
    expect(trial.correctOption).toBe('o2');
  });

  it('U: the three suitcase objects are the correct answers', () => {
    const row = { description_images: 'at_1.mp3', question: 'at_2.mp3' };
    for (let n = 1; n <= 5; n++) row[`image${n}`] = `i_${n}.png`;
    expect(normaliseRow('U', row).correctOption).toBe('o1,o2,o3');
  });

  it('H_X4: story pages are screens, sentence completions are questions', () => {
    expect(normaliseRow('H_X4', { story_audio: 'a.mp3', show_on_screen: 'i.jpg' }).kind).toBe(
      'screen'
    );
    const q = normaliseRow('H_X4', {
      story_audio: 'a.mp3',
      target_audio: 't.mp3',
      distractor_audio: 'd.mp3',
    });
    expect(q).toMatchObject({ kind: 'question', correctOption: 'o1' });
  });

  it('keeps the whole source row', () => {
    const row = { audio: 'at_1.mp3', image: 'i_1.jpg', note: 'x' };
    expect(normaliseRow('C', row).data).toEqual(row);
  });
});

describe('bundle analysis', () => {
  it('normalises a valid bundle into ordered tasks', async () => {
    const bundle = fixtureBundle();
    const analysis = analyseBundle(bundle, NO_CORRECTIONS);
    await resolveMedia(analysis, bundle);
    const { report, tasks, module } = analysis;

    expect(report.errors).toEqual([]);
    expect(module).toEqual({ week: 99, area: 'vocabulary' });
    expect(tasks.map((t) => [t.blockCode, t.format, t.isAdaption])).toEqual([
      ['W99_V1', 'B', false],
      ['W99_V2', 'C', true],
    ]);
    expect(tasks[0].trials).toHaveLength(2);
    expect(tasks[1].trials).toHaveLength(2); // CR-only line endings
    expect(tasks[0].config.explanation_audio).toBe('ai_1.mp3');
    // "None.mp3" means "no file", not a missing file.
    expect(tasks[0].trials[1].feedback.incorrectSecond).toBeUndefined();
    expect(report.warnings.map((w) => w.code)).toEqual(['PLACEHOLDER_IMAGE']);
  });

  it('fails on a missing media file and names where it is used', async () => {
    const bundle = fixtureBundle({ 'Stimuli/i_4.jpg': null });
    const analysis = analyseBundle(bundle, NO_CORRECTIONS);
    await resolveMedia(analysis, bundle);
    expect(analysis.report.errors).toEqual([
      expect.objectContaining({
        code: 'MISSING_MEDIA',
        file: 'K2_W99_V1_task.csv',
        line: 2,
        column: 'distractor_3',
      }),
    ]);
  });

  it('only warns about a missing instruction image', async () => {
    const bundle = fixtureBundle({
      'K2_W99_V2_general.csv':
        'block_type;explanation_audio;goodbye_audio;week;task_type;explanation_image\nW99_V2;ai_1.mp3;ai_2.mp3;99;V2;nope.jpg\n',
    });
    const analysis = analyseBundle(bundle, NO_CORRECTIONS);
    await resolveMedia(analysis, bundle);
    expect(analysis.report.errors).toEqual([]);
    expect(analysis.report.warnings.map((w) => w.code)).toContain('MISSING_OPTIONAL_MEDIA');
  });

  it('applies an explicit correction and reports it', async () => {
    const bundle = fixtureBundle({
      'K2_W99_V2_task.CSV': 'audio;image\nat_3.mp3;i_1.jpg\nat_4.mp3;i_2.jpgg\n',
    });
    const corrections = [
      { file: 'K2_W99_V2_task.CSV', from: 'i_2.jpgg', to: 'i_2.jpg', reason: 'typo' },
    ];
    const analysis = analyseBundle(bundle, { corrections });
    await resolveMedia(analysis, bundle);
    expect(analysis.report.errors).toEqual([]);
    expect(analysis.report.corrections).toEqual([{ ...corrections[0], count: 1 }]);
  });

  it('does not apply a correction meant for another file', async () => {
    const bundle = fixtureBundle({
      'K2_W99_V2_task.CSV': 'audio;image\nat_3.mp3;i_1.jpg\nat_4.mp3;i_2.jpgg\n',
    });
    const corrections = [{ file: 'other.csv', from: 'i_2.jpgg', to: 'i_2.jpg' }];
    const analysis = analyseBundle(bundle, { corrections });
    await resolveMedia(analysis, bundle);
    expect(analysis.report.errors.map((e) => e.code)).toEqual(['MISSING_MEDIA']);
  });

  it('rejects unknown formats and a malformed media name', () => {
    const analysis = analyseBundle(
      fixtureBundle({
        'manifest.csv': 'block;format;adaption\nV1;XYZ;no\nV2;C;yes\n',
        'K2_W99_V2_task.CSV': 'audio;image\nat_3;i_1.jpg\n',
      }),
      NO_CORRECTIONS
    );
    expect(analysis.report.errors.map((e) => e.code).sort()).toEqual([
      'MALFORMED_MEDIA_NAME',
      'UNKNOWN_FORMAT',
    ]);
  });

  it('rejects a question without a correct option', () => {
    const analysis = analyseBundle(
      fixtureBundle({ 'manifest.csv': 'block;format;adaption\nV1;R;no\n' }),
      NO_CORRECTIONS
    );
    expect(analysis.report.errors.map((e) => e.code)).toContain('NO_CORRECT_OPTION');
  });

  it('rejects a bundle mixing two modules', () => {
    const analysis = analyseBundle(
      fixtureBundle({ 'K2_W98_V1_task.csv': 'audio;image\nat_1.mp3;i_1.jpg\n' }),
      NO_CORRECTIONS
    );
    expect(analysis.report.errors.map((e) => e.code)).toEqual(['MIXED_MODULES']);
  });

  it('accepts identical duplicate media but rejects conflicting ones', async () => {
    const same = fixtureBundle();
    same.duplicates.push({
      name: 'i_1.jpg',
      isCsv: false,
      load: () => Buffer.from('fake media i_1.jpg', 'latin1'),
    });
    const a = analyseBundle(same, NO_CORRECTIONS);
    await resolveMedia(a, same);
    expect(a.report.errors).toEqual([]);

    const different = fixtureBundle();
    different.duplicates.push({ name: 'i_1.jpg', isCsv: false, load: () => Buffer.from('other') });
    const b = analyseBundle(different, NO_CORRECTIONS);
    await resolveMedia(b, different);
    expect(b.report.errors.map((e) => e.code)).toEqual(['DUPLICATE_FILE']);
  });
});
