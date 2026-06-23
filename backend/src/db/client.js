// Shared Postgres connection pool used by routes, queries, and ingest.
import pg from 'pg';
import dotenv from 'dotenv';
dotenv.config();

const { Pool } = pg;

export const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: { rejectUnauthorized: false }, // Required for Supabase/managed Postgres over SSL.
  connectionTimeoutMillis: 10000, // Fail fast instead of hanging on bad credentials.
});
