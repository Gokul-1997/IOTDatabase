# On-Premise Delivery — Internal Playbook

> **INTERNAL ONLY. Never send this file to a customer.**
> Customer-facing version is the published "MEXA On-Premise Deployment" document.

Stack as built (verified 2026-08-19):
- Backend: Node 22 + Express 5, **plain JavaScript**, 120 files / ~10,600 LOC in `Backend/src`
- Postgres (`pg`), Redis (`ioredis`), Socket.IO, PM2 (`ecosystem.config.js`, single instance — Redis pub/sub is not multi-worker safe)
- Frontend: Angular prod build + Electron/NSIS Windows `.exe` (`FrontendIOT/electron/main.js`)
- Mobile: React Native
- Licensing groundwork already in DB: `plans`, `company_plans(expires_at, max_users, max_plants, max_machines)` — **currently unenforced anywhere in code**

---

## 1. The honest constraint

Code that runs on hardware the customer controls can always be recovered by someone
determined and skilled. There is no "fully encrypted, undecryptable" JavaScript. Anyone
who promises that is selling obfuscation and calling it encryption.

What is achievable is **raising cost above value**: make recovering the code more
expensive than paying the subscription, and back it with a contract. That is how every
on-prem vendor actually operates.

Protection ladder, honestly rated:

| # | Method | Breaks in | Verdict |
|---|--------|-----------|---------|
| 0 | Plain JS on their disk | seconds | Never do this |
| 1 | Minify / bundle | minutes | Cosmetic |
| 2 | `javascript-obfuscator` | hours–days | Stops casual reading |
| 3 | `bytenode` → V8 `.jsc` bytecode | days, needs V8 skill | Stops ~99% of real-world attempts |
| 4 | Distroless container, no shell | + physical/root work | Strong |
| 5 | Sealed VM appliance on their hypervisor, LUKS, no customer shell | expert + guest-disk attack | **Recommended for on-prem** |
| 6 | Thin edge collector; all IP stays in our cloud | impossible | **Recommended long-term** |

Ship **2 + 3 + 4 + 5** together — see §4 for why level 5 is a virtual appliance and not
a box we ship. Level 6 is the strategic answer once we have more on-prem customers than
we can hand-hold.

---

## 2. Build pipeline (levels 2 + 3)

```bash
cd Backend
npm i -D bytenode javascript-obfuscator
```

`Backend/build/protect.js`:

```js
// Obfuscate -> compile to V8 bytecode -> emit dist/ containing only .jsc
const fs   = require('fs');
const path = require('path');
const obf  = require('javascript-obfuscator');
const bytenode = require('bytenode');

const SRC = path.join(__dirname, '..', 'src');
const OUT = path.join(__dirname, '..', 'dist');

// Hot paths: obfuscate lightly. controlFlowFlattening costs 5-10x CPU and these
// run on every MQTT packet / socket emit.
const HOT = ['lib/realtime.js', 'lib/oee.js', 'redis.js', 'db.js'];

const heavy = {
  compact: true, controlFlowFlattening: true, controlFlowFlatteningThreshold: 0.6,
  deadCodeInjection: true, deadCodeInjectionThreshold: 0.2,
  stringArray: true, stringArrayEncoding: ['rc4'], stringArrayThreshold: 0.8,
  identifierNamesGenerator: 'mangled-shuffled', selfDefending: true,
  numbersToExpressions: true, simplify: true,
};
const light = {
  compact: true, controlFlowFlattening: false, deadCodeInjection: false,
  stringArray: true, stringArrayEncoding: ['base64'], stringArrayThreshold: 0.5,
  identifierNamesGenerator: 'mangled', simplify: true,
};

function walk(dir, out = []) {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    e.isDirectory() ? walk(p, out) : e.name.endsWith('.js') && out.push(p);
  }
  return out;
}

fs.rmSync(OUT, { recursive: true, force: true });

for (const file of walk(SRC)) {
  const rel  = path.relative(SRC, file);
  const dest = path.join(OUT, rel);
  fs.mkdirSync(path.dirname(dest), { recursive: true });

  const opts = HOT.includes(rel.split(path.sep).join('/')) ? light : heavy;
  const code = obf.obfuscate(fs.readFileSync(file, 'utf8'), opts).getObfuscatedCode();

  const tmp = dest + '.tmp.js';
  fs.writeFileSync(tmp, code);
  bytenode.compileFile({ filename: tmp, output: dest + 'c' }); // -> .jsc
  fs.unlinkSync(tmp);
  console.log('->', rel + 'c');
}

// SQL migrations and swagger yaml are not IP worth protecting; copy as-is.
console.log('done. entrypoint: node loader.js');
```

