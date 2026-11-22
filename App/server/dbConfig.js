const REQUIRED_IN_PRODUCTION = ['DB_HOST', 'DB_USER', 'DB_PASSWORD', 'DB_NAME'];

// Connection settings shared by the app pool and the migration runner.
// The fallbacks are for local development only: in production a missing
// variable is an error, named but never printed with its value (NFR14).
function dbConfig() {
  if (process.env.NODE_ENV === 'production') {
    const missing = REQUIRED_IN_PRODUCTION.filter((name) => !process.env[name]);
    if (missing.length > 0) {
      throw new Error(`Missing required environment variable(s): ${missing.join(', ')}`);
    }
  }
  return {
    host: process.env.DB_HOST || '127.0.0.1',
    port: Number(process.env.DB_PORT) || 3306,
    user: process.env.DB_USER || 'speak_app',
    password: process.env.DB_PASSWORD || 'speak_app_pw',
    database: process.env.DB_NAME || 'speak',
  };
}

module.exports = dbConfig;
