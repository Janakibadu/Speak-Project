import { createRequire } from 'node:module';
import mysql from 'mysql2/promise';
import { testEnv } from './testEnv.mjs';

const require = createRequire(import.meta.url);
const { migrate } = require('../scripts/migrate.js');

// Runs once per test run: fresh test database, migrated from zero.
export default async function setup() {
  const connection = await mysql.createConnection({
    host: testEnv.DB_HOST,
    port: Number(testEnv.DB_PORT),
    user: testEnv.DB_USER,
    password: testEnv.DB_PASSWORD,
    multipleStatements: true,
  });
  try {
    await connection.query(`DROP DATABASE IF EXISTS \`${testEnv.DB_NAME}\``);
    await connection.query(
      `CREATE DATABASE \`${testEnv.DB_NAME}\` CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci`
    );
    await connection.query(`USE \`${testEnv.DB_NAME}\``);
    await migrate(connection, { log: () => {} });
  } finally {
    await connection.end();
  }
}