`Backend/loader.js` — the only plaintext JS we ship:

```js
require('bytenode');
require('dotenv').config({ quiet: true });
require('./dist/server.jsc');
```

**Two hard requirements for `.jsc`:**

1. Bytecode is tied to the exact V8 version. A `.jsc` built on Node 22.13.0 will not
   load on Node 22.14. **We must ship our own Node runtime** — which is why the
   delivery unit is a container image, never a folder of files.
2. `require('./foo')` inside compiled code must resolve to `foo.jsc`. `bytenode`'s
   module hook handles this, but relative requires that omit the extension are safest —
   audit for any `require('./x.js')` with an explicit extension before the first build.

Do **not** obfuscate `node_modules`. It is public open-source, it doubles build time,
and `selfDefending` on third-party code causes runtime breakage.

Before every release: `npm test` against `dist/` (not `src/`) with `NODE_ENV=production`.
Obfuscation bugs surface as `undefined is not a function` deep in a request path.

---

## 3. Delivery unit — sealed distroless image (level 4)

`Backend/Dockerfile.onprem`:

```dockerfile
# ---------- builder: has source, never shipped ----------
FROM node:22.13.0-bookworm-slim AS builder
WORKDIR /app
COPY package*.json ./
RUN npm ci
COPY . .
RUN node build/protect.js && npm prune --omit=dev

# ---------- runtime: no shell, no package manager, no source ----------
FROM gcr.io/distroless/nodejs22-debian12
WORKDIR /app
COPY --from=builder /app/node_modules ./node_modules
COPY --from=builder /app/dist        ./dist
COPY --from=builder /app/loader.js   ./loader.js
COPY --from=builder /app/src/migrations ./migrations
ENV NODE_ENV=production TZ=Asia/Kolkata
USER nonroot
EXPOSE 8000
CMD ["loader.js"]
```

Distroless has **no `/bin/sh`**, so `docker exec -it ... sh` fails. Combined with no
customer root on the host, casual poking is closed off.

Delivery: `docker save` to an encrypted tar handed over on site, or a private registry
with a per-customer read-only pull token. **Never** a public registry.

Drop PM2 for on-prem — Docker's `restart: unless-stopped` plus the healthcheck replaces
it, and PM2 would need a shell.

---

## 4. Delivery unit for a customer-owned server — the virtual appliance

The requirement is now: **every customer runs the backend on their own internal server,
and the frontend is our Windows `.exe`.** That is a different problem from a box we own,
and it changes the correct answer.

Do **not** ship an installer that unpacks onto their bare metal. Fifty customers means
fifty bespoke installs, fifty OS variants, fifty support surfaces — and our container
sitting on a host where their admin has root.

**Ship a virtual appliance image.** Every factory that has an "internal local server"
already runs VMware ESXi, Hyper-V or Proxmox. We build one hardened Linux VM, export it,
and they import it.

| | Bare install on their server | **Virtual appliance (OVA / VHDX)** |
|---|---|---|
| Builds to maintain | One per OS they happen to run | **One image, all customers** |
| Their admin can reach our stack | Yes, trivially | Only by attacking the guest disk |
| We hold root inside | No | **Yes — inside the VM** |
| Their backup/DR tooling works | Separate setup | **Snapshots it like any other VM** |
| Rollback a bad update | Manual | **Revert snapshot** |
| Install time | Half a day | **~30 minutes** |

