import AdmZip from 'adm-zip';

// A tiny synthetic module (week 99, vocabulary) in the client's format:
// V1 = B (audio → 1 of 4 images), V2 = C (remediation after V1).
export function fixtureFiles(overrides = {}) {
  const files = {
    'manifest.csv': 'block;format;adaption;note\nV1;B;no;\nV2;C;yes;\n',
    'K2_W99_V1_general.csv':
      'block_type;explanation_audio;goodbye_audio;week;task_type;explanation_image\n' +
      'W99_V1;ai_1.mp3;ai_2.mp3;99;V1;screenshot\n',
    'K2_W99_V1_task.csv':
      'audio;target_image;distractor_1;distractor_2;distractor_3;followup_audio_correct_answer;followup_audio_false_answer;followup_audio_second_false_answer\n' +
      'at_1.mp3;i_1.jpg;i_2.jpg;i_3.jpg;i_4.jpg;stars.mp3;at_9.mp3;at_10.mp3\n' +
      'at_2.mp3;i_2.jpg;i_1.jpg;i_3.jpg;i_4.jpg;stars.mp3;at_9.mp3;None.mp3\n',
    'K2_W99_V2_general.csv':
      'block_type;explanation_audio;goodbye_audio;week;task_type;explanation_image\nW99_V2;ai_1.mp3;ai_2.mp3;99;V2;i_1.jpg\n',
    'K2_W99_V2_task.CSV': 'audio;image\rat_3.mp3;i_1.jpg\rat_4.mp3;i_2.jpg\r',
  };
  for (const name of [
    'ai_1.mp3',
    'ai_2.mp3',
    'at_1.mp3',
    'at_2.mp3',
    'at_3.mp3',
    'at_4.mp3',
    'at_9.mp3',
    'at_10.mp3',
    'stars.mp3',
    'i_1.jpg',
    'i_2.jpg',
    'i_3.jpg',
    'i_4.jpg',
  ]) {
    files[`Stimuli/${name}`] = `fake media ${name}`;
  }
  return { ...files, ...overrides };
}

// Same shape as importer/bundle.js produces.
export function fixtureBundle(overrides = {}) {
  const bundle = {
    sourceName: 'fixture',
    csv: new Map(),
    media: new Map(),
    manifest: null,
    duplicates: [],
  };
  for (const [path, content] of Object.entries(fixtureFiles(overrides))) {
    if (content === null) continue;
    const name = path.split('/').pop();
    const buffer = Buffer.from(content, 'latin1');
    if (name === 'manifest.csv') bundle.manifest = buffer;
    else if (/\.csv$/i.test(name)) bundle.csv.set(name, buffer);
    else bundle.media.set(name, () => buffer);
  }
  return bundle;
}

export function fixtureZip(overrides = {}) {
  const zip = new AdmZip();
  for (const [path, content] of Object.entries(fixtureFiles(overrides))) {
    if (content !== null) zip.addFile(`Vocabulary week 99/${path}`, Buffer.from(content, 'latin1'));
  }
  return zip.toBuffer();
}
