# CSV mapping — how the importer reads the SPEAK content

Status: **proposed 21 Oct 2026, to be checked with the client** (W3 exit criterion).
Code: `App/server/importer/` · Requirements: R09, R17–R28, R42, TR07, NFR21, NFR22.

## 1. What a bundle is

One upload = one **module** = one week in one area (R18), as a `.zip` of the client's folder
(for example `Vocabulary week 12/`). Folders inside the zip don't matter; files are found by name.

| File | Meaning |
|---|---|
| `K2_W{week}_{V\|G}{n}_general.csv` | Block settings: instruction audio, goodbye audio, instruction image, … (one row) |
| `K2_W{week}_{V\|G}{n}_task.csv` | One trial per row |
| `K2_W{week}_{V\|G}{n}_example.csv` | Demonstration rows shown before the trials (V_3, AD) |
| `K2_W{week}_G{n}_reflection.csv` | A teaching/reflection screen (AT, AV, AX) |
| `K2_W{week}_G{n}_reflection_adaption.csv` (+ `_general`) | A reflection screen shown only as remediation |
| `manifest.csv` | Block → format, in play order (see §3). Optional for weeks 6/10/12, which ship with one. |
| Everything else | Media (images, audio), referenced by exact file name |

Reading rules: `;` separator, no quoting; UTF-8 or Windows-1252 (3 files use the latter); LF, CRLF or
old-Mac CR line endings (6 files mix them); header names are compared case-insensitively with spaces
removed (`Image _2` = `image_2`); empty trailing columns are dropped; a repeated column name keeps both
values (`audio_nom_2`, `audio_nom_2__2`). `None.mp3` / `None.png` mean "no file" (OpenSesame convention).

## 2. The trial model

Every row becomes one trial (Design §3.2):

| Field | Content |
|---|---|
| `kind` | `question` (scored, has a correct option), `screen` (listen/look only), `example` |
| `stimulus` | What is shown/played first: `audio`, `image`, and format-specific extras |
| `options` | `[{ id: o1…, image?, audio?, text?, correct? }]` — shuffled by the player, not by the importer |
| `correctOption` | Id(s) of the correct option(s), e.g. `o1` or `o1,o2,o3` |
| `feedback` | `correct`, `incorrectFirst`, `incorrectSecond` audio (R30, R31) |
| `data` | The complete source row, so nothing is lost |

## 3. Formats

`Scored` formats count mistakes towards the remediation threshold (R32).

| Format | Rows → trial | Scored |
|---|---|---|
| **A** storybook | screen: `story_audio`, image `show_on_screen`; extras `target` image, `target_audio`, `definition_audio` | no |
| **B** audio → image | question: plays `audio`; options = `target_image`/`target` (correct) + 3 distractors (`distractor_1–3` or `image2–4`/`image_2–4`); feedback from `followup_audio_*` / `fb_correct` | yes |
| **C** remediation | screen: `audio` + `image`/`target` | no |
| **F_1** question, 2 audios | question: image `image1`, plays `question`; options `audio_target` (correct), `audio_distractor` | yes |
| **F_2** image → audio | as F_1 without `question` | yes |
| **T** picture choice | question: plays `audio_target`; options `image1` (correct), `distractor` | yes |
| **R** yes/no | Vocabulary: image + `question`; options `image_answer1/2`, correct = `correct_answer`. Grammar: `target_image` + `question`; options `correct_image` (correct), `wrong_image` | yes |
| **G1** rhyme | screen: `audio`, `image`, `location_of_image` | no |
| **G2** who/what | question: `image1` + `question`; options `audio_target`/`writing_target` (correct), `audio_distractor`/`writing_distractor` | yes |
| **V_3** article choice | question: `pre_sentence`, images 1–3 with audio, `whole_sentence`; options = the two articles with their audio. W6 names them `article_correct`/`article_incorrect` (+ `den_audio`, `der_audio`); W10/W12 use `article1/2` + `correct_article` | yes |
| **U** suitcase | question: images 1–3 go into the suitcase; options = images 1–5, **correct = 1–3**, all three must be found (Q8, resolved). Also imports, as optional files the CSV doesn't name: `template_<id>.png` (suitcase pictures), `appear.mp3`, `disappear.mp3`, `stars_correct.mp3` | yes |
| **AT / AV / AX** reflection | screen: three pictures, each with two article forms + audio (nominative → accusative/dative), optional intro, question and explanation audio. W10/W12: by column name. **W6: by position, provisional** (Q9) | no |
| **AH** | question: `question` (audio); options = pictures `image1` (correct, word `audio_target`) and `image2` (word `audio_distractor`), as in `Skript W12_V6.txt` (see Q1) | yes |
| **H_X4** story + completion | rows without `target_audio` are story screens; rows with it are questions: options `target_audio`/`target_writing` (correct), `distractor_audio`/`distractor_writing` | yes |
| **N** story | screen: `audio`/`story_audio`, image, `writing1/2` | no |
| **AD**, **AF**, **AM** | imported and kept in `data`, **not playable yet** (AF/AM deferred by D-09; AD see Q7) | — |