They control the hypervisor and the hardware, which is what they actually asked for. We
control everything inside the guest, which is what we need. This is exactly how Veeam,
GitLab, Nagios and every other on-prem vendor ships.

### 4.1 Building the image

```
Ubuntu Server 24.04 LTS, minimal
├── LUKS on the data partition (key sealed in the image, not customer-visible)
├── docker + compose plugin
├── /opt/mexa/docker-compose.yml   app (distroless, §3) · postgres · redis · caddy
├── our SSH key only; password auth off; PermitRootLogin no
├── no customer shell account — first-boot console offers a setup menu, not a prompt
├── ufw: 443 in, 22 in from our IPs, all else denied
└── first-boot: regenerate machine-id + host keys, expand disk, run setup wizard
```

Export: `OVA` for VMware/VirtualBox, `VHDX` for Hyper-V. Ship both — building the second
is one `qemu-img convert`.

**Regenerating `/etc/machine-id` on first boot is not optional.** Ship it baked in and
every customer's fingerprint is identical, so one leaked licence unlocks all of them.

### 4.2 The first-boot console wizard

Their IT sees a menu, never a shell:

```
  MEXA Appliance — Initial Setup

  1. Network (static IP / DNS / gateway)     [ 192.168.10.40  set ]
  2. Hostname                                [ mexa-plant1    set ]
  3. Activate licence                        [ NOT ACTIVATED     ]
  4. Backup destination                      [ not configured    ]
  5. Show diagnostics / support bundle
  6. Reboot

  Web UI will be available at https://192.168.10.40 once activated.
```

Written as a tiny Node script on the serial/tty console. This is what keeps the install
repeatable across fifty sites, and it is where the licence key gets entered.

### 4.3 Minimum spec to put in the quote

| | Requirement |
|---|---|
| vCPU | 4 (8 for >40 machines) |
| RAM | 8 GB (16 GB for >40 machines) |
| Disk | 250 GB thin-provisioned; ~1.5 GB per machine per year of history |
| Hypervisor | ESXi 7+, Hyper-V on Server 2019+, or Proxmox 8+ |
| Network | One static IP on the plant VLAN, reachable from the CNC controls |
| Outbound | HTTPS 443 to `license.stmcnc.com` (or an air-gap licence, §6.7) |

### 4.4 If they refuse a VM

Some sites genuinely have no hypervisor. Fallback, in order of preference:

1. **We supply a mini-PC** running the same image (~₹40k, and we hold root).
2. **Docker Compose on a Linux host they provide.** Acceptable. Their root can reach our
   container, so lean harder on §3 bytecode + distroless and on the contract in §8.
3. **Bare install on Windows Server.** Refuse. Docker Desktop licensing on Server is a
   trap and WSL2 under a factory's patch regime will page us at 2am.

Whichever fallback applies, record the chosen protection level on the order — it is the
difference between "sealed" and "trusted customer", and pricing should reflect it.
## 5. The licence server — the piece that does not exist yet

Everything in §6 is client-side verification. None of it works across many customers
without a service on our side that issues, tracks, renews and revokes. Build this first;
it is the operational backbone, not an add-on.

Small standalone Node service, its own tiny Postgres. **Do not** put it in the product
repo and **do not** host it on the same box as anything a customer can reach.

### 5.1 Data model

