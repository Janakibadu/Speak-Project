# SPEAK — App (Phase 1 slice)

A working slice of SPEAK: teacher registration/login (with password-reset
recovery), class creation, adding students with a numbers-only access code +
printable QR code, and student login by typing the code or scanning it with
the device camera.

## Tech stack

- **Frontend**: React (Vite, React Router, Axios)
- **Backend**: Node.js / Express REST API
- **Database**: MySQL
- **Packaging**: Docker & Docker Compose — the whole stack (frontend, API,
  database, and Adminer) runs in containers

## Requirements

- Docker Desktop (or another Docker Compose-compatible runtime)

## Setup

```bash
cd App
cp .env.example .env          # adjust JWT_SECRET etc. if you like

docker compose up -d --build
```

- App (React, hot-reload dev server): **http://localhost:5173**
- API: **http://localhost:3000/api**
- Adminer (database admin UI): **http://localhost:8080**

Editing files under `frontend/` or `server/` is picked up live — both
containers run their dev servers (Vite and `node --watch`) against your local
source via a bind mount, so there's no rebuild step for day-to-day changes.
Re-run `docker compose up -d --build` only after changing a `package.json` or
a `Dockerfile`.

To stop everything: `docker compose down` (add `-v` to also drop the MySQL
data volume and start from an empty database).

## Database migrations

The schema lives in numbered SQL files in `server/migrations/`
(`001_initial_schema.sql`, `002_….sql`, …). The `api` container runs
`npm run migrate` on every start; it applies only files not yet recorded in
the `schema_migrations` table, so running it twice is safe. To change the
schema, add a new numbered file — never edit one that has already been
applied. On Plesk, run `migrate` from "Node.js-Befehle ausführen".

## Importing content

Teachers import one module (one week, one area) at a time on the **Content import** page: upload a
`.zip` of the client's folder (CSVs + `Stimuli/`), read the validation report, then publish the draft.
Any error rejects the whole module, so a broken reference never reaches a child. For development or a
first setup, the same importer runs from the command line:

```bash
cd server
npm run import -- "../../Speak Programming/Vocabulary week 12" --publish
npm run import -- --all "../../Speak Programming" --publish
```

Media are stored by content hash in `server/storage/media` (`MEDIA_DIR`), never in `public/`.
How CSV columns map to trials, the per-week manifests and the typo corrections are documented in
`../docs/csv-mapping.md`; files the client still has to send are in `../docs/media-gaps.md`.

## Tests, lint and formatting

```bash
cd server
npm test               # Vitest + Supertest against a throwaway `speak_test` database
npm run lint
npm run format:check   # or `npm run format` to fix

cd ../frontend
npm run lint
npm run format:check
```

The server tests drop and recreate `speak_test` on every run, so they need a
database user allowed to do that. Defaults: `root` on `127.0.0.1:3306`, with
the password taken from `DB_ROOT_PASSWORD` in `.env`. Override with
`TEST_DB_HOST`, `TEST_DB_PORT`, `TEST_DB_USER`, `TEST_DB_PASSWORD`,
`TEST_DB_NAME` (must end in `_test`), either as environment variables or as
lines in `.env`. Inside Docker:
`docker compose exec api npm test`.

GitHub Actions (`.github/workflows/ci.yml` at the repo root) runs all of the
above on every push, against both MySQL 8.0 and MariaDB 10.11.

## What's implemented

- Teacher registration (`/teacher-register`) and login (`/teacher-login`),
  JWT-based sessions.
- Teacher password recovery (`/teacher-forgot-password` →
  `/teacher-reset-password`): requesting a reset prints a one-hour, single-use
  reset link to the **API server's console** (`docker compose logs -f api`).
  No transactional-email provider is wired up yet — that API will be chosen
  at hosting time; until then, copy the printed link into a browser to
  continue the flow.
- Class & Student Management (`/class-management`): create classes, add
  students. Each student automatically gets a unique 6-digit **numeric-only**
  access code and a QR code (rendered server-side, no third-party service).
  Codes can be regenerated and printed (a dedicated print stylesheet isolates
  just the code card).
- Student login (`/student-login`): type the code on the numeric keypad, or
  tap "Scan my code" to open the device camera in-app (via `html5-qrcode`) and
  scan the printed/on-screen QR code — both paths hit the same login endpoint.
- A small animated, CSS-keyframed vector "friendly kid" mascot replaces the
  bear emoji on the home page and student login screen.
- All pages are responsive (phone/tablet/desktop).

- The UI follows the mockups in `../ New Screenmocks` (same theme tokens,
  layouts and copy), including the fixed funder-logo bar on every page.
- Two languages, **German (default) and English**, switchable via the DE | EN
  toggle on every screen; the choice is remembered in the browser. Texts live
  in `frontend/src/i18n/de.js` and `en.js` (keep both files' keys in sync).
  API error messages are translated on the client. German learning content
  (sentences, words, articles in the tasks) stays German in both languages.

Screens built from the mockups but **not yet backed by the API** show the
mockups' sample data from `frontend/src/data/demoData.js`: dashboard progress
figures (class/student counts are live), assignments (saving isn't wired up),
content import, results, and the student units / task path / task screens /
reward. Deactivating/reactivating a student account is also not implemented.

## Database admin UI (Adminer)

`docker compose up -d` also starts [Adminer](https://www.adminer.org/) — a
lightweight web UI for browsing/editing the database (an alternative to
phpMyAdmin). Open **http://localhost:8080** and log in with:

- System: `MySQL`
- Server: `mysql` (pre-filled)
- Username: `root`
- Password: `speak` (or your `DB_ROOT_PASSWORD` from `.env`)
- Database: `speak`

## Environment variables (`.env`)

See `.env.example` — `DB_*` must match `docker-compose.yml`, plus
`JWT_SECRET`, `PORT`, and `FRONTEND_URL` (used to build the link sent in the
teacher password-reset flow).
