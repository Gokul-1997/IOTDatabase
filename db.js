import dotenv from 'dotenv';
dotenv.config();

import pkg from 'pg';
const { Pool } = pkg;

export const pool = new Pool({
  host: process.env.DB_HOST,
  port: Number(process.env.DB_PORT),
  database: process.env.DB_NAME,
  user: process.env.DB_USER,
  password: process.env.DB_PASSWORD,
  max: 30,                         // 50 machines + hourly workers + runtime-flush + API reads
  min: 4,
  idleTimeoutMillis: 30000,
  connectionTimeoutMillis: 5000,
  statement_timeout: 30000,
  application_name: 'mqtt-ingestion'
});

pool.on('error', (err, client) => {
  console.error('Unexpected DB connection error:', err);
  // Automatically removes the client
});

pool.on('connect', () => {
  console.log('📊 DB connection established');
});

// Monitor pool usage
if (process.env.DEBUG_POOL) {
  setInterval(() => {
    console.log(`📈 Pool status: ${pool.totalCount} total, ${pool.idleCount} idle, ${pool.waitingCount} waiting`);
  }, 30000);
}

export async function closePool() {
  try {
    await pool.end();
    console.log('✅ DB pool closed');
  } catch (err) {
    console.error('Error closing DB pool:', err.message);
  }
}