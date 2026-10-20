import pkg from 'pg';
const { Pool } = pkg;

// This creates a connection pool using your Neon connection string
const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: {
    rejectUnauthorized: false // Required for secure cloud connections like Neon
  }
});

export const query = (text, params) => pool.query(text, params);