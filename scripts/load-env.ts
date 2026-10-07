// Loads .env for CLI scripts when present (Vercel/CI provide real env vars instead).
try {
  process.loadEnvFile('.env');
} catch {
  /* no .env file — fine */
}
