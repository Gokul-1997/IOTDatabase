# Local Deployment Runbook — running the full stack on a customer server

> **INTERNAL.** This is the how-to for standing MEXA up locally. Code protection and
> licence enforcement are separate — see `ONPREM_INTERNAL_PLAYBOOK.md`.
> Customer-facing version is the published "MEXA On-Premise Deployment" document.

## 1. What the product actually is

MEXA is not one program. It is **six services**, and the local install fails if any one of
them is missed. This is the part that is easy to get wrong the first time.

| # | Service | Repo folder | Runtime | Port |
|---|---------|-------------|---------|------|
| 1 | MQTT broker | *(not in repo — Mosquitto)* | — | 1883 |
| 2 | Ingestion server | `pms-backend/` | Node, **ESM** (`node app.js`) | health 3001 |
| 3 | PostgreSQL | — | 16 | 5432 |
| 4 | Redis | — | 7 | 6379 |
| 5 | API server | `Backend/` | Node, **CommonJS** (`node src/server.js`) | 8000 |
| 6 | Web server | `FrontendIOT/dist` | Caddy | 443 |

Data path: **CNC control → MQTT → ingestion → Postgres + Redis → API → dashboards.**
Redis is not just a cache — it is the pub/sub channel that carries live machine state from
the ingestion server to the API's Socket.IO clients. Without it, dashboards go static.

**The two services use different env var names for the same database.** `Backend` reads
`POSTGRESQL_*`, `pms-backend` reads `DB_*`. Both must be set. This has bitten before.

---

## 2. Blockers to fix before any on-prem install

These are not optional. Two of them directly contradict what the customer document promises.

### 2.1 File uploads go to AWS S3

`Backend/src/upload/upload.controller.js:20` uploads to `process.env.AWS_S3_BUCKET` and
returns a public `https://<bucket>.s3.<region>.amazonaws.com/...` URL.

On-prem this fails outright on an air-gapped plant network, and where there *is* internet
it silently ships customer files out of the building — contradicting clause 5 of the
customer document.

**Fix: run MinIO in the stack.** It is S3-compatible, so the existing `@aws-sdk/client-s3`
code works with only an endpoint change:

```js
const s3 = new S3Client({
  region: process.env.AWS_REGION || 'us-east-1',
  endpoint: process.env.S3_ENDPOINT,              // http://minio:9000 on-prem
  forcePathStyle: !!process.env.S3_ENDPOINT,      // required for MinIO
  credentials: { accessKeyId: process.env.AWS_ACCESS_KEY,
                 secretAccessKey: process.env.AWS_SECRET_KEY },
});
```

and build the returned URL from a configurable public base rather than hardcoding the
amazonaws.com host. Leaving `S3_ENDPOINT` unset keeps the cloud deployment working exactly
as it does today.

### 2.2 Program transfer uses FTP

`Backend/src/programs/program.transfer.js:14` uses `basic-ftp`. On-prem this points at the
machine controls on the plant LAN, which is fine — but the host/credentials must become
per-install configuration, not anything baked in. Confirm at survey which controls expose
FTP and on which ports.

### 2.3 Timezone

`Backend/ecosystem.config.js` documents this at length: without `TZ=Asia/Kolkata` the
shift-start epoch lands 5.5 hours out and `adjusted_parts_count` reports the raw cumulative
counter instead of the shift value. **Set `TZ` on every container**, not just the API.

### 2.4 Single instance only

Same file: `instances: 1`. Each worker opens its own Redis subscriber, so every MQTT packet
gets processed by all workers. Do not scale either Node service horizontally until a
Socket.IO Redis adapter is in place.

---

## 3. Prerequisites on the target server

Docker Engine 24+ and the compose plugin. Nothing else — no Node, no Postgres, no Redis
installed on the host. That is the whole point of using containers here: the host stays a
plain Linux box and every version is pinned by us.

```bash
curl -fsSL https://get.docker.com | sh
sudo usermod -aG docker "$USER"     # log out and back in
docker --version && docker compose version
```

---

## 4. Layout