```sql
CREATE TABLE customers (
  id            SERIAL PRIMARY KEY,
  name          TEXT NOT NULL,
  contact_email TEXT,
  created_at    TIMESTAMPTZ DEFAULT now()
);

CREATE TABLE licences (
  id             SERIAL PRIMARY KEY,
  lic_id         TEXT UNIQUE NOT NULL,     -- STM-ONP-2026-0042
  licence_key    TEXT UNIQUE NOT NULL,     -- STMX-4K2P-9WQ7-M3ND (what we hand over)
  customer_id    INT REFERENCES customers(id),
  site_label     TEXT,                     -- 'Plant 1 - Coimbatore'
  plan           TEXT NOT NULL,
  valid_from     TIMESTAMPTZ NOT NULL,
  valid_until    TIMESTAMPTZ NOT NULL,
  max_machines   INT NOT NULL,
  max_users      INT NOT NULL,
  max_plants     INT NOT NULL DEFAULT 1,
  features       JSONB NOT NULL DEFAULT '[]',
  offline_mode   BOOLEAN NOT NULL DEFAULT FALSE,  -- air-gapped site, no heartbeat
  fingerprint    JSONB,                    -- NULL until first activation
  activated_at   TIMESTAMPTZ,
  transfers_used INT NOT NULL DEFAULT 0,
  transfers_max  INT NOT NULL DEFAULT 2,
  revoked_at     TIMESTAMPTZ,
  revoke_reason  TEXT
);

CREATE TABLE heartbeats (
  id           BIGSERIAL PRIMARY KEY,
  lic_id       TEXT NOT NULL,
  at           TIMESTAMPTZ NOT NULL DEFAULT now(),
  app_version  TEXT,
  machine_count INT,
  user_count   INT,
  ip           INET
);
CREATE INDEX ON heartbeats (lic_id, at DESC);
```

`heartbeats` is worth more than it looks: it is the only view we get of fifty sites. A
site that stops reporting is either down, offline, or has had the licence check removed —
all three are things we want to know within a day.

### 5.2 Licence key format

What we hand the customer is a short key, **not** the licence file. Crockford base32,
grouped, with a check character:

```
STMX-4K2P-9WQ7-M3ND
```

Crockford maps `I/L` → `1` and `O` → `0`, which matters because this key gets read over
the phone to a factory in a noisy machine shop. Generate from a CSPRNG; never sequential.

### 5.3 Activation — online

```
POST /v1/activate
  { key, fingerprint: {machineId, boardUuid, mac}, hostname, app_version }
```

Server logic, in order — every check matters:

1. Key exists, not revoked, `valid_until` in the future → else `410 LICENCE_INVALID`
2. `fingerprint IS NULL` → first activation: bind it, stamp `activated_at`
3. `fingerprint` set and matches 2-of-3 → re-issue (reinstall, snapshot restore). Fine
4. `fingerprint` set and does **not** match → `409 ALREADY_ACTIVATED`, return the bound
   hostname and activation date so support can see what happened at a glance
5. Sign and return the licence file (§6.2)

Step 4 is the whole anti-piracy mechanism. A copied VM lands there, and the customer has
to call us — which is the correct outcome, because sometimes it is a legitimate hardware
migration and we approve it.

### 5.4 Transfers — build this or drown in support calls

Disks fail, hypervisors get replaced, VMs get migrated. Without a transfer path every one
of those is an emergency call.

```
POST /v1/transfer   (portal, authenticated)   { lic_id, reason }
  -> clears fingerprint, transfers_used += 1, logs who approved it
```

Two free transfers per term, self-service from the portal for our support staff. Beyond
that it needs a manager. Log the reason every time — the pattern tells you whether a
customer has flaky hardware or is trying something.

### 5.5 Heartbeat

```
POST /v1/heartbeat
  { lic_id, fingerprint, app_version, machine_count, user_count }
  -> { lease_until, licence?: <fresh signed file if the term changed> }
```

The response is where renewal lands automatically. Payment clears → we extend
`valid_until` in the portal → the site picks it up within six hours with nobody touching
anything. That single behaviour removes almost all renewal friction.

Reject a heartbeat whose fingerprint no longer matches — that is a clone running beside
the original.

### 5.6 Activation — offline / air-gapped

