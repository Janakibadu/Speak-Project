import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createRequire } from 'node:module';
import { afterEach, describe, expect, it } from 'vitest';
import mysql from 'mysql2/promise';
import { pool } from './helpers.mjs';

const require = createRequire(import.meta.url);
const { migrate, listMigrations } = require('../scripts/migrate.js');

describe('migration runner', () => {
  let tmpDir;

  afterEach(() => {
    if (tmpDir) fs.rmSync(tmpDir, { recursive: true, force: true });
    tmpDir = undefined;
  });

  it('records every migration it applied', async () => {
    const [rows] = await pool.query('SELECT name FROM schema_migrations ORDER BY name');
    expect(rows.map((r) => r.name)).toEqual(listMigrations());
  });

  it('applies nothing when run a second time', async () => {
    const connection = await mysql.createConnection({
      host: process.env.DB_HOST,
      port: Number(process.env.DB_PORT),
      user: process.env.DB_USER,
      password: process.env.DB_PASSWORD,
      database: process.env.DB_NAME,
      multipleStatements: true,
    });
    try {
      expect(await migrate(connection, { log: () => {} })).toEqual([]);
    } finally {
      await connection.end();
    }
  });

  it('only picks up NNN_name.sql files, in order', () => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'speak-migrations-'));
    for (const f of ['002_b.sql', '001_a.sql', 'notes.md', '3_bad.sql', '010_c.SQL']) {
      fs.writeFileSync(path.join(tmpDir, f), '');
    }
    expect(listMigrations(tmpDir)).toEqual(['001_a.sql', '002_b.sql']);
  });

  it('refuses two migrations with the same number', () => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'speak-migrations-'));
    fs.writeFileSync(path.join(tmpDir, '001_a.sql'), '');
    fs.writeFileSync(path.join(tmpDir, '001_b.sql'), '');
    expect(() => listMigrations(tmpDir)).toThrow(/share the number 001/);
  });
});
