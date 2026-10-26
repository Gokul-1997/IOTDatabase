import { readFileSync } from 'node:fs';
// Explicit opt-in preserves existing installations. The Phase 3 installer
// requires this for its external database; certificate verification stays on.
export function databaseTls(env = process.env) {
  if (!env.DB_SSL || env.DB_SSL === 'false') return false;
  if (env.DB_SSL !== 'true') throw new Error('DB_SSL must be true or false');
  return { rejectUnauthorized: true, ...(env.DB_SSL_CA_FILE ? { ca: readFileSync(env.DB_SSL_CA_FILE, 'utf8') } : {}) };
}

export function redisTls(env = process.env) {
  if (!env.REDIS_TLS || env.REDIS_TLS === 'false') return {};
  if (env.REDIS_TLS !== 'true') throw new Error('REDIS_TLS must be true or false');
  return { tls: true, rejectUnauthorized: true, ...(env.REDIS_CA_FILE ? { ca: [readFileSync(env.REDIS_CA_FILE, 'utf8')] } : {}) };
}
