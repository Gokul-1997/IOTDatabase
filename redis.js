import { createClient } from 'redis';
import dotenv from 'dotenv';

dotenv.config();

export const redis = createClient({
  socket: {
    host: process.env.REDIS_HOST,
    port: Number(process.env.REDIS_PORT),
    // exponential backoff, capped at 5s — never give up
    reconnectStrategy: (retries) => Math.min(retries * 100, 5000),
    keepAlive: 15_000
  },
  password: process.env.REDIS_PASSWORD
});

redis.on('error',      err => console.error(JSON.stringify({ t: new Date().toISOString(), level: 'error', msg: 'redis error', error: err.message })));
redis.on('reconnecting', () => console.warn(JSON.stringify({ t: new Date().toISOString(), level: 'warn',  msg: 'redis reconnecting' })));
redis.on('ready',        () => console.log(JSON.stringify({ t: new Date().toISOString(), level: 'info',  msg: 'redis ready' })));
redis.on('end',          () => console.warn(JSON.stringify({ t: new Date().toISOString(), level: 'warn',  msg: 'redis connection closed' })));

await redis.connect();

console.log(JSON.stringify({ t: new Date().toISOString(), level: 'info', msg: 'redis connected' }));
