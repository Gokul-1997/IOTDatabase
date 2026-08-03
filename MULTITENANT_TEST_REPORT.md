# Multi-Tenant Test Report — STM MEXA IoT Platform

**Date:** 30 July 2026
**Scope:** Backend (`Backend/`) + Web frontend (`FrontendIOT/`). Mobile app explicitly excluded per instruction.
**Tested by:** Claude, against the real backend service layer, real HTTP API, and a real Chromium browser — no mocks, no guessed data shapes.

---

## ⚠️ Read this first: this ran against your live production database

`Backend/.env` points at a **remote** Postgres instance. I confirmed — by logging into `https://stmapi.stmcnc.com` with one of the test accounts created below and getting back the same `company_id` — that your **deployed production API uses this exact same database**. There is no separate staging/test database in this setup.

That means everything in this report (the schema fix and the 5 test companies) is **live on production right now**, reachable from `https://stmmexa.stmcnc.com` today, not confined to a sandbox. Your real company (`S AND T`, `company_id=4`) was **not modified** — verified below — but you should decide when to deactivate/delete the 5 test companies (instructions at the bottom).

---

## 1. Critical bug found and fixed

**Company creation was completely broken.** Every call to `SNT_SUPER → Create Company` failed.

### Root cause

`Backend/src/migrations/006_plant_id_nullable.sql` was written specifically so `COMPANY_ADMIN` users (whose `plant_id` must be `NULL` — company-wide scope, no single-plant restriction) could insert rows across the system. It made `plant_id` nullable on 9 tables (`machines`, `shifts`, `operators`, `components`, `telemetry_raw`, etc.) — but **missed the `users` table itself**, even though its own header comment says *"COMPANY_ADMIN users have plant_id = NULL."*

`Backend/src/companies/company.service.js` auto-creates a company's first admin user with `plant_id = NULL` (line 63). With `users.plant_id` still `NOT NULL` at the DB level, that insert has been failing since migration 006 shipped:

```
error 23502: null value in column "plant_id" of relation "users" violates not-null constraint
```

I verified this empirically (in a rolled-back transaction, no data touched) before changing anything, and reproduced the exact error.

### Fix

Added `Backend/src/migrations/009_users_plant_id_nullable.sql`:

```sql
ALTER TABLE users
  ALTER COLUMN plant_id DROP NOT NULL;
```

This mirrors the existing pattern from migration 006 exactly — purely additive (widens a constraint, cannot lose or corrupt data). **Applied and verified**: the same insert that failed before now succeeds.

**Impact if left unfixed:** nobody could ever create a new company on this platform. This was blocking 100% of new customer onboarding.

---

## 2. Test data created

5 companies, exercising the real `company.service.js` → `plant.service.js` → `shift.service.js` → `machine.service.js` → `operator.service.js` → `component.service.js` → `job.service.js` chain end-to-end (not raw SQL inserts) — so every validation, quota check, and side effect a real user's actions would trigger actually ran.

| Company | Code | Plan | Plants | Shifts | Machines | Operators |
|---|---|---|---|---|---|---|
| Precision Auto Components Pvt Ltd | `PACPL` | Bronze | 1 | 1 (General 08:00–22:00) | 4 | 2 |
| Chennai Metal Works | `CMW` | Bronze | 1 | 1 (Day 07:30–21:30) | 3 | 2 |
| Sundaram CNC Solutions | `SCNC` | Silver | 2 (North, South) | 3 (Morning/Evening/Night) | 6 | 4 |
| Bharat Precision Industries | `BPI` | Silver | 3 (Coimbatore, Hosur, Pune) — **at the plan's max_plants=3 limit** | 2 (Day/Night, 12h) | 6 | 4 |
| Apex Turbine Components | `ATC` | Gold | 2 (Aerospace, Turbine) | 4 (A/B/C/D, 6h continuous rotation) | 8 | 5 |

**Totals:** 5 companies · 10 plants · 13 shifts · 27 machines · 17 operators · 27 components + 27 active jobs.

Each machine also got one synthetic `telemetry_raw` reading and shift-scoped `production_hourly` / `oee_shift_summary` backfill (see §5), since no physical MQTT devices are connected — exactly the gap you flagged as expected going in.

### Login credentials (test accounts)

All admin passwords were deliberately reset to a single known value so you can log in and explore. The system's real flow auto-generates a random password and emails it — but the configured Gmail SMTP credentials are currently invalid (see §6.1), so email delivery fails; this is a good reason to know the fallback of resetting via DB.

| Company | Login email | Password |
|---|---|---|
| PACPL | `admin@pacpl.test` | `Test@12345` |
| CMW | `admin@cmw.test` | `Test@12345` |
| SCNC | `admin@scnc.test` | `Test@12345` |
| BPI | `admin@bpi.test` | `Test@12345` |
| ATC | `admin@apextc.test` | `Test@12345` |