Plenty of plant VLANs have no route to the internet. This path is not an edge case; build
it at the same time as the online one.

1. Wizard prints a **request code**: `base64(key + fingerprint + nonce)`, ~120 chars,
   also rendered as a QR so it can be photographed rather than transcribed
2. Their IT emails it, or reads it to us
3. Portal → *Issue offline licence* → paste code → returns a `.lic` file
4. They copy it in on a USB stick and upload it in the wizard or the web UI

Offline licences are issued with `offline_mode = true`: no heartbeat required, the term
is enforced by the signed dates plus clock-tamper detection alone. Price them higher and
keep the terms shorter — we lose all visibility, so shorten the blast radius.

### 5.7 Portal

An internal-only UI. It does not need to be pretty; it needs to exist before customer
number three.

- Customers and their licences, with days-remaining and last-heartbeat columns
- Issue · renew · extend · revoke · transfer
- A "sites needing attention" view: no heartbeat in 48h, expiring in 30 days, over limits
- Full audit log of who issued or changed what

Everything a support engineer might otherwise do by hand-editing a database row should be
a button here. Hand-edited licences are how a customer ends up with a 99-year term.
## 6. Licence enforcement inside the product

Use Ed25519 via Node's built-in `crypto` — no dependency, small signatures, fast.
Private key lives on the build machine only (ideally offline / in a password manager
with an offline backup). Public key is embedded in the compiled bytecode.

### 6.1 Keygen (once, ever)

```js
const { generateKeyPairSync } = require('crypto');
const { publicKey, privateKey } = generateKeyPairSync('ed25519');
console.log(publicKey.export({ type: 'spki',  format: 'pem' }));   // -> embed in code
console.log(privateKey.export({ type: 'pkcs8', format: 'pem' }));  // -> vault, offline
```

### 6.2 Licence payload

```json
{
  "lic_id": "STM-ONP-2026-0042",
  "customer": "Acme Precision Pvt Ltd",
  "company_id": 12,
  "plan": "gold",
  "issued_at": "2026-08-19T00:00:00Z",
  "valid_from": "2026-08-25T00:00:00Z",
  "valid_until": "2026-11-25T18:29:59Z",
  "grace_days": 7,
  "readonly_days": 23,
  "limits":   { "max_machines": 25, "max_users": 15, "max_plants": 2 },
  "features": ["oee", "reports", "program-transfer", "mobile", "alarms"],
  "fingerprint": "sha256:ab12cd...",
  "heartbeat_url": "https://license.stmcnc.com/v1/heartbeat",
  "offline_tolerance_days": 14
}
```

Emitted as `license.lic` = `base64(payload) + "." + base64(ed25519 signature)`.

### 6.3 Machine fingerprint

Bind the licence to the box so the appliance cannot be cloned. Use **three** signals and
require any 2 of 3 to match, so a NIC swap or disk clone does not brick a live factory:

```js
// dist/license/fingerprint.js
const { execFileSync } = require('child_process');
const { createHash } = require('crypto');
const os = require('os');

const safe = fn => { try { return fn() || ''; } catch { return ''; } };

function signals() {
  return {
    machineId: safe(() => require('fs').readFileSync('/etc/machine-id', 'utf8').trim()),
    boardUuid: safe(() => execFileSync('cat', ['/sys/class/dmi/id/product_uuid'], { encoding: 'utf8' }).trim()),
    mac: safe(() => Object.values(os.networkInterfaces()).flat()
      .filter(i => i && !i.internal && i.mac !== '00:00:00:00:00:00')
      .map(i => i.mac).sort()[0]),
  };
}

const h = v => createHash('sha256').update(String(v)).digest('hex').slice(0, 16);

function fingerprintParts() {
  const s = signals();
  return { machineId: h(s.machineId), boardUuid: h(s.boardUuid), mac: h(s.mac) };
}

// 2-of-3 match tolerates a replaced NIC or a re-imaged OS, blocks a wholesale clone.
function matches(issued) {
  const now = fingerprintParts();
  const hits = Object.keys(issued).filter(k => issued[k] && issued[k] === now[k]).length;
  return { ok: hits >= 2, hits };
}

module.exports = { fingerprintParts, matches };
```