## 4. Module manifests (block → format, play order)

Files: `App/server/importer/manifests/W{week}_{V|G}.csv`. Order and formats follow
`Overview_tasks for website.xlsx`; "adaption" = shown only after too many mistakes in the task before.

| Week 6 Vocabulary | Week 10 Vocabulary | Week 12 Vocabulary |
|---|---|---|
| V1 A · V2 B · **V3 C (adaption)** · V4 F_2 · **V5 C (adaption)** · V6 R · **V7 C (adaption)** | V1 B · V2 F_1 · V3 T · V4 B · V5 F_1 · V6 T | V1 A · V2 B · **V3 C** · V4 F_2 · **V5 C** · V6 AH · **V7 C** · V8 AH · **V9 C** (all C = adaption) |

| Week 6 Grammar | Week 10 Grammar | Week 12 Grammar |
|---|---|---|
| G1 G1 · G2 G2 · G2_reflection AT · G3 V_3 · **G3_reflection_adaption AT (adaption)** · G4 U · G4_reflection AT · G5 R | G1 N · G2 U · G2_reflection AV · G3 V_3 · G3_reflection AV · G4 AF · G5 AD | G1 H_X4 · G2 R · G2_reflection AX · G3 V_3 · **G3_reflection_adaption AX (adaption)** · G4 N · G4_reflection AX · G5 AM |

A new week needs **no code change** (R42): add a `manifest.csv` (`block;format;adaption;note`) to the zip.

## 5. Corrections

Broken media names are never fixed silently. `App/server/importer/corrections.json` lists each fix, per
file; every applied fix appears in the import report. Proposed fixes (please confirm, Q6):

| File(s) | In the CSV | Replaced by | Why |
|---|---|---|---|
| K2_W6_V1_task | `at_304..mp3`, `at_307..mp3`, `at_308..mp3` | `at_304.mp3`, … | double dot |
| K2_W6_V2_task | `stars_correctt.mp3` | `stars_correct.mp3` | typo |
| K2_W6_V4_task, K2_W10_G4_task | `stars_correct.mp4` … `.mp7` | `stars_correct.mp3` | spreadsheet auto-fill counted up the extension |
| K2_W10_V1_task, K2_W10_V4_task | `starts.correct.mp3` | `stars_correct.mp3` | typo |
| K2_W6_G1_general | `i_264.mp3` | `i_264.jpg` | image with an audio extension |
| K2_W12_G3_reflection_adaption | `i_680` | `i_680.jpg` | extension missing |
| K2_W12_V2_task | `i_155.jpg` | `i_155.png` | file exists only as .png |
| K2_W6_G3_task / _example | `i_416.jpg`, `i_417.jpg` | `.png` | file exists only as .png |
| K2_W6_V6_task, K2_W6_G5_task, K2_W12_G2_task | `i_025.jpg` | `i_025.png` | file exists only as .png |

## 6. Questions for the client

