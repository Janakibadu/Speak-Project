# Media gaps — files the client needs to supply

Status: 21 Oct 2026 (W4). Source: importer run over `Speak Programming/` (`npm run import -- --all`), and
the test `App/server/test/realContent.test.mjs`, which fails as soon as this list changes.
A missing file fails that module's import, so it never reaches a child (Design §5.5).

## Blocking (a module can't be imported until these arrive)

| # | Missing | Used in | Blocks |
|---|---|---|---|
| 1 | **Vocabulary week 10 media.** The folder `Vocabulary week 10/Stimuli` is a byte-for-byte copy of `Vocabulary week 12/Stimuli`; 198 files referenced by the week 10 CSVs are missing (e.g. `i_259.jpg`, `at_1343.mp3`, `ai_090.mp3`, `ai_032.mp3`, `ai_234.mp3`). | all week 10 vocabulary blocks | Vocabulary week 10 |
| 2 | **`i_024.jpg`** — one of the two yes/no answer pictures (its partner `i_025` exists as `.png`) | `K2_W6_V6_task`, `K2_W6_G5_task`, `K2_W12_G2_task` (type R) | Vocabulary week 6, Grammar week 6, Grammar week 12 |
| 3 | **`i_231_1.png`** — upper background of the suitcase task (`i_231_2.png` exists) | `K2_W6_G4_general`, `K2_W10_G2_general` (`bg_upper`) | Grammar week 6, Grammar week 10 |

Once #2 arrives, Grammar week 6 and 12 also resolve `i_025.png` (and Grammar week 6 `ai_233.mp3`, which is
only in the Grammar week 10 folder) from the other imported modules — no further files needed.

**Imports today:** Vocabulary week 12 only (published in the dev database).

## Not blocking (left out with a warning)

Instruction screenshots named in `_general.csv` files but never supplied:
`screenshot_FormatB.jpg`, `screenshot_FormatF_2.jpg`, `screenshot_FormatR.jpg` (week 6 vocabulary);
`Screenshot_FormatB.jpg`, `Screenshot_FormatT.jpg`, `instruction_FormatF1.png` (week 10 vocabulary);
`Screenshot_FormatB.jpg`, `formatF2.jpg`, `formatAH.jpg` (week 12 vocabulary).
Several grammar `_general.csv` files contain text instead of a file name (`screenshot`,
`screenshot of example`, `screenshot_first trial (cat and table)`).

## Other

- `Vocabular week 6/SPEAKCohort2VocabularyWeek62024.zip` is corrupt. Not needed: week 6 vocabulary only
  lacks `i_024.jpg` (#2).
- 20 broken file names are fixed by explicit, reviewed corrections — see `docs/csv-mapping.md` §5.