Ship a tiny `fingerprint` utility the customer's IT can run pre-install, so we can mint
the licence before we arrive on site.

### 6.4 Verification + state machine

```js
// dist/license/verify.js
const { verify, createHash } = require('crypto');
const fs = require('fs');
const { matches } = require('./fingerprint');

const PUBKEY = `-----BEGIN PUBLIC KEY-----
...embedded at build time...
-----END PUBLIC KEY-----`;

// States, worst to best. Data collection NEVER stops in any state.
const STATE = { VALID: 'valid', EXPIRING: 'expiring', GRACE: 'grace',
                READONLY: 'readonly', LOCKED: 'locked', INVALID: 'invalid' };

function parse(file) {
  const [b64, sig] = fs.readFileSync(file, 'utf8').trim().split('.');
  const payload = Buffer.from(b64, 'base64');
  if (!verify(null, payload, PUBKEY, Buffer.from(sig, 'base64'))) return null;
  return JSON.parse(payload.toString('utf8'));
}

function evaluate(lic, now = new Date()) {
  if (!lic) return { state: STATE.INVALID, reason: 'Licence signature is not valid.' };

  const fp = matches(lic.fingerprint);
  if (!fp.ok) return { state: STATE.INVALID, reason: 'Licence is issued to different hardware.' };

  const until = new Date(lic.valid_until);
  if (now < new Date(lic.valid_from))
    return { state: STATE.INVALID, reason: 'Licence is not active yet.' };

  const days = Math.floor((now - until) / 86400000);
  if (days < 0)  return { state: days > -30 ? STATE.VALID : STATE.VALID, daysLeft: -days };
  if (days < lic.grace_days)                        return { state: STATE.GRACE,    daysOver: days };
  if (days < lic.grace_days + lic.readonly_days)    return { state: STATE.READONLY, daysOver: days };
  return { state: STATE.LOCKED, daysOver: days };
}

module.exports = { parse, evaluate, STATE };
```

### 6.5 Enforcement points — several, so removing one is not enough

| Where | Behaviour |
|-------|-----------|
| `loader.js` boot | `INVALID` → log and refuse to start. Expired states still boot (a factory must not lose its dashboard to a paperwork delay) |
| Express middleware in `app.js` | Re-evaluates from a 5-min cache. `READONLY` → 402 on every non-GET except `/auth/*` and `/license/*`. `LOCKED` → 402 on everything except those two |
| Ingestion path (`lib/realtime.js`) | **Never gated.** Machine telemetry keeps writing in every state |
| Limit checks | `max_machines` / `max_users` / `max_plants` enforced on create — wire into the existing `company_plans` reads rather than a parallel system |
| `node-cron` job, every 6 h | Heartbeat POST; on success stores a fresh signed lease. No contact for `offline_tolerance_days` → step down one state |
| Clock-tamper check | Monotonic `last_seen_at` in DB **and** a signed file on disk. System clock earlier than the greater of the two by >2 h → treat as `INVALID` with reason "system clock" |

Middleware sketch:

```js
// dist/license/middleware.js
const { parse, evaluate, STATE } = require('./verify');
const LIC = process.env.LICENSE_FILE || '/etc/stm/license.lic';

let cache = { at: 0, result: null };
function current() {
  if (Date.now() - cache.at < 5 * 60_000) return cache.result;
  cache = { at: Date.now(), result: evaluate(parse(LIC)) };
  return cache.result;
}

const ALWAYS = [/^\/api\/auth\//, /^\/api\/license\//, /^\/api\/health$/];

module.exports = function licenceGate(req, res, next) {
  const { state, reason, daysOver } = current();
  res.set('X-Licence-State', state);

  if (ALWAYS.some(re => re.test(req.path))) return next();

  if (state === STATE.INVALID || state === STATE.LOCKED)
    return res.status(402).json({ error: 'LICENCE_BLOCKED', state, reason });

  if (state === STATE.READONLY && req.method !== 'GET')
    return res.status(402).json({
      error: 'LICENCE_READONLY', state, daysOver,
      message: 'Subscription has lapsed. Viewing and data collection continue; changes are paused until renewal.',
    });

  next();
};
```

