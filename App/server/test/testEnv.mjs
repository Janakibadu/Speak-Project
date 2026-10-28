import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import os from 'node:os';
import dotenv from 'dotenv';

// Tests need a MySQL/MariaDB user that may create and drop the test database.
// TEST_DB_* come from the environment, else from App/.env; the password
// falls back to DB_ROOT_PASSWORD (the docker-compose root user).
const here = path.dirname(fileURLToPath(import.meta.url));
const envFile = path.join(here, '..', '..', '.env');
const local = fs.existsSync(envFile) ? dotenv.parse(fs.readFileSync(envFile)) : {};
const setting = (name) => process.env[name] ?? local[name];

const dbName = setting('TEST_DB_NAME') || 'speak_test';
if (!dbName.endsWith('_test')) {
  throw new Error('TEST_DB_NAME must end in "_test": the test run drops and recreates it.');
}

export const testEnv = {
  NODE_ENV: 'test',
  JWT_SECRET: 'test-only-jwt-secret',
  ACCESS_CODE_SECRET: 'test-only-access-code-secret',
  DB_HOST: setting('TEST_DB_HOST') || '127.0.0.1',
  DB_PORT: setting('TEST_DB_PORT') || '3306',
  DB_USER: setting('TEST_DB_USER') || 'root',
  DB_PASSWORD: setting('TEST_DB_PASSWORD') ?? local.DB_ROOT_PASSWORD ?? '',
  DB_NAME: dbName,
  // Imported test media go to a throwaway folder, never the dev store.
  MEDIA_DIR: path.join(os.tmpdir(), 'speak-test-media'),
};
