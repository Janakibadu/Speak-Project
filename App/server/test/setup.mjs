import { afterAll } from 'vitest';
import { pool } from './helpers.mjs';

afterAll(async () => {
  await pool.end();
});