Mount it in `app.js` **after** auth, **before** the feature routers, so the 402 carries
a known user for the audit log.

Frontend: read `X-Licence-State` in the existing HTTP interceptor and render the banner
from it. Never rely on the frontend for enforcement — it is a courtesy, not a gate.

### 6.6 Lifecycle — never hard-kill a running factory

| Day | State | What the customer sees |
|-----|-------|------------------------|
| −30 | `VALID` | Dismissible banner: renewal date |
| −7  | `VALID` | Persistent banner + daily mail to their admin and to us |
| 0   | `GRACE` | Full function, red banner, 7 days |
| +7  | `READONLY` | Dashboards, live data and history all work. No edits, no exports, no config |
| +30 | `LOCKED` | Login + licence-upload page only. **Collection still running, buffered** |
| ever | — | **No data is deleted, throttled or withheld.** It is their production data |

That last row is not generosity — deleting a factory's OEE history over a billing gap is
how a vendor gets sued and blacklisted. Buffer, don't drop.

### 6.7 Renewal

1. Payment clears → mint a new `license.lic` against the same fingerprint
2. Either the 6-hourly heartbeat pulls it automatically, or the customer uploads it at
   **Super Admin → Licence**
3. Cache invalidates in ≤5 min. No redeploy, no restart, no site visit

Keep an `issued_licences` table on our side: `lic_id`, `company_id`, fingerprint, window,
who signed it, and the revocation flag. Without it, renewals become guesswork by year two.

---

## 7. The Windows `.exe` — it is a client, never a licence holder

This is the single most important design rule in the whole system, so it gets its own
section.

**The `.exe` holds no licence and enforces nothing.** It connects to the customer's
backend and renders what it is told. Everything else follows from that.

Why it must be this way: the `.exe` is Electron. `npx asar extract app.asar` and it is
open — `asar: true` and integrity checks stop file swapping, not reading. If the licence
lived in the `.exe`, a customer copies it to forty PCs and we have no seat control at
all. Put the licence on the backend and the number of `.exe` installs stops mattering:
seats are enforced as **named user accounts in the database**, which is both easy to
enforce and easy to defend commercially.

Anyone who patches the licence check out of the `.exe` gains nothing, because the backend
still answers `402`.

### 7.1 One build for every customer — not one per site

Do not bake the server URL in at build time. Forty customers becomes forty builds and
forty release pipelines, and every backend IP change becomes a rebuild.

`FrontendIOT/electron/main.js` currently hardcodes the app protocol and loads the bundle
directly. Add a first-run setup step in front of it:

```js
// electron/config.js
const { app } = require('electron');
const fs = require('fs');
const path = require('path');

const FILE = path.join(app.getPath('userData'), 'server.json');

// Precedence: IT-deployed machine-wide config > per-user setup > first-run prompt.
const MACHINE = process.platform === 'win32'
  ? path.join(process.env.ProgramData || 'C:\\ProgramData', 'MEXA', 'server.json')
  : '/etc/mexa/server.json';

function read() {
  for (const f of [MACHINE, FILE]) {
    try { return JSON.parse(fs.readFileSync(f, 'utf8')); } catch {}
  }
  return null;
}

const save = cfg => fs.writeFileSync(FILE, JSON.stringify(cfg, null, 2));

module.exports = { read, save };
```