1. **AH** — *Resolved 22 Oct:* the OpenSesame script (`Skript W12_V6.txt`) draws `image1` and `image2` as the two
   answer boxes; tapping one plays its word (`audio_target` / `audio_distractor`) and `image1` is correct. That matches
   the overview sheet ("choose the correct answer from two pictures"). We map it that way. Please confirm.
2. **Week 10 Grammar G1** has no format code in the overview sheet ("Children listen to story"). We use **N** (story).
3. **Remediation flags** — the overview sheet and the file names disagree twice: W6 `G4_reflection` is
   "Adaptation" in the sheet but not named `_adaption`; W12 `G3_reflection_adaption` is "Reflection" in the
   sheet. We follow the file names. Correct?
4. **Remediation rule** — the scripts count **trials with at least one mistake** (`n_incorrect_trials > 2`)
   and, after the remediation, **repeat the task** (W12 V6: `run W12_V7; run W12_V6_copy`). The SRS (R32)
   says "number of mistakes ≥ 3" and doesn't mention repeating. *Decided 22 Nov 2026 (developer, pending client
   confirmation):* follow the SRS — every wrong tap counts, the threshold is `task_type_config.mistake_threshold`
   (default 3), and after the adaption task the child continues with the next task (no repeat). Both counts are
   stored (`attempts.mistakes` and, via `responses`, the trials with a mistake), so switching is a small change.
5. The overview sheet describes Week 12 Grammar V_3 as "accusative"; the week's topic is the dative. Typo?
6. Please confirm the corrections in §5.
7. **AD** (W10 G5): which picture is the correct answer, and what is `article_below{n}` for?
8. **U** — *Resolved 22 Nov 2026 from `Skript W10_G2.txt`:* the three objects appear in the suitcase one by one,
   then disappear; the child taps among all five until all three are found (each tap plays the object's word, then
   `stars_correct.mp3` or `fb_incorrect`). The suitcase pictures are always `template_<id>.png`, also where the
   CSV names the `.jpg` (week 10). Please confirm.
9. **Reflection files, week 6** (`K2_W6_G2_reflection`, `G3_reflection_adaption`, `G4_reflection`): the column
   labels don't match the values (intro audio, three images, six audio files, then `der der der den den den`).
   *Provisional mapping, in use since 22 Nov 2026:* the audio files are paired by number — image1 = `at_4658`
   (der) / `at_4659` (den), image2 = `at_4660` / `at_4661`, image3 = `at_4662` / `at_4663` (same pattern in the
   other two files). Please confirm, or fix the header. Weeks 10 and 12 are labelled correctly.
10. The instruction screenshots named in the `_general` files (`screenshot_FormatB.jpg`, `formatAH.jpg`, …)
    were never supplied. Are they needed? Today they are left out with a warning.
11. **F_1/F_2 answer words:** the answer buttons can show the written word (e.g. `der Hund` / `der Mund`) when the
    task CSV has `writing_target` and `writing_distractor` columns, as `K2_W6_G2_task.csv` already does. The F_2 file
    `K2_W12_V4_task.csv` (and `K2_W10_V2`, `K2_W10_V5`) has no such columns, so the buttons show only their number (1, 2). Should the
    words be shown? If yes, please add the two columns to those CSVs; a re-import is all that is needed.
12. **Correct-answer sound:** Vocabulary week 12 B (`K2_W12_V2_task.csv`) names `stars_correct_mp3` (no dot) as the
    correct-answer feedback. Is `stars_correct.mp3` meant? Until confirmed, that sound stays silent.
13. **`K2_W12_G4_reflection.csv`:** `article_nom_3` contains `i_682.jpg` instead of an article (probably `die`).
    The player shows no word there until the CSV is fixed.

## 7. Survey figures (21 Oct 2026)

88 CSVs, 376 data rows → 337 trials in 45 tasks (6 modules). 776 images, ~1,321 audio files, 958 of them
not referenced by any CSV (UI sounds, screenshots, other cohorts). 5 file names exist in several week
folders **with different content** (`i_264.jpg`, `i_848.jpg`, `at_1477.mp3`, `highlight_box_yellow.png`,
`version_info.json`); media are therefore resolved per module, and stored by content hash.