```
/opt/mexa/
├── docker-compose.yml
├── .env
├── mosquitto/
│   ├── mosquitto.conf
│   └── passwd
├── caddy/Caddyfile
├── backups/
└── frontend/            <- Angular dist, bind-mounted into Caddy
```

---

## 5. `.env`

Generate the secrets; never reuse them between customers.

```bash
cd /opt/mexa
cat > .env <<EOF
COMPANY_SLUG=acme
TZ=Asia/Kolkata

POSTGRES_DB=mexa
POSTGRES_USER=mexa
POSTGRES_PASSWORD=$(openssl rand -base64 24 | tr -d '/+=')

REDIS_PASSWORD=$(openssl rand -base64 24 | tr -d '/+=')
JWT_SECRET=$(openssl rand -base64 48 | tr -d '/+=')

MQTT_USER=mexa
MQTT_PASS=$(openssl rand -base64 18 | tr -d '/+=')

MINIO_ROOT_USER=mexa
MINIO_ROOT_PASSWORD=$(openssl rand -base64 24 | tr -d '/+=')

SERVER_IP=192.168.10.40
EOF
chmod 600 .env
```

Record `SERVER_IP` on the handover sheet — the `.exe` and the mobile app both need it.

---

## 6. `docker-compose.yml`

```yaml
name: mexa

x-common: &common
  restart: unless-stopped
  environment: &tz
    TZ: ${TZ}

services:
  postgres:
    <<: *common
    image: postgres:16-alpine
    environment:
      <<: *tz
      POSTGRES_DB: ${POSTGRES_DB}
      POSTGRES_USER: ${POSTGRES_USER}
      POSTGRES_PASSWORD: ${POSTGRES_PASSWORD}
    volumes:
      - pgdata:/var/lib/postgresql/data
    healthcheck:
      test: ["CMD-SHELL", "pg_isready -U ${POSTGRES_USER} -d ${POSTGRES_DB}"]
      interval: 10s
      timeout: 5s
      retries: 10

  redis:
    <<: *common
    image: redis:7-alpine
    command: ["redis-server", "--requirepass", "${REDIS_PASSWORD}", "--appendonly", "yes"]
    volumes:
      - redisdata:/data
    healthcheck:
      test: ["CMD", "redis-cli", "-a", "${REDIS_PASSWORD}", "ping"]
      interval: 10s
      timeout: 5s
      retries: 10

  mosquitto:
    <<: *common
    image: eclipse-mosquitto:2
    volumes:
      - ./mosquitto/mosquitto.conf:/mosquitto/config/mosquitto.conf:ro
      - ./mosquitto/passwd:/mosquitto/config/passwd:ro
      - mqttdata:/mosquitto/data
    ports:
      - "1883:1883"          # the CNC controls connect here

  minio:
    <<: *common
    image: minio/minio:latest
    command: server /data --console-address ":9001"
    environment:
      <<: *tz
      MINIO_ROOT_USER: ${MINIO_ROOT_USER}
      MINIO_ROOT_PASSWORD: ${MINIO_ROOT_PASSWORD}
    volumes:
      - miniodata:/data
    healthcheck:
      test: ["CMD", "mc", "ready", "local"]
      interval: 15s
      retries: 10

  ingestion:
    <<: *common
    build: ./pms-backend
    environment:
      <<: *tz
      DB_HOST: postgres
      DB_PORT: 5432
      DB_NAME: ${POSTGRES_DB}
      DB_USER: ${POSTGRES_USER}
      DB_PASSWORD: ${POSTGRES_PASSWORD}
      REDIS_HOST: redis
      REDIS_PORT: 6379
      REDIS_PASSWORD: ${REDIS_PASSWORD}
      MQTT_URL: mqtt://mosquitto:1883
      MQTT_USER: ${MQTT_USER}
      MQTT_PASS: ${MQTT_PASS}
      MQTT_CLIENT_ID: mexa-ingest-${COMPANY_SLUG}
      MQTT_LOG_DIR: /app/logs
      HEALTH_PORT: 3001
    volumes:
      - ./logs/ingestion:/app/logs
    depends_on:
      postgres: { condition: service_healthy }
      redis:    { condition: service_healthy }
      mosquitto: { condition: service_started }

  api:
    <<: *common
    build: ./Backend
    environment:
      <<: *tz
      NODE_ENV: production
      PORT: 8000
      APP_NAME: MEXA
      POSTGRESQL_HOST: postgres
      POSTGRESQL_PORT: 5432
      POSTGRESQL_DATABASE: ${POSTGRES_DB}
      POSTGRESQL_USER: ${POSTGRES_USER}
      POSTGRESQL_PASSWORD: ${POSTGRES_PASSWORD}
      REDIS_URL: redis://:${REDIS_PASSWORD}@redis:6379/0
      JWT_SECRET: ${JWT_SECRET}
      CORS_ORIGINS: https://${SERVER_IP},http://${SERVER_IP},app://localhost
      FRONTEND_URL: https://${SERVER_IP}
      S3_ENDPOINT: http://minio:9000
      AWS_REGION: us-east-1
      AWS_S3_BUCKET: mexa-uploads
      AWS_ACCESS_KEY: ${MINIO_ROOT_USER}
      AWS_SECRET_KEY: ${MINIO_ROOT_PASSWORD}
    volumes:
      - ./logs/api:/app/logs
    depends_on:
      postgres: { condition: service_healthy }
      redis:    { condition: service_healthy }
      minio:    { condition: service_healthy }

  caddy:
    <<: *common
    image: caddy:2-alpine
    ports:
      - "80:80"
      - "443:443"
    volumes:
      - ./caddy/Caddyfile:/etc/caddy/Caddyfile:ro
      - ./frontend:/srv:ro
      - caddydata:/data
    depends_on:
      - api

volumes:
  pgdata:
  redisdata:
  mqttdata:
  miniodata:
  caddydata:
```