First run with no config → show a small setup window asking for the server address, test
`GET /api/health`, then save. Their IT can skip it entirely by dropping
`C:\ProgramData\MEXA\server.json` via GPO before rollout — which is how a forty-seat
install actually gets done.

### 7.2 Surfacing licence state

The backend already returns `X-Licence-State` on every response (§6.5). In the Angular
HTTP interceptor, read it and drive one banner component. Handle `402` centrally too:
route to the licence page with the `reason` from the body rather than letting forty
different components each render their own error.

States the UI must render: `expiring` (days left), `grace`, `readonly` (and disable
create/edit controls, don't just let them fail), `locked`.

### 7.3 Build hygiene

- Set `"sourceMap": false` explicitly in the `production` block of `angular.json`. The
  builder defaults to it, but state it so a future upgrade cannot silently flip it
- Keep **all** OEE maths, shift-window logic and thresholds server-side. Verified already
  true — `pages/oee-reports/oee.service.ts` only calls the API. A formula shipped to the
  browser is a formula published
- Strip the commented-out cloud URLs from `src/environments/environment.ts`. An on-prem
  build must contain no reference to `stmapi.stmcnc.com`, or a lapsed site can silently
  fail over to our production API
- Sign the installer. An unsigned `.exe` will be blocked by SmartScreen and by any
  customer running application allowlisting, and that becomes our support call

### 7.4 Mobile

Same rule: no licence, points at the customer's backend, needs LAN or VPN reach. Confirm
at survey time — it is the requirement most often discovered on day 4 of a 5-day install.
## 8. The layer that actually protects us

Technical measures buy time; the contract is what makes the time worth having.

- Licence agreement granting **use**, not ownership. No decompilation, no
  reverse-engineering, no redistribution, named liquidated damages
- Source code and database schema named as our confidential information
- Our right to audit the appliance on notice
- Tamper voids the warranty and terminates the licence
- Escrow, if a large customer demands continuity — release triggered only by our
  insolvency or discontinuation. This closes deals and concedes nothing real

Get this signed **before** the appliance ships, not at handover.

---

## 9. Build and release checklist

**Per release (once):**

```
[ ] npm test on src/ passes
[ ] node build/protect.js
[ ] npm test against dist/ passes with NODE_ENV=production
[ ] grep -r "\.js$" dist/  -> no surviving plaintext JS
[ ] strings dist/*.jsc | grep -iE 'secret|password|BEGIN .*PRIVATE'  -> empty
[ ] docker build -f Dockerfile.onprem
[ ] confirm `docker exec <img> sh` fails (distroless)
[ ] Angular prod build; no .map files in dist/; no stmcnc.com URLs in the bundle
[ ] .exe built, signed, SmartScreen-clean, first-run setup tested with no config present
[ ] VM appliance image rebuilt, exported to OVA + VHDX, both imported and booted once
[ ] first-boot regenerates machine-id and SSH host keys  <- verify every single release
[ ] upgrade tested from the previous image, not just a clean install
```

**Per customer (every site):**

```
[ ] licence key generated in the portal, customer + site recorded
[ ] signed licence agreement on file BEFORE the image ships
[ ] survey done: machine list, control types, static IP, VPN need, backup destination
[ ] image imported, wizard completed, activation confirmed in the portal
[ ] heartbeat visible in the portal within 6 h
[ ] backup job configured AND a restore actually tested
[ ] .exe rolled out; machine-wide server.json deployed if their IT uses GPO
[ ] handover sheet: lic_id, term dates, IP, backup location, support contacts
[ ] LUKS passphrase + VM credentials escrowed internally, never given to the customer
```

## 10. Where this goes next

Two on-prem sites is manageable. Ten is not: every one is a bespoke box, a LUKS
passphrase and a site visit. Plan the **edge collector** now — a ~500-LOC local agent
that only speaks to the machines and buffers to our cloud, with zero business logic on
site. Then IP protection stops being a build pipeline and becomes a fact of the
architecture, and licensing collapses into a flag in our own database.
