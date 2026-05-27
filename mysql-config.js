// MySQL connection config — set credentials via environment variables, never hardcode them.
// Copy .env.example to .env and fill in your values before running locally.
module.exports = {
  host:            process.env.DB_HOST     || 'localhost',
  user:            process.env.DB_USER,
  password:        process.env.DB_PASSWORD,
  database:        process.env.DB_NAME     || 'MazeRaceBingoStates',
  port:            parseInt(process.env.DB_PORT || '3306', 10),
  connectionLimit: parseInt(process.env.DB_POOL_SIZE || '1', 10)
};