`app://localhost` in `CORS_ORIGINS` is required — `FrontendIOT/electron/main.js` serves the
bundle over a custom `app://` protocol, so the Electron client's origin is not an http URL.
Omit it and the `.exe` gets CORS errors while the browser works fine.

### Dockerfiles

`Backend/Dockerfile` (plain build — the hardened one is §3 of the other playbook):

```dockerfile
FROM node:22.13.0-alpine
WORKDIR /app
RUN apk add --no-cache tzdata
COPY package*.json ./
RUN npm ci --omit=dev
COPY . .
EXPOSE 8000
CMD ["node", "src/server.js"]
```

`pms-backend/Dockerfile` — identical but `CMD ["node", "app.js"]`.

### `mosquitto/mosquitto.conf`

```
listener 1883
allow_anonymous false
password_file /mosquitto/config/passwd
persistence true
persistence_location /mosquitto/data/
```

```bash
docker run --rm -v ./mosquitto:/m eclipse-mosquitto:2 \
  mosquitto_passwd -c -b /m/passwd mexa 'THE_MQTT_PASS'
```

### `caddy/Caddyfile`

```
{$SERVER_IP} {
    tls internal
    handle /api/* { reverse_proxy api:8000 }
    handle /socket.io/* { reverse_proxy api:8000 }
    handle { root * /srv; try_files {path} /index.html; file_server }
}
```

`tls internal` issues a self-signed cert, which is right for a plant with no public DNS.
Give the customer's IT the Caddy root cert to trust, or browsers will warn on every visit.

---

## 7. Migrations

There is **no migration runner in the repo** — migrations have been applied by hand. That
does not survive multiple customers. Add `Backend/scripts/migrate.js`:

```js
const fs = require('fs'), path = require('path');
const db = require('../src/db');

const DIRS = [
  path.join(__dirname, '..', 'src', 'migrations'),                 // 001..011
  path.join(__dirname, '..', '..', 'pms-backend', 'migrations'),   // 001_phase1_multitenant
];

(async () => {
  await db.query(`CREATE TABLE IF NOT EXISTS schema_migrations (
    filename TEXT PRIMARY KEY, applied_at TIMESTAMPTZ NOT NULL DEFAULT now())`);

  for (const dir of DIRS) {
    const files = fs.readdirSync(dir).filter(f => f.endsWith('.sql')).sort();
    for (const f of files) {
      const key = `${path.basename(dir)}/${f}`;
      const { rowCount } = await db.query('SELECT 1 FROM schema_migrations WHERE filename=$1', [key]);
      if (rowCount) { console.log('skip', key); continue; }

      const sql = fs.readFileSync(path.join(dir, f), 'utf8');
      try {
        await db.query('BEGIN');
        await db.query(sql);
        await db.query('INSERT INTO schema_migrations(filename) VALUES ($1)', [key]);
        await db.query('COMMIT');
        console.log('applied', key);
      } catch (e) {
        await db.query('ROLLBACK');
        console.error('FAILED', key, e.message);
        process.exit(1);
      }
    }
  }
  console.log('migrations complete');
  process.exit(0);
})();
```

Run it once the database is healthy:

```bash
docker compose run --rm api node scripts/migrate.js
```

`003_clean_reset.sql` is destructive by name — read it before running against anything that
already holds data. It is fine on a fresh install and nowhere else.

---

## 8. Bring-up sequence

Order matters. Do not shortcut it.

```bash
cd /opt/mexa
docker compose up -d postgres redis mosquitto minio
docker compose ps                                    # wait for healthy

docker compose run --rm api node scripts/migrate.js

docker compose run --rm minio-init sh -c "true"      # or: mc mb local/mexa-uploads
docker compose up -d api ingestion caddy

docker compose logs -f --tail=50 api ingestion
```

Then seed the first company and admin. `Backend/scripts/create-users.js` exists — read it
before running, it was written for the cloud environment and may assume a company row is
already present.

---

## 9. Verification — do all of these before handover

```
[ ] curl -sk https://SERVER_IP/api/health            -> 200
[ ] curl -s  http://localhost:3001/                  -> ingestion health, mqtt connected:true
[ ] docker compose ps                                -> all six up, none restarting
[ ] publish a test MQTT message -> row appears in the machines telemetry table
[ ] browser on another PC reaches https://SERVER_IP and logs in
[ ] live dashboard updates without a refresh          <- proves Redis pub/sub works
[ ] .exe on a client PC connects and logs in          <- proves app:// CORS origin is right
[ ] mobile app on plant Wi-Fi connects
[ ] file upload succeeds and the returned URL resolves on the LAN  <- proves MinIO, not S3
[ ] shift boundary: part count resets correctly at shift change    <- proves TZ
[ ] reboot the server; everything comes back with no manual step
[ ] pg_dump runs, and a restore into a scratch DB actually works
```

The shift-boundary and reboot checks are the two most often skipped and the two that cause
the worst support calls.

---

## 10. Backup

```bash
cat > /opt/mexa/backup.sh <<'EOF'
#!/bin/bash
set -euo pipefail
cd /opt/mexa
source .env
STAMP=$(date +%F_%H%M)
docker compose exec -T postgres pg_dump -U "$POSTGRES_USER" "$POSTGRES_DB" \
  | gzip > "backups/mexa_${STAMP}.sql.gz"
find backups -name 'mexa_*.sql.gz' -mtime +14 -delete
EOF
chmod +x /opt/mexa/backup.sh
echo "30 1 * * * /opt/mexa/backup.sh" | crontab -
```

Point `backups/` at the customer's NAS mount, and **test a restore at handover** — an
untested backup is not a backup. Encrypt before it leaves the box if it lands on shared
storage.

---

## 11. What is still missing

Standing this up gets the product running locally. It does **not** yet give you a
sellable on-prem product. Still to build, in order:

1. Fix the S3 upload path (§2.1) — blocks the data-never-leaves promise
2. Migration runner (§7) — blocks repeatable installs
3. Licence enforcement — `ONPREM_INTERNAL_PLAYBOOK.md` §6
4. Licence server — same document, §5
5. Bytecode build + distroless image — same document, §2–3
6. VM image and first-boot wizard — same document, §4

Steps 1 and 2 are worth doing regardless of licensing, because both improve the cloud
deployment too.