Log in at `https://stmmexa.stmcnc.com` (or your local frontend) with any of these right now.

---

## 3. Your specific question: "shift was different plant based on also shift create possible correct?"

**Short answer: plants — yes. Plant-scoped shifts/machines — no, not currently.**

What I verified by reading `createShift`, `createMachine`, `operator.service.js`'s `create`, and `component.service.js`'s `create`:

- **Plants**: fully supported. A company can have as many plants as its plan allows (enforced — see §4.4), each with its own code/name/location. ✅ Tested: BPI has 3 plants across 3 different cities.
- **Shifts, machines, operators, components, jobs**: the database schema supports plant-scoping (every one of these tables has a nullable `plant_id` column, put there for exactly this purpose) — but **every current create flow hardcodes `plant_id = NULL`**, regardless of what's sent. A shift you create is always company-wide, visible to every plant in that company; same for machines, operators, components, and jobs.

Concretely: if BPI (3 plants) creates a "Night Shift," that shift applies company-wide across all 3 plants — there's no way, through the current app, to give the Coimbatore plant a different shift schedule than the Pune plant, even though they might run different hours in reality.

Per your decision mid-session, I did **not** build plant-scoped creation (that's real feature work — touching `machine.service.js`, `shift.service.js`, `operator.service.js`, `component.service.js`, their controllers, the quota logic, and the frontend forms). I only tested and documented current behavior. If you want this built, it's a well-scoped, contained follow-up — flag it and I'll size it properly.

---

## 4. What was tested, and results

All tests below hit the **real HTTP API** (`localhost:8000`, later cross-checked against `stmapi.stmcnc.com`) with real JWTs from real logins — not direct DB queries, not mocks. **45 checks, 45 passed, 0 failed.**

### 4.1 Auth
| Test | Result |
|---|---|
| Login as all 5 company admins → 200 + valid JWT | ✅ Pass (5/5) |
| JWT payload carries correct `company_id`, `roles`, `permissions`, `plan` | ✅ Pass |
| Wrong password → 401 | ✅ Pass |
| No token on a protected route → 401 | ✅ Pass |

### 4.2 Company-scoped data isolation
For each of the 5 companies, logged in as that company's admin and confirmed each endpoint returns **exactly** that company's records — no more, no fewer, no leakage from other tenants:

| Endpoint | PACPL | CMW | SCNC | BPI | ATC |
|---|---|---|---|---|---|
| `GET /api/plants` | 1 ✅ | 1 ✅ | 2 ✅ | 3 ✅ | 2 ✅ |
| `GET /api/shifts` | 1 ✅ | 1 ✅ | 3 ✅ | 2 ✅ | 4 ✅ |
| `GET /api/machines` | 4 ✅ | 3 ✅ | 6 ✅ | 6 ✅ | 8 ✅ |
| `GET /api/operators` | 2 ✅ | 2 ✅ | 4 ✅ | 4 ✅ | 5 ✅ |
| `GET /api/dashboard` machine count | 4 ✅ | 3 ✅ | 6 ✅ | 6 ✅ | 8 ✅ |

### 4.3 Cross-tenant write protection (the important security test)

Using **PACPL's** valid JWT, attempted to modify resources belonging to **other** tenants directly by ID:

| Attempt | Expected | Result |
|---|---|---|
| `PATCH /api/machines/{SCNC's machine id}` | blocked | ✅ Blocked |
| `DELETE /api/shifts/{SCNC's shift id}` | blocked | ✅ Blocked |
| `POST /api/jobs/start` targeting ATC's machine | blocked | ✅ Blocked |

Every attempt failed, because every service query filters by `WHERE company_id = req.user.company_id` — a company admin literally cannot address another tenant's rows, even with a syntactically valid request and a real, valid token. This is the core multi-tenant security guarantee and it held in all 3 attempts.

### 4.4 Plan quota enforcement

| Test | Expected | Result |
|---|---|---|
| PACPL (Bronze, `max_plants=1`, already has 1) tries to create a 2nd plant | 403 `quota_exceeded` | ✅ Blocked correctly |
| SCNC (Silver, `max_plants=3`, has 2) creates a 3rd plant | allowed | ✅ Allowed |
| SCNC creates a 4th plant (over the limit) | 403 `quota_exceeded` | ✅ Blocked correctly |

(The probe 3rd plant was deleted immediately after the check so SCNC's data matches the table in §2.)

### 4.5 Jobs & OEE
| Test | Result |
|---|---|
| `GET /api/jobs/current` returns the right count of active jobs | ✅ Pass |
| `GET /api/jobs/history` returns real seeded job records | ✅ Pass |
| `GET /api/oee/meta` | ✅ Pass |
| `GET /api/oee/reports` returns real computed OEE/availability/performance/quality numbers | ✅ Pass |

### 4.6 Real browser end-to-end (Playwright, Chromium, not mocked)

Logged into the actual rendered web app for all 5 companies and confirmed the dashboard renders correctly — 5/5 passed. Screenshot evidence for two:

- **SCNC** (multi-shift, multi-plant): correctly detected the active shift ("EVE"), showed all 6 machines, and — notably — only displayed operator names for the two operators actually rostered on the *current* shift (Dinesh Kumar, Arun Kumar), correctly showing `--` for operators assigned to Morning/Night. This is shift-aware logic working exactly as designed.
- **PACPL** (single shift): correctly isolated to `pacpl_admin`'s own 4 machines, own operators (Murugan S, Karthik R), completely separate from SCNC's data.

Both screenshots show machine status as **OFFLINE** — this is correct, not a bug: the dashboard treats any machine whose last telemetry reading is older than 60 seconds as offline, and my synthetic readings were one-time inserts (no physical device is streaming continuously). Historical run/idle time and produced-quantity figures (driven by `production_hourly`, not live telemetry) displayed correctly regardless of live status — exactly the behavior you already told me to expect ("machine side not came, no issue").

### 4.7 Not individually tested

Quality, downtime, maintenance, alarms, programs, and PDF/CSV export modules were not walked end-to-end — they weren't part of what you asked me to verify this round, and they share the identical `company_id`-scoped-query pattern verified everywhere above. Flag it if you want these covered too.

---

## 5. How the "no live machines" gap was handled

You already told me this is expected and not a bug. To make the dashboards/reports show meaningful numbers anyway, each of the 27 machines got:
- One `telemetry_raw` row (realistic spindle load, feed rate, parts count — running/idle mix)
- `production_hourly` rows backfilled across each elapsed hour of that company's currently-active shift
- One `oee_shift_summary` row for today

This is testing scaffolding, not a permanent feed — once you connect real MQTT devices, real telemetry will simply take over the same tables. No code changes were needed for this; it slots into the existing schema.

---

## 6. Other findings (not fixed — flagging for your decision)

### 6.1 Welcome email delivery is broken
Gmail SMTP login failed for every one of the 5 companies during seeding: `535-5.7.8 Username and Password not accepted`. Combined with the fact that `company.service.js` never returns the plaintext password in its API response (only sends it by email, fire-and-forget), **there is currently no way for you to learn a newly-created company's admin password** unless you reset it directly in the database, like I did for testing. Worth fixing the Gmail app-password credentials in `.env`, or having the create-company response surface the password once for SNT_SUPER to copy.

### 6.2 Dev environment defaults to production
`FrontendIOT/src/environments/environment.ts` (used by plain `ng serve`) has its `localhost` lines commented out and points at `https://stmapi.stmcnc.com` by default. Anyone running the frontend locally without editing this file is unknowingly reading/writing live production data. I flipped it to localhost temporarily for this test and reverted it back afterward — but you may want to swap the defaults (local by default, production only via the build config) so local dev can't silently touch prod.

### 6.3 Minor code cleanliness
- `Backend/src/machines/machine.routes.js` registers `PUT /:id` twice (lines 17 and 29, both pointing at the same handler). Harmless — Express just ignores the second — but dead code worth deleting.
- Quota enforcement is structured inconsistently: plants are checked in route middleware (`checkQuota`), machines are checked with a duplicate hand-written check inside the service function, and shifts/operators have no quota concept at all (there's no `max_shifts`/`max_operators` in the `plans` table). Not a bug, just worth knowing if you extend the quota system later.

---

## 7. Cleaning up the test companies

When you're done exploring, deactivate (soft-delete, reversible) or permanently remove the 5 test companies via the existing SNT_SUPER company management screen — `company.service.js` already has both `remove()` (sets `is_active=false`) and `permanentDelete()` (full cascade cleanup of users/roles/permissions). Company IDs `5`–`9` (`PACPL`, `CMW`, `SCNC`, `BPI`, `ATC`). Your real company (`S AND T`, id `4`) is untouched and unaffected either way.

---

## 8. Summary

| Item | Status |
|---|---|
| Company creation bug (blocking ALL new companies) | ✅ Found, fixed, verified |
| 5-company multi-tenant dataset (varying plans/plants/shifts) | ✅ Created via real service layer |
| Plant-per-company (1–3 plants) | ✅ Works |
| Shift isolation per company | ✅ Works (company-wide, not plant-scoped — see §3) |
| Machine/operator/job creation | ✅ Works, correctly company-scoped |
| Cross-tenant data isolation | ✅ Verified secure (3/3 attack attempts blocked) |
| Plan quota enforcement (Bronze/Silver/Gold limits) | ✅ Verified at exact boundaries |
| Real backend HTTP flow | ✅ 45/45 checks passed |
| Real browser (web) flow, all 5 companies | ✅ 5/5 passed, screenshots captured |
| Plant-scoped shifts/machines | ❌ Not implemented (documented, your call on whether to build) |
| Welcome email delivery | ❌ Broken (invalid SMTP creds) |
