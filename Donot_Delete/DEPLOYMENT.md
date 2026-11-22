# DEPLOYMENT.md: Deploying an update of SPEAK to Plesk

How to put a new version of SPEAK on `https://speak.ifs.tu-dortmund.de`.
Follow it top to bottom. It takes about 15 minutes.

Background and history: `DEPLOYMENT_PLESK.md` (original plan) and `DEPLOYMENT_UPDATE_02.md`
(second deployment and the problems hit). This file is the current procedure.

---

## 1. How the server is set up

| Item | Value |
|---|---|
| Domain | `speak.ifs.tu-dortmund.de` |
| Panel | Plesk (TU Dortmund ITMC), German UI, **no SSH** |
| App root | `/httpdocs/moodle` (folder name is historical: ITMC locked the document root) |
| Document root | `/httpdocs/moodle/public` (the built React app) |
| Startup file | `index.js` |
| Node.js | 22, mode `production` |
| Database | Plesk "Datenbanken", `w3ueb_t5o1pe_speak` |

The Node app serves both the API (`/api/...`) and the React app (`public/`) on one domain.
On every start in production it applies any new database migrations by itself.

### Environment variables (Node.js → Umgebung)

Already set. You only need to touch them if a new variable is added to the code.

| Section | Name | Value |
|---|---|---|
| Umgebungsvariablen | `NODE_ENV` | `production` |
| Umgebungsvariablen | `DB_HOST` | `localhost` |
| Umgebungsvariablen | `DB_PORT` | `3306` |
| Umgebungsvariablen | `DB_NAME` | `w3ueb_t5o1pe_speak` |
| Umgebungsvariablen | `DB_USER` | `w3ueb_t5o1pe_admin` |
| Umgebungsvariablen | `FRONTEND_URL` | `https://speak.ifs.tu-dortmund.de` |
| Secrets | `DB_PASSWORD` | (hidden) |
| Secrets | `JWT_SECRET` | (hidden) |
| Secrets | `ACCESS_CODE_SECRET` | (hidden, **never change it**: every student access code would stop working) |

Rules:
- Passwords, keys and tokens go in **Secrets**, never in Umgebungsvariablen, never in a file, never in Git or chat.
- Never upload a `.env` file. Do not set `PORT` (Passenger sets it).
- New secrets: generate with `openssl rand -hex 32` in your own terminal.

---

## 2. Before you start

- [ ] Your changes are merged and you are on the commit you want to deploy (`git pull`).
- [ ] The app works locally (`npm run dev` in `App/server` and `App/frontend`).
- [ ] Note whether this update changes `App/server/package.json` (new dependencies)
      or adds a file in `App/server/migrations/`. You need to know this in step 4.
- [ ] You have access to the Plesk panel.

---

## 3. Build `speak_deploy.zip` (on your Mac)

Run this from the repo root. It builds into a temporary folder, so your
`App/server` and `App/frontend` dev folders are left untouched.

```bash
# from the repo root ("Speak Project")
REPO="$(pwd)"
STAGE="$(mktemp -d)/stage"
mkdir -p "$STAGE"

# 1. Build the React app straight into the zip's public/ folder
cd "$REPO/App/frontend"
npm install
npm run build -- --outDir "$STAGE/public" --emptyOutDir

# 2. Copy only what the server needs (no node_modules, .env, tests, storage, Docker files)
cd "$REPO/App/server"
cp -R index.js buildApp.js db.js dbConfig.js package.json package-lock.json \
      middleware routes utils importer migrations scripts "$STAGE/"

# 3. Zip the CONTENTS of the stage folder (no wrapping folder)
cd "$STAGE"
find . -name ".DS_Store" -delete
rm -f "$REPO/speak_deploy.zip"
zip -rqX "$REPO/speak_deploy.zip" .

# 4. Check
unzip -l "$REPO/speak_deploy.zip" | grep -E " (index.js|public/index.html)$"
grep -l "localhost:3000" public/assets/*.js && echo "WRONG: API URL is hard-coded" || echo "OK: API URL is relative"
```

The check must list both `index.js` and `public/index.html` and print `OK`.

**If `App/server` gets a new top-level file or folder** that the server needs at runtime,
add it to the `cp -R` line above (and update this file).

Do **not** commit `speak_deploy.zip`.

### Build problems

| Problem | Fix |
|---|---|
| `vite: Permission denied` | `node_modules` was not created on this Mac (Docker or a copied folder). In `App/frontend`: `rm -rf node_modules && npm install` |
| npm blocks esbuild's install script | `npm approve-scripts esbuild fsevents`, then `npm install` again |

---

## 4. Upload in Plesk

1. **Dateimanager** → open `/httpdocs/moodle`.
2. Delete the old **`public`** folder (otherwise old build files pile up).
   Do **not** delete `node_modules` or `storage`.
3. Upload `speak_deploy.zip` into `/httpdocs/moodle`.
4. Extract it with **"Vorhandene Dateien überschreiben"** ticked.
5. Check that `/httpdocs/moodle/index.js` and `/httpdocs/moodle/public/index.html` exist.
6. Delete the uploaded `speak_deploy.zip` from the server.
7. **Node.js** → **NPM install**, *only if* `App/server/package.json` changed since the last deployment.
   (When unsure, run it. It does no harm.)
8. **Node.js** → **App neu starten**. Always.

New migrations run automatically during the restart. You do not need
"Node.js-Befehle ausführen" or `run migrate`.

---

## 5. Test on the live site

- [ ] `https://speak.ifs.tu-dortmund.de` loads the app.
- [ ] Reloading the page on `/teacher/login` still shows the app (not a 404).
- [ ] `https://speak.ifs.tu-dortmund.de/api/unknown` shows `{"error":"Not found."}`.
- [ ] Teacher login works.
- [ ] Student login with an access code works.
- [ ] Whatever this update changed works.

Hard-refresh the browser (Cmd+Shift+R) if you still see the old version.

---

## 6. If something goes wrong

Look in **Protokolle** (error log) first. The app writes one clear line and never prints secrets.

| What you see | Cause | Fix |
|---|---|---|
| `[config] Missing required environment variable(s): X` | Variable missing or misspelled in the panel | Add/fix `X` under Umgebung, restart |
| `[startup] ER_ACCESS_DENIED_ERROR` | `DB_PASSWORD` secret does not match the database user's password | Datenbanken → user → set password (letters and digits only), replace the `DB_PASSWORD` secret with the same value, restart |
| `[startup] … Migration NNN_… failed` | A new migration does not work on the server's database | Note the message, tell the developer who wrote the migration. Do not edit migration files that already ran |
| Passenger: "application process exited prematurely" | App crashes at startup | Check Protokolle. If it shows nothing useful, switch the mode to `development` briefly, read the error, switch back to `production` |
| `Cannot find module '…'` | New dependency, NPM install not run | Node.js → NPM install, restart |
| Page loads but shows the old version | Browser cache, or old `public` not deleted | Hard-refresh; check step 4.2 |
| Page is blank, browser console shows 404s for `/assets/…` | `public` is incomplete | Re-extract the zip, check `public/assets/` exists |

### Rollback

Keep the previous `speak_deploy.zip` on your Mac. To go back, repeat section 4 with the old zip.
Migrations are not undone by this, so roll back only to a version that works with the current database.

---

## 7. Quick checklist (after you have done it once)

1. `git pull`, then build the zip (section 3)
2. Dateimanager: delete `public`, upload, extract with overwrite, delete the zip
3. NPM install (if `package.json` changed)
4. App neu starten
5. Test (section 5)
