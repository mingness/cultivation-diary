# 修行日記 (Cultivation Diary) — Architecture

> Status: **draft for review**, derived from `docs/project_prompt.md` (§1–11, *what*) and
> `docs/project_prompt_engineering.md` (§12, *how*), both revised 2026-10-14 to match the decisions below.
> The screens are designed in `docs/FRONTEND.md` (decisions F1–F6 agreed); §5 and §7 below include what those
> screens need. Implementation follows the delivery plan in §11: backend first, then the frontend.
> Open items are marked in §12; each agreed decision becomes an ADR in `docs/decisions/`.

## 1. Goals and non-goals

**Goals**
- A private diary platform, 修行日記, in 繁體中文 (default), English and Tiếng Việt (D34), with supervision:
  users write encrypted diaries; course leaders read *submitted* entries and comment; authors choose to share
  an entry with their class, and any leader can stop sharing it (D29).
- Course announcements (公告) from leaders, written or recorded and transcribed, that the class reads, hears
  and replies to in one visible thread (D32, D33, §8.12–§8.13).
- A collective daily-count activity (报数) with a 10,000,000 goal and a nightly auto-submit (§7), also open to
  the wider community on its own site with self-registered, mantra-only accounts (D30, D31, §8.11).
- Installable on phones as a web app (manifest + service worker), with an Android wrapper only as a fallback.
- Built to §12: tested, observable, no secrets in git, CI-gated, reproducible.

**Non-goals**
- Protecting diaries from people with server access. The server holds the keys (§6), so anyone who can read
  the server's secrets can read diaries. `docs/SECURITY.md` must say so plainly.
- Courses (isolated groups of users). The app behaves as one course for now. Keep the schema open to adding a
  `courses` table later, but build nothing for it.
- Email or phone verification (§4.2), multi-tenant support.

### 1.1 Changes from the original spec (agreed 2026-10-14, now folded into the spec)

| Original | Now |
|---|---|
| Exactly one SUPER_ADMIN reads every diary, including drafts | **COURSE_LEADER**, one or more. Leaders read *submitted* entries only and comment; each leader has their own comment. |
| Exactly one SYS_ADMIN | **One or more**, with TOTP required. The last one cannot be deleted or demoted. |
| DEK wrapped with a password-derived key *and* the SUPER_ADMIN key | **Option A (§6):** random DEK per document, wrapped by server-held keys only. Passwords are for login only. |
| Android WebView app with APK self-update | **Installable web app**; the Android wrapper is a fallback (D10). |
| 200+ seeded users, admins "system-generated" | Test environment only. Production starts empty, and the first SYS_ADMIN is created with a CLI command. |
| Title 日记 | **修行日記** (English: Cultivation Diary) |
| The user picks a diary's date | The server sets it to the creation date (Beijing); several entries per date; no backdating (D22) |
| One 提交 button for every submit | 提交 for the first submit, **更新** for later updates (D22) |
| No usage limits | Daily and per-entry limits (D21), SYS_ADMIN-only deletes (D24), SYS_ADMIN activity log, Attention list and email alerts (D26, D27) |

## 2. Stack (D1, agreed)

| Layer | Choice | Why |
|---|---|---|
| Language | **TypeScript (strict)**, server and web | §12.9 static types; one language across the repo |
| Runtime | **Node.js 24 LTS**, pinned in `.nvmrc` | Built-in `crypto`: AES-GCM, HKDF, `randomInt`, `timingSafeEqual` |
| HTTP | **Fastify** | Schema-validated routes, body limits, pino logging, request IDs |
| Validation | **zod**, in `/shared` for server and web | One schema for server validation and client types |
| DB | **PostgreSQL 16** (pinned tag) | Real DB in integration tests (§12.5) |
| DB access | **Drizzle ORM** on `pg`; `drizzle-zod` | Typed schema, parameterised by construction |
| Migrations | **drizzle-kit** generates SQL into `/db/migrations`; applied at startup | Versioned SQL files, never edited after shipping (§12.6) |
| Password hash | **argon2id** (`@node-rs/argon2`) | §12.4 |
| HTML sanitising | **sanitize-html** on the server (editor tags only) | Stored-XSS defence for shared entries |
| Web | **React 19 + Vite**, react-router (data router) | Static build, served by nginx in the `web` container. React 19 rather than 18: 18 no longer gets fixes, and nothing we use needs 18 (changed 2026-10-15) |
| Server state (web) | **TanStack Query** (F4, agreed) | Polling that pauses, retries, cache invalidation after writes; see FRONTEND.md §10 |
| Rich text (web) | **Tiptap** on ProseMirror (F4, agreed) | Replaces deprecated `execCommand`; its schema mirrors the server's sanitiser allowlist |
| PWA | **vite-plugin-pwa** (Workbox) | Manifest, service worker and update prompt |
| Tests | **Vitest**, **Playwright**; Postgres from `docker compose` locally and a service container in CI | §12.5; each test file gets its own fresh database; injectable clock and RNG |
| Email | **nodemailer** over SMTP (D27) | Admin alert emails from a QQ or 163 mailbox; no extra DNS setup |
| API explorer | **OpenAPI** generated from the zod route schemas, shown with **Swagger UI** (dev and staging only) | The "dashboard" for checking the API by hand before there is a frontend, at `/docs`. Agreed (D20); `API_DOCS` turns it on or off |
| Lint/format | ESLint + Prettier, **lefthook** pre-commit, **gitleaks** | §12.3, §12.9 |

Any runtime dependency not listed here needs approval (§12.1).

## 3. Repository layout

```
/server            Fastify API. Pure modules in src/domain (crypto, authz, diary, sharing, count) have no HTTP code
/web               React app + PWA (strings only in src/i18n)
/shared            zod schemas and types shared by server and web
/db/migrations     generated by drizzle-kit, reviewed, append-only
/deploy            compose files, reverse proxy with TLS, server setup (written fresh)
/scripts           dev-setup (throwaway keys), seed, backup, restore, rotate-keys
/docs              ARCHITECTURE.md, decisions/, RUNBOOK.md, SECURITY.md, PRIVACY.md
/.github/workflows ci.yml, release.yml, deploy.yml
AGENTS.md          build/test/run commands, conventions, pitfalls
```

`/android` is added only if D10 calls for it.

## 4. Components

```
 Browser / installed web app
        │  HTTPS, HttpOnly session cookie, CSRF header
        ▼
   reverse proxy (TLS, CSP, rate limits, body limit, denies /internal/)
        │ /api                         └──► web static assets + manifest + service worker
        ▼
   server (Fastify)
     ├─ routes/          validate → load actor → authz → domain → shape response
     ├─ domain/crypto    keyring, DEK wrap/unwrap, AES-GCM (pure)
     ├─ domain/authz     policy: can(actor, action, resource) (pure, default-deny)
     ├─ domain/diary     lifecycle, history cap, sharing state machine, comments
     ├─ domain/count     trim/clamp, count-date window, aggregation, auto-submit job
     ├─ domain/limits    daily and per-entry limits, attention rules (pure)
     ├─ alerts           Attention list, email outbox sender (SMTP, optional)
     ├─ scheduler        02:00 count job, activity retention, alert sender;
     │                   Asia/Shanghai, injected clock, advisory lock
     ├─ cli              create-sysadmin, rotate-keys, run-count-job
     └─ db/              Drizzle schema + queries
        ▼
   PostgreSQL
```

## 5. Data model

All timestamps are `timestamptz`. "Today" for counting is the date in **Asia/Shanghai**.

All `id`s are **UUIDs generated by the server** before insert, not database sequences. Each ciphertext is
bound to its record's ID (§6.2), so the ID must exist before encrypting; UUIDs also stop anyone guessing
other entries' IDs by counting.

```
users
  id, username UNIQUE (immutable), email UNIQUE NULL
  role ENUM(NORMAL_USER, COURSE_LEADER, SYS_ADMIN)   -- one role per account
  password_hash                           -- argon2id PHC string (parameters inside, upgraded on login)
  reset_pending BOOL                      -- §4.3 lock-out: login refused, old hash kept until an admin resets
  totp_secret_ct/nonce NULL, totp_enabled_at NULL    -- secret encrypted with the profile DEK; required for SYS_ADMIN
  totp_last_step NULL                     -- last accepted code's time step, so a code can't be replayed
  font_size SMALLINT DEFAULT 18, theme ENUM(light, dark, system) DEFAULT system
  profile_ct, profile_nonce, profile_dek_wrapped     -- {familyName, givenName, address, photo}
  created_at, updated_at

documents
  id, owner_id FK CASCADE
  title (plaintext, §3)                   -- the submitted title (before the first submit, the working title)
  draft_title NULL                        -- a pending title change leaders don't see until 更新
  diary_date DATE                         -- set by the server from created_at (Asia/Shanghai); never from the client
  content_ct, content_nonce               -- last *submitted* content; leaders see only this
  draft_ct, draft_nonce, draft_saved_at   -- owner only, never shown to leaders
  first_submitted_at NULL                 -- NULL = never submitted = invisible to leaders
  last_submitted_at NULL
  CHECKs: ciphertext/nonce pairs set together; content exists iff first_submitted_at is set; only submitted
  entries can be anything but private
  access ENUM(private, course, everyone)  -- who it's shared with (D29); `everyone` is not offered yet
  access_decided_by FK users NULL, access_decided_at NULL   -- last sharing change
  unshared_by_leader_at NULL              -- a leader stopped sharing; cleared by the next 更新 with a change
  dek_wrapped, key_version
  created_at, updated_at
  INDEX (diary_date) WHERE first_submitted_at IS NOT NULL, INDEX (owner_id, diary_date), INDEX (access)

document_versions                         -- max 3 per document, enforced in one transaction
  id, document_id FK CASCADE, version_no, content_ct, content_nonce, created_at

comments                                  -- at most one per (document, leader)
  id, document_id FK CASCADE, author_id FK users
  body_ct, body_nonce                     -- encrypted with the document's DEK
  state ENUM(draft, submitted), submitted_at NULL, created_at, updated_at
  seen_by_owner_at NULL                   -- set when the owner opens the entry; drives the "new comment" marker
  UNIQUE (document_id, author_id)

announcements                             -- D32; the whole class (one class for now), never the mantra site
  id, author_id FK users SET NULL         -- a deleted leader's announcements stay, as "former leader" (like D18)
  title (plaintext, like documents.title)
  body_ct, body_nonce                     -- sanitised like an entry; sealed with the announcement's DEK
  state ENUM(draft, published), published_at NULL, edited_at NULL, pinned BOOL DEFAULT false
  dek_wrapped, key_version                -- wrapped by DIARY_KEYRING (D32)
  created_at, updated_at
  INDEX (state, pinned, published_at)

announcement_audio                        -- D33; at most one recording per announcement, replaced by re-recording
  announcement_id PK FK CASCADE
  audio_ct, audio_nonce                   -- bytea, sealed with the announcement's DEK, AAD announcement:{id}:audio
  mime ENUM(audio/webm, audio/mp4)        -- from the file's magic bytes, never the request header
  duration_ms, bytes, created_at

announcement_replies                      -- one visible thread per announcement (D32)
  id, announcement_id FK CASCADE, author_id FK users CASCADE   -- deleting a user deletes their replies, like their entries
  body_ct, body_nonce                     -- plain text, sealed with the announcement's DEK, AAD reply:{id}
  created_at, edited_at NULL
  INDEX (announcement_id, created_at)

announcement_reads                        -- the unread badge, "new replies" and the leaders' "seen by N" count
  announcement_id FK CASCADE, user_id FK CASCADE, last_read_at
  PRIMARY KEY (announcement_id, user_id)

count_entries
  id, user_id FK CASCADE, daily_count INT CHECK (1..1080), count_date DATE, submitted_at, auto BOOL
  INDEX (user_id, count_date)             -- count_date is today or up to 5 days earlier, checked by the server

count_settings
  user_id PK, auto_submit BOOL, saved_count INT CHECK (0..1080), updated_at

daily_usage                               -- counters for the daily caps and warning levels (D21, D28); survive deletes, so an admin delete refunds nothing
  user_id FK CASCADE, day DATE, kind ENUM(create, submit, update, comment, announce, reply), n INT   -- comment: warn only, no cap
  PRIMARY KEY (user_id, day, kind)        -- checked and incremented in the same transaction as the write

activity_events                           -- metadata only, never content; kept 90 days; never shown to the user it describes
  id, user_id FK SET NULL, username       -- username kept so events survive the user's deletion
  kind                                    -- entry_created/submitted/updated, count_entry, announcement_published, announcement_reply, limit_reached, elevated_activity,
                                          -- login, login_failed, new_device, password_changed
  detail JSONB NULL                       -- e.g. {limit: "submit"}; no content, titles or profile fields
  created_at
  INDEX (user_id, created_at), INDEX (kind, created_at)

alerts                                    -- the Attention list and the email outbox
  id, user_id FK SET NULL, username, rule, created_at
  handled_by FK users NULL, handled_at NULL
  emailed_at NULL, email_attempts INT, last_error NULL

job_runs                                  -- one row per run of each daily job, so missed or failed runs show
  id, job, started_at, finished_at NULL, status ENUM(running, ok, failed)
  summary JSONB NULL                      -- counts only, e.g. {"deleted": 12}
  error NULL

sessions
  id_hash (SHA-256 of the cookie value), user_id, kind ENUM(browser, device)
  device_label                            -- from the user agent at login ("iPhone · Safari"); no IP geolocation
  csrf_token, mfa ENUM(not_required, pending, enrolment_required, verified)
  created_at, last_seen_at, expires_at, revoked_at NULL

read_audit                                -- security log only; never shown to diary owners; kept 90 days
  id, leader_id FK SET NULL, leader_username, document_id FK CASCADE, read_at
                                          -- one row per leader read of an entry or its history

captchas
  id, answer_hash (HMAC under SESSION_SECRET), expires_at   -- single use, 5 minutes
```

Deleting a user deletes their documents (spec). Deleting a leader keeps their *submitted* comments, shown as
"former leader" (D18).

## 6. Encryption (Option A, agreed)

### 6.1 What it protects, and what it doesn't

| Threat | Protected? | By what |
|---|---|---|
| Stolen DB dump or backup | **Yes**, even with weak passwords | Keys never live in the DB |
| SQL injection or read-only DB access | **Yes** | Same |
| SYS_ADMIN, through the app | **Yes** | Authz; SYS_ADMIN code never loads the diary key (tested) |
| Anyone with server access + secrets | **No** | Out of scope (§1); documented in SECURITY.md |
| A stolen leader account | Partly | 30-day cap on leader device sessions, optional TOTP, internal read audit log |

### 6.2 Keys

| Key | Where | Used for |
|---|---|---|
| `DIARY_KEYRING` | Server secret: `v2:<hex>,v1:<hex>`, current key first | Wraps each document DEK |
| `PROFILE_KEYRING` | Server secret, same format | Wraps each profile DEK |
| `SESSION_SECRET` | Server secret | CSRF token derivation |
| `CRON_SECRET` | Server secret | Bearer token for `/internal/count/auto-run` |
| `SMTP_URL` | Server secret, optional | Sending admin alert emails; holds the mailbox's SMTP authorization code (授权码), never its password |
| DEK | 32 random bytes per document and per profile, stored wrapped | AES-256-GCM over content, drafts, versions, comments and profiles |

- Every encryption uses a random 96-bit nonce.
- The associated data binds each ciphertext to where it belongs (`doc:{id}:draft`, `comment:{id}`), so
  ciphertexts can't be moved between rows.
- A wrapped DEK starts with its key version, so `scripts/rotate-keys` can re-wrap in batches. The script is
  idempotent and resumable, and the RUNBOOK documents it. Content itself is never re-encrypted.
- **Key custody:** losing `DIARY_KEYRING` loses every diary. The keys are generated by `scripts/dev-setup` (dev)
  or by hand (prod), stored offline and separately from DB backups, and their recovery is rehearsed (RUNBOOK).

### 6.3 Consequences

- Passwords only authenticate. Self-service changes, admin resets and forgot-password never touch encrypted
  data, and users never lose access to their old entries. The spec's "admin reset makes old documents
  unreadable" no longer applies.
- Sessions are plain random tokens. No key material is held per session.
- Structural separation: only `domain/diary` imports the diary keyring. A lint rule (import restriction) plus a
  test that calls every SYS_ADMIN endpoint and greps the responses for seeded plaintext enforce it.
- **Profile fields are covered too:** family/given name, address and photo are encrypted with a per-user DEK
  wrapped by `PROFILE_KEYRING`. Username and email stay plaintext, because login and uniqueness checks need them.
  The server decrypts names where screens need them (the count table, leader lists).

## 7. Authorisation

Default deny. Every route declares an action, and the pure function `can(actor, action, resource)` decides
using `actor.role`, `isOwner`, and the document's `first_submitted_at` and `access`.

### 7.1 Who can read an entry

| Reader | Can read when |
|---|---|
| Owner | Always, including draft and history |
| COURSE_LEADER (not the owner) | `first_submitted_at` is set. They see the submitted content, history versions, all submitted comments, and their own draft comment. Never the owner's unsubmitted draft. |
| Other diary members (NORMAL_USER, COURSE_LEADER) | `access` is `course` (same class; one class for now, so every diary member) or `everyone`: submitted content + submitted comments |
| COUNT_USER | Never; they have no diary capability at all (D30) |
| SYS_ADMIN | Never. Metadata only (title, date, owner, access state) |

### 7.2 Sharing (revised 2026-10-19, D29)

```
owner:   private ──share(scope) (confirm dialog)──► scope    refused while a leader's unshare stands
owner:   scope ──share(other scope)──► other scope
owner:   scope ──unshare──► private
leader:  scope ──unshare (confirm dialog)──► private, and unshared_by_leader_at = now
owner:   更新 with a change ──► unshared_by_leader_at = NULL (sharing is the owner's call again)
```

Nobody approves sharing; leaders only unshare, which keeps their work light. A leader unsharing their own
entry acts as its author, so it sets no lock. `scope` is `course` for now; `everyone` is in the enum so offering
it later is an API and UI change, not a migration. When classes arrive, `course` must compare the reader's
class with the author's in `sharedWithReader` (`server/src/domain/authz/policy.ts`) and in the 開放日記 query.

Only submitted entries can be shared. All transitions are server-enforced; access fields in draft or submit
bodies are ignored.

### 7.3 Endpoint matrix

| Endpoint | Anon | COUNT_USER | NORMAL_USER | COURSE_LEADER | SYS_ADMIN |
|---|---|---|---|---|---|
| `GET /api/auth/captcha`; `POST /api/auth/login`, `/register`, `/forgot-password` | ✅ rate-limited | – | – | – | – |
| `POST /api/auth/logout`; `GET/PUT /api/me` (includes `storageBytes`); `POST /api/me/password`; `GET/DELETE /api/me/sessions…` | – | ✅ | ✅ | ✅ | ✅ |
| `POST /api/me/totp/setup`, `/confirm` | – | ✅ optional | ✅ optional | ✅ optional | ✅ required |
| `GET /api/documents/mine?month=` → per entry `state, access, commentCount, hasUnseenComment` | – | ❌ | ✅ | ✅ | ❌ |
| `POST /api/documents`, `PUT /:id/draft`, `POST /:id/submit` (first submit or update) | – | ❌ | own, daily limits | own, daily limits | ❌ |
| `GET /api/documents/open?month=` | – | ❌ | ✅ | ✅ | ❌ |
| `GET /api/documents/:id`, `/:id/versions` | – | ❌ | per §7.1 | per §7.1 | ❌ |
| `POST /api/documents/:id/access` (`{action: share, scope: course}` / `{action: unshare}`) | – | ❌ | own | own | ❌ |
| `POST /api/documents/:id/access` (`{action: unshare}`) | – | ❌ | ❌ | ✅ submitted | ❌ |
| `GET /api/leader/documents?date=&page=&size=`, `?user=&month=` and `?unread=true&page=&size=` → per entry `myCommentState, otherLeaderCommented, unread, access` | – | ❌ | ❌ | ✅ submitted only | ❌ |
| `GET /api/leader/calendar?month=` → submitted-entry count per day | – | ❌ | ❌ | ✅ | ❌ |
| `GET /api/leader/users?month=` → names + entries this month | – | ❌ | ❌ | ✅ | ❌ |
| `PUT /api/documents/:id/comments/mine` (`{body, state}`) | – | ❌ | ❌ | ✅ submitted, own included | ❌ |
| `GET /api/admin/users?q=&role=&status=&page=&size=`; `GET /api/admin/users/:id` | – | ❌ | ❌ | ❌ | ✅ incl. decrypted profiles |
| `POST /api/admin/users`; `PATCH /api/admin/users/:id` (role, email, profile; never username) | – | ❌ | ❌ | ❌ | ✅ not demoting the last SYS_ADMIN; never a diary member to COUNT_USER |
| `DELETE /api/admin/users/:id`; `POST /api/admin/users/batch-delete` (NORMAL_USER and COUNT_USER only) | – | ❌ | ❌ | ❌ | ✅ not yourself, not the last SYS_ADMIN |
| `POST /api/admin/users/:id/password` (chosen or generated; unlocks reset-pending); `DELETE /api/admin/users/:id/totp` | – | ❌ | ❌ | ❌ | ✅ (TOTP: not your own) |
| `GET /api/admin/documents?user&date`, `DELETE /:id` | – | ❌ | ❌ | ❌ | ✅ metadata only |
| `GET /api/count/summary`, `/latest`; `POST /api/count` (`{count, countDate}`); `GET/PUT /api/count/settings` | – | ✅ | ✅ | ✅ | ✅ |
| `GET /api/admin/count/users`, `PUT /:u/auto`, `DELETE /:u/entries?from=&to=`, `GET /job-runs`, `POST /run-now` | – | ❌ | ❌ | ❌ | ✅ |
| `GET /api/admin/attention?status=`, `/attention/status`, `POST /api/admin/attention/:id/handled`; `GET /api/admin/activity?userId=&kind=&from=&to=`, `/activity/summary?sort=` | – | ❌ | ❌ | ❌ | ✅ metadata only |
| `POST /api/admin/users/:id/sign-out-all`, `/lock` | – | ❌ | ❌ | ❌ | ✅ (lock: not yourself, never the last usable SYS_ADMIN) |
| `POST /api/translate` (`{documentId}`, `{commentId}`, `{announcementId}` or `{replyId}`, `target`) | – | ❌ | readable only, rate-limited | same | ❌ |
| `GET /api/announcements?page=` (pinned first, then newest; unread and new-reply flags), `GET /:id` (marks read) | – | ❌ | published | published + own drafts; `seenBy` count | metadata only (admin list) |
| `POST /api/announcements`, `PUT /:id` (`{title, body, state, pinned}`) | – | ❌ | ❌ | ✅ own; daily limit | ❌ |
| `DELETE /api/announcements/:id` | – | ❌ | ❌ | ✅ any (moderation) | ✅ metadata only |
| `PUT /api/announcements/:id/audio` (raw `audio/webm` or `audio/mp4` body), `DELETE /:id/audio` | – | ❌ | ❌ | ✅ own | ❌ |
| `GET /api/announcements/:id/audio` | – | ❌ | published | published + own drafts | ❌ |
| `POST /api/announcements/:id/transcribe` (`{language: en \| zh}`) | – | ❌ | ❌ | ✅ own, rate-limited | ❌ |
| `POST /api/announcements/:id/replies`; `PUT`/`DELETE /api/announcement-replies/:id` | – | ❌ | published; edit/delete own | same; delete any | ❌ |
| `POST /internal/count/auto-run` | Bearer `CRON_SECRET`, internal network only | | | | |
| `GET /healthz`, `/readyz` | ✅ | | | | |

Translate takes an **id**, not free text. The server checks read access and decrypts the text itself, which
keeps the endpoint from becoming a free LLM proxy.

A COUNT_USER has only the account rows and 報數. Every other row is refused by capability
(`hasCapability`), never by a role list in the route, so a new diary route that forgets its guard is caught by
the integration test that calls every diary, leader and translate route as a COUNT_USER.

Because each account has exactly one role, separation of duties is automatic: a SYS_ADMIN account can never read
diaries. A leader's own entries follow the owner rows and the leader rows alike: leaders may comment on and unshare
any submitted entry, their own included, and the review lists include their own entries.

## 8. Feature design notes

### 8.1 Bootstrapping and environments

- **Production** starts with an empty DB. `docker compose exec server node dist/cli.js create-sysadmin <username>`
  prompts for a password and prints a TOTP enrolment QR code in the terminal. From then on, SYS_ADMINs create
  leaders and other admins in the UI.
- **Dev/test seed** (`scripts/seed`, refused when `NODE_ENV=production`): matches the spec's §11 seed list.
  Seeded passwords, keys and TOTP secrets are throwaway.

### 8.2 Auth and sessions

- **CAPTCHA (§4.1):** server-rendered SVG whose glyphs are paths. The answer is never sent to the client and is
  stored hashed; each CAPTCHA is single-use and refreshes on failure.
- **Rate limits:** per IP at the proxy, per username in the app.
- **Forgot password (§4.3):** always answers "已經提交給管理員", so it doesn't reveal which usernames exist.
  It needs the CAPTCHA and is rate-limited, because anyone can lock any account by name. SYS_ADMIN accounts
  can't be locked from this public form (otherwise anyone could lock every admin out); a locked-out admin is
  recovered by another admin or the CLI (`set-password`, `reset-totp`).
- **Registration creates a COUNT_USER (D30):** `POST /api/auth/register` takes username, password, CAPTCHA,
  an optional display name and an email and/or phone (at least one, checked by the shared schema). Neither is
  verified. The display name is stored as the profile's given name, so every list that shows names (the 報數
  board, and the diary's lists after a promotion) uses the one existing rule. The phone lives in the encrypted
  profile: unlike email it is never unique and nothing is sent to it. Only the mantra site shows the form,
  but the server doesn't check which site called: whatever the caller, the account reaches 報數 only.
- **Closing registration:** `REGISTRATION_OPEN=false` (any environment, production included) makes
  `POST /api/auth/register` answer 403 `registration_closed` before reading the body, and
  `GET /api/auth/options` tells the sign-in screens to hide the register link. SYS_ADMINs still create
  accounts. `deploy/make-env.sh` writes it open, since registering only makes mantra-only accounts (D31);
  closing it is the response to spam signups.
- **Roles only move up:** `PATCH /api/admin/users/:id` refuses to change a NORMAL_USER or COURSE_LEADER into a
  COUNT_USER (409 `role_change_refused`), so no diary is ever left behind by an account that can't reach it.
  COUNT_USER → NORMAL_USER (or any other role) is allowed.
- **Changing one's own authenticator (Q1):** a SYS_ADMIN who still has their app can move to a new one from
  the account page. Step one (`POST /api/me/totp/change`) needs the password and a current code (both on the
  sign-in throttles) and stores a new secret as pending (sealed under its own label, `profile:<id>:totp-pending`);
  the old app keeps working. Step two (`POST /api/me/totp/change/confirm`) needs a code from the new app,
  swaps the secrets, signs out every other device, and records `totp_changed`, which always raises a 注意
  alert, so the other admins hear of it if a stolen session did it. A lost phone stays a recovery task.
- **Accounts:** usernames are 3–32 characters (letters, digits, `.` `_` `-`), unique ignoring case; passwords
  8–256 characters. Failed logins answer the same and take the same time for unknown users, wrong passwords
  and locked accounts. Five failures for a username within 15 minutes block it for the rest of the window;
  the same applies to wrong authenticator codes, which also end the half-open session. These counters, and
  the per-IP limits, live in memory: right for the single server instance we plan to run. Moving them to the
  database is not scheduled; it becomes necessary only if we ever run several instances behind a load
  balancer. A SYS_ADMIN issues a password from an alphabet without look-alike characters using
  `crypto.randomInt`. It is shown once, and all of the user's sessions are revoked.
- **Sessions:** an HttpOnly, Secure, SameSite=Lax cookie holds a random token; the DB stores only its hash.
  Plus a CSRF header.
  - **Browser session:** 12 h idle timeout.
  - **"Remember this device"**, the device token: 90-day sliding expiry. It's listed under Account → Devices
    and can be revoked there.
  - Leaders and SYS_ADMINs: device sessions capped at 30 days.
  - Waiting for an authenticator code: 5 minutes.
  - Production uses the `__Host-sid` cookie name, which browsers only accept with Secure, path=/ and no domain.
  - Signing in replaces any session the browser already had (prevents session fixation).
- **TOTP:** required for SYS_ADMIN, enrolled on first login (or through the CLI for the first admin); optional
  for others. Recovery is another SYS_ADMIN resetting it, or the CLI for the last admin.
  - `SKIP_TOTP=true` (development only, written by `dev-setup`; the server refuses to start with it in
    production) skips the code at sign-in, so admins use a password alone locally. The e2e stack forces it
    off, so the browser tests still go through the authenticator (agreed 2026-10-15).
  - Password changes and resets revoke all the user's sessions except the current one. Changing one's own
    password needs the current one; wrong guesses share the sign-in throttle, so a stolen session can't be
    used to guess it.

### 8.3 Diary

- **Editor (§5.2):** Tiptap with only the extensions matching the allowlisted tags (`p, h1–h3, b, strong, u,
  span[style=font-family|font-size], img[src=data:image/(jpeg|png|webp)], br`). The server sanitiser uses the
  same allowlist, so anything the editor can produce survives sanitising unchanged.
- **Buttons:** the draft/submit enable logic is a unit-tested reducer. Auto-draft runs every 5 minutes while
  there are unsaved changes. The submit button reads 提交 until `first_submitted_at` is set, then 更新.
- **Entry date (D22):** `diary_date` is the Asia/Shanghai date of `created_at`, set on insert. Create and draft
  bodies carry no date, so backdating is impossible rather than merely validated.
- **Images (D6, agreed):**
  - The client downscales any image over 500 KB or 1600 px on its long edge to fit within 1600 px, as JPEG at
    quality 0.8, stepping down to 0.6 until it's under 500 KB. Re-encoding also drops EXIF/GPS data.
  - A notice reports the change, e.g. "圖片已縮小：4032×3024 (3.2 MB) → 1600×1200 (310 KB)".
  - The server caps each image at 1 MB, each document at 8 MB and each request at 10 MB.
  - At most **2 images per entry** (D21), counted in the sanitised body of drafts and submissions alike.
- **Limits (D21):** the values live in `shared/src/limits.ts`, so the editor's counter and the server agree.
  - Daily, per user, per Asia/Shanghai date: 20 creates, 20 first submissions, 50 updates, tracked in
    `daily_usage` within the write's transaction.
  - Per entry: 2 images; 5,000 characters of visible body text after sanitising, **whitespace not counted**
    (`visibleCharCount` in `shared/src/limits.ts`; the editor and the server then agree exactly however each
    represents paragraph breaks). A draft over 5,000 characters still saves; only submit/update is refused, so
    text is never lost.
  - Submitting exactly what is already submitted (same title and body) changes nothing and counts nothing, so
    a double click is harmless.
  - A refused write returns `LIMIT_REACHED` with `{limit, resetsAt}` (409), records a `limit_reached` activity
    event, and raises an alert only for a daily cap (D28). Warning levels below the caps flag without refusing
    (§8.9).
  - No storage quota. `storageBytes` is the sum of the user's ciphertext sizes (content, draft, versions,
    comments on their entries, profile), computed on request; cache it only if it proves slow.
- **Deleting (D24):** users can't delete entries. Only a SYS_ADMIN deletes, immediately, cascading to
  versions and comments.
- **Comments:** each leader has at most one comment per entry, which they can save as a draft or submit, and edit
  again later. The owner and permitted readers see all submitted comments, each labelled with its leader's name.
  A submitted comment the owner hasn't opened yet (`seen_by_owner_at` is NULL) shows as new and raises the
  有新批注 toast.
  - A comment has one body and one state, so saving a submitted comment as a draft takes it back out of the
    owner's view until it is submitted again. Resubmitting changed text marks it new for the owner again;
    resubmitting identical text changes nothing.
  - Comments have the entry's per-entry limits (D21): 2 photos, image and body byte caps, and 5,000 visible
    characters on submit (a draft may be longer). Refusals are recorded as for entries, and
    submitted comments count toward the daily comment warning level (D28). A submitted comment also needs some visible text or a photo.
  - The owner's `GET /api/documents/:id` returns submitted comments with `isNew` and then marks exactly those
    seen. A leader's own comment is always `myComment`, never one of `comments`, in either view; on their own
    entry it is never marked new.

### 8.4 Pages

Designed in `docs/FRONTEND.md`: role-based tab bar on phones and top bar on desktop; a read view before the
editor (F1); cards on phones and tables on desktop (F2); a 取消開放 button for leaders (F3, revised by D29);
traditional characters throughout (F5); no offline writing in v1 (F6).

### 8.5 报数

- App-wide: one shared total (agreed).
- `normaliseDailyCount` in `shared/src/count.ts` trims non-digits and clamps to 1–1080, returning notices. The same function runs in
  the client (UX) and the server (enforcement), and DB CHECKs are the backstop.
- **Count date (D23):** today or up to 5 days earlier (Asia/Shanghai), from `countDateChoices` in
  `shared/src/count.ts` (the summary returns the allowed dates for the chips); never in the future. Manual entries are limited to 20 per user per `count_date` (the auto entry is exempt), so backdating
  can't multiply the limit; the 5th warns (`COUNT_WARNING`).
- **A report replaces the day's number:** every total uses each user's latest report per `count_date`
  (`DISTINCT ON … ORDER BY seq DESC`; `seq` is an identity column, because two reports can share a timestamp).
  All rows are kept as traffic. The auto job skips users who already reported for today. Auto-submit always uses today. "Today's count" and "first count date" use
  `count_date`.
- Every role reports, COUNT_USERs included; the board shows each person's name, or their username when they
  have none.
- SYS_ADMINs can delete a user's count entries by `count_date` range, so cleaning up after a hijacked account
  keeps the user's honest history.
- The scheduler fires at 02:00 Asia/Shanghai using an injected clock and `pg_try_advisory_lock`, and records a
  `job_runs` row. A missed or failed run shows a banner to SYS_ADMINs: the latest run failed, or no run
  succeeded within 15 minutes of the last 02:00. A manual entry also becomes the user's saved number.
- `POST /internal/count/auto-run` (Bearer `CRON_SECRET`, compared in constant time) runs the same job for an
  external cron. The proxy must not route `/internal/` from the internet (Phase C).

### 8.6 Translation (§8)

The server calls an OpenAI-compatible API (base URL, key and model from env) with a 10-second timeout, which
returns 504 and a toast. It's rate-limited per user and faked in tests. PRIVACY.md must say that translating
sends that text to a third-party provider.

- **Optional:** `TRANSLATE_API_URL`, `TRANSLATE_API_KEY` and `TRANSLATE_MODEL`, all three or none (https only in
  production). Without them `POST /api/translate` answers 503 `translation_unavailable`, and `GET /api/me`
  reports `features.translation: false` so the app greys out the buttons. `ctx.translator` is
  the seam, like `ctx.mailer`; it uses Node's `fetch`, so no new dependency.
- **What is sent:** the text the caller may read, as `toPlainText` of the sanitised body (no markup, no images):
  the owner's newest version (their draft if pending), otherwise the last submitted one; a submitted comment,
  or a leader's own draft comment. Translating is not reading: no read audit, nothing marked seen.
- **Failures:** 504 `translation_timeout`, 502 `translation_failed`; the text and the provider's error body are
  never logged. Capped at 60 translations per user per hour (429) and 10,000 characters (413), in
  `TRANSLATE_LIMITS`; reaching the cap doesn't flag the account (it's cost control, not a misuse signal).
- The prompt asks for Traditional Chinese, keeps Buddhist terms and paragraph breaks, and treats the text as
  text, never as instructions.
- **Targets (D34, replaces `direction`):** the request names a `target` of `zh-Hant`, `en` or `vi`, and the
  model works out the source language itself. The app offers one button, "translate into the language I'm
  using". The prompt per target keeps Buddhist terms in that language's usual form (for Vietnamese, the
  Hán-Việt terms Vietnamese Buddhists use). The server accepts the old `direction` field for one release, so
  an installed app that hasn't reloaded yet keeps working.
- Announcements and replies (§8.12) are translatable like entries and comments: any reader of the announcement
  may translate it.

### 8.7 Installable web app (primary mobile path)

- **Manifest:** name and short name (D8), icons (192/512 + maskable), `display: standalone`, theme colour.
- **Service worker:** precaches **only the app shell** (HTML/JS/CSS/fonts/icons). `/api/*` is network-only and
  never cached, so diary content never sits in the device cache. When a new version is waiting, a toast offers
  "新版本可用 — 重新載入", which replaces §9's self-update.
- **Install UX:** use `beforeinstallprompt` where the browser supports it (Chrome-based browsers); elsewhere
  (iOS Safari, many Chinese-OEM browsers) show a short how-to sheet. In WeChat's built-in browser, show "open in
  browser" guidance, because installing isn't possible there.
- **Staying logged in:** the "remember this device" session cookie (§8.2) is shared by the installed app and
  the site, and is not subject to Safari's 7-day storage purge (HttpOnly server cookie).
- **Font size (§9):** becomes a per-user setting in Account, stored server-side.
- **Fonts and assets** are bundled, with no CDN (§12.4).
- **Two installable apps (D31):** the diary and the mantra builds each have their own manifest, name, icons,
  theme colour and service worker, because each site is its own origin (§8.11).

### 8.11 Diary and mantra sites (D30, D31, agreed 2026-11-02)

The diary is curated; 報數 is open to the community. One server, one database and one account system serve
two sites, so diary users keep a single login and their 報數 tab, while mantra-only people never touch the
diary.

- **Hosts:** `diary.gcdr.org.au` and `mantra.gcdr.org.au`. Caddy has a block for each; both reach the same
  `web` container, on port 8080 (diary build) and 8082 (mantra build). Each nginx server block forwards `/api`
  to the same `server`.
- **Two builds of one codebase:** `VITE_SITE=diary|mantra` selects the routes, the manifest and icons, the
  page title, and the sign-in screen (the mantra build has no 修行日記 / 報數 choice and is the only one with a
  register link). The mantra build's routes: sign in, register, forgot password, 報數 (its home page) and the
  account page. Separate builds keep each installable app's name, icon and precache apart without nginx
  rewriting the manifest per host.
- **Sessions are per site.** The `__Host-` cookie can't be shared between hosts, so signing in to one site
  doesn't sign in to the other. That's intended: diary users use 報數 inside the diary.
- **Wrong site:** a COUNT_USER who signs in on the diary site gets the count-only shell rather than an error
  (their role decides the tabs either way). The diary sign-in page points mantra-only visitors to the mantra
  site, using `mantraUrl` from `GET /api/auth/options` (config `MANTRA_URL`), so no URL is baked into a build.
- **Admin:** SYS_ADMINs work on the diary site. The user list filters by role, and batch delete covers
  COUNT_USERs, for cleaning up after spam signups.
- **Development:** `npm run dev:mantra` serves the mantra build on :5174; compose publishes the mantra site on
  :8082.

### 8.12 Course announcements (D32)

A leader posts to the whole class; diary members read, listen and reply in one thread everyone in the class
can see. Mantra-only accounts and the mantra site have no announcements.

- **Writing:** the announcement editor is the diary editor (same Tiptap schema and sanitiser, so the
  allowlist stays one list) with the entry's per-entry limits: 2 photos and 5,000 visible characters. A draft
  is visible only to its author; 發布 publishes it to the class. The author may edit a published announcement
  (it shows 已編輯 with the time); any leader may delete one, and a SYS_ADMIN may delete one from the metadata
  list (for a departed leader's or a mistaken post). A leader may pin announcements; pinned ones come first.
- **Replies:** plain text (no formatting, no photos), up to 1,000 visible characters, in time order under the
  announcement, each labelled with its author's name. Everyone who can read the announcement sees every reply
  (D32). Authors edit or delete their own replies; any leader may delete a reply.
- **Limits (D21, D28):** per day, 10 announcements published per leader and 30 replies per user, counted in
  `daily_usage` (`announce`, `reply`); warning levels at about half. The reply length cap is what keeps
  leaders' reading load bounded, since leaders read every reply. Values in `shared/src/limits.ts` and
  `shared/src/warning-levels.ts`.
- **Unread:** `announcement_reads.last_read_at` drives an unread badge (published announcements never opened,
  or with replies newer than the reader's last visit) and a "new" mark on those replies. Leaders see how many
  of the class have opened an announcement ("已讀 14/20"), not who: reading an announcement isn't something to
  be checked up on (in the spirit of D14).
- **Encryption:** bodies, replies and recordings are sealed with a per-announcement DEK wrapped by
  `DIARY_KEYRING`, so the service lives in `server/src/services/diary/announcements/` and the keyring lint rule
  stays as it is. The "no plaintext for SYS_ADMIN" test covers the new GET endpoints automatically. Titles are
  plaintext, like entry titles.
- **Activity:** `announcement_published` and `announcement_reply` events (metadata only), for the activity
  summary and the warning levels. Reading isn't recorded in the read audit; that log is for leaders reading
  diaries.
- **One screen with 開放日記:** announcements and shared entries live in one tab, 課堂 / "Class" / "Lớp học",
  which replaces the 開放日記 tab. It is the existing month feed with a type filter (全部 · 公告 · 開放日記) beside
  the day and author filters; pinned announcements sit above the feed. Cards show their type, so an
  announcement (leader's name, 🔊 if recorded, reply count) doesn't read as an entry. Tabs stay within five:
  NORMAL_USER 日記 · 課堂 · 報數 · 我的; COURSE_LEADER 批閱 · 課堂 · 日記 · 報數 · 我的. The tab's badge counts
  unread announcements only (shared entries have no unread state for readers).
  - The API stays two lists: `GET /api/announcements?month=` matches `GET /api/documents/open?month=`, and the
    screen merges the two by date (announcement `published_at`, entry `diary_date`). A combined endpoint would
    mix two read rules in one query for no gain.
- **Polling:** the badge refetches every minute while the app is visible, like the old requests badge. No
  push notifications (D27: web push is blocked on Android in mainland China).

### 8.13 Voice recordings and transcription (D33)

A leader can record the announcement instead of typing it. The recording is kept and the class can play it;
the transcript becomes the announcement's text, which the leader corrects before publishing.

- **Recording:** in the browser with `MediaRecorder`, at a modest bitrate (`audioBitsPerSecond: 32000`, which
  browsers treat as a hint). Chrome and Android produce WebM/Opus; iOS Safari produces MP4/AAC. Both are kept
  as recorded: transcoding would need ffmpeg on the server (a new dependency), so we first check on real
  phones (with D10) that each plays the other's format, and decide on transcoding only if one doesn't.
- **Caps:** 10 minutes and 8 MB per recording (`shared/src/limits.ts`), shown as a countdown while
  recording; the server refuses larger bodies (413) and checks the magic bytes (WebM `1A45DFA3`, MP4 `ftyp`).
  One recording per announcement; recording again replaces it after a confirm.
- **Upload:** `PUT /api/announcements/:id/audio` takes the raw `audio/*` body (a Fastify content-type parser
  with a per-route body limit; no multipart dependency). Uploading and transcribing are separate calls, so a
  failed or slow transcription never loses the recording, and the leader can retry or type instead.
- **Playback:** the app fetches the audio through `api()` as a blob and plays it from an object URL. That
  keeps the session cookie and error handling in one place and avoids Safari's need for byte-range responses
  on a direct `<audio src>`. Responses are `Cache-Control: no-store`, and the service worker never caches
  `/api/` (§8.7), so recordings don't stay on devices. Recordings also count towards the author's storage.
- **Transcription:** `POST /api/announcements/:id/transcribe` with `{language: en | zh}`. The leader picks
  the language before recording (English or 中文; the default follows the interface language). The server
  decrypts the stored recording and sends it to `ctx.transcriber`, set up like the translator:
  `TRANSCRIBE_API_URL`, `TRANSCRIBE_API_KEY`, `TRANSCRIBE_MODEL` (all three or none), an OpenAI-compatible
  `/audio/transcriptions` endpoint called with Node's `fetch` and `FormData` (no new dependency), a 60-second
  timeout, faked in tests (`FakeTranscriber`). Without it, `features.transcription` is false: recording and
  playback still work, and the transcribe button is greyed out.
  - A glossary of Buddhist terms goes in the provider's `prompt` field, which improves their accuracy.
  - **Chinese comes back in Simplified characters** from most speech models. The transcript is converted to
    Traditional before it reaches the editor; how (an OpenCC library, a runtime dependency to approve, or a
    pass through the translator) is open until the provider is chosen.
  - The result is inserted into the draft at the cursor (or replaces an empty body); nothing is published
    automatically.
  - Capped at 20 transcriptions per leader per hour (`TRANSCRIBE_LIMITS`; cost control, doesn't flag).
    Failures answer 504 `transcription_timeout`, 502 `transcription_failed` or 503
    `transcription_unavailable`; the audio, the transcript and the provider's error body are never logged.
- **Privacy:** PRIVACY.md must say that recordings are stored encrypted, played to the class, and sent to the
  transcription provider when the leader asks for a transcript. Choosing the provider is open, like the
  translation provider's (check what it keeps, and that it is reachable from Hong Kong).

### 8.8 Android fallback (only if D10 says so)

A minimal Kotlin WebView that loads the **remote** HTTPS site, not bundled assets. The site updates itself as
it does for every other user, so the APK only changes when the wrapper changes. It uses the same session
cookies, so no credentials are stored on the device. It needs a file chooser for image inserts. Self-update
follows §9, with a SHA-256 check and signer-match check before installing (§12.4).

### 8.9 Activity, Attention list and alerts (D26, D27)

- **Activity log:** routes record `activity_events` for the kinds listed in §5. Recording never breaks the
  request it describes (a failure is logged and the request carries on). Failed logins are recorded only for
  usernames that exist: a mistyped username is often a password typed into the wrong box. A device is "new"
  when the account hasn't signed in from the same coarse device label in 90 days. Metadata only: the same rule as
  logging (no content, comments, titles or profile fields), with a test that greps events for seeded
  plaintext. A nightly job deletes events older than 90 days. PRIVACY.md says what is recorded and for how long.
- **Attention rules** (pure, in `domain/limits/attention.ts`; the thresholds are constants in
  `shared/src/warning-levels.ts`, to tune after real use): a `limit_reached` for a daily cap (not the per-entry
  limits, which honest writers meet); `elevated_activity`, a daily warning level reached (D28); a burst of
  `login_failed` for one username; several `new_device` events in one day. A rule
  that fires creates one `alerts` row, not one per event, while an unhandled alert for the same user and rule
  exists.
- **In-app first:** the Attention list (badge with the unhandled count) is always on and is the source of
  truth. It works with no email configured.
- **Thresholds (initial):** 10 failed logins for one username within an hour; 3 new devices within 24 hours;
  per day 10 creates, 10 first submissions, 25 updates, 40 submitted comments. A daily warning is counted in
  `daily_usage` with the write and fires on the write whose count lands exactly on the level, so concurrent
  writes produce one event; the route records it after the commit. All in `shared/src/warning-levels.ts`.
- **Locking** can't target yourself, and two admins locking each other at once can't leave nobody able to
  sign in (admin rows are locked and counted in one transaction, as for demotion).
- **Email, optional:** when `SMTP_URL` is set, a scheduler task sends unsent alerts to every SYS_ADMIN's account
  email, with retries, at most one email per flagged user per hour, plus a daily summary. Sending never runs in
  the request that raised the alert, so a slow or failed mailbox can't affect users. Failures are recorded on
  the alert and shown to SYS_ADMINs. Emails carry the username and rule only, written in 繁體中文 then English
  in the same message (the server doesn't know a reader's language), from the server string table (§8.10).
  - Mailbox: a dedicated QQ or 163 account (whichever the SYS_ADMINs use, for reliable delivery), SMTP enabled,
    sending with its authorization code: `smtps://<address>:<code>@smtp.qq.com:465` or `…@smtp.163.com:465`,
    with `MAIL_FROM` set to the same address. Sending from the provider's own domain avoids SPF/DKIM setup.
  - From Hong Kong (D9) these servers are reachable on port 465. The provider could still flag logins from a
    non-mainland IP; failed sends make that visible, and the in-app list keeps working.
  - Dev and CI leave `SMTP_URL` unset (alerts stay in-app), and tests fake the mailer. A Mailpit container can
    be added to the dev compose file to see real emails locally.
- The admin screen shows the mode: "Email alerts: off", or on with the recipient count and last send.

### 8.10 i18n

`web/src/i18n/{zh-Hant,en,vi}.ts` share a typed key set, so a missing key fails the type check. The server
returns error codes, not display strings. Both sites offer all three languages (D34); the default stays
繁體中文 and the choice is remembered on the device.

- **Vietnamese wording** is drafted with the code and reviewed by a Vietnamese practitioner before the
  language appears in the switch (`OFFERED_LANGS` in `web/src/i18n/messages.ts`, so the table can ship
  unoffered). Until then `?lang=vi` opens it on that device, and the switch keeps VI there (`langPreview`).
  Buddhist terms follow Vietnamese Buddhist usage, not a literal rendering of the Chinese.
- **The switch** shows three short labels (中文 · EN · VI, full names as tooltips) instead of two full names,
  so it still fits at 360 px and 22 px text.
- **Fonts:** `:root:lang(vi)` uses the Latin stack (like `:lang(en)`), because CJK fonts' Latin glyphs handle
  stacked diacritics (ệ, ở) poorly. Vietnamese text read in the Chinese interface still falls back to the CJK
  font's Latin glyphs; check it on real phones and, if it reads badly, put a Latin font first in the zh stack
  too. Vietnamese strings run longer than English, so each screen's 360 px check runs in Vietnamese as well.
- **Alert email** stays 繁體中文 then English: it goes to SYS_ADMINs only.

The one exception is alert email, which the server writes itself. Its text lives in
`server/src/i18n/{zh-Hant,en}.ts`, with the same typed-key pattern: one subject and body per attention rule, plus
the daily summary. These two string tables are the only places user-facing wording lives, so wording reviews
cover just those files.

## 9. Observability and operations (§12.7)

- pino JSON logs. A request ID goes into the `X-Request-Id` header and appears in error toasts.
- Logs redact passwords, cookies, content, comments and profile fields. A test greps the captured logs for
  seeded plaintext.
- **Activity log** for SYS_ADMINs (§8.9), metadata only, kept 90 days.
- **Read audit log:** every time a leader opens an entry, the server records (leader, document, time). It's a
  security log for investigating a stolen leader account and is **not shown to diary owners** (agreed). It
  also gives each leader their own 未讀 list (entries they haven't opened since the last submission; last 90
  days, the log's retention; never their own entries), agreed 2026-10-15.
- Error responses use the shape `{code, message, requestId}`.
- **Health checks:** `/healthz` reports that the process is up. `/readyz` checks the DB, that migrations are
  current, and that the keyrings are loaded and valid.
- **Fail-fast config:** in production the server refuses to start if a secret is missing, malformed, or equal
  to a value from `.env.example`. It logs the variable name only.
- **Backups:** a nightly `pg_dump`, encrypted to an offline recipient. The restore is tested in CI. Keyrings
  are backed up separately.

## 10. CI/CD and deploy (§12.8)

- **`ci.yml`** runs on every push and PR: format → lint → typecheck → unit → integration (Postgres service) →
  build the server and web images and smoke-test the stack → gitleaks → `npm audit`.
- **Playwright e2e** runs locally, not in CI (decided 2026-10-15): against `docker compose`, in both
  languages, at 360 px and 1280 px, including (from slice 17) PWA install and an offline shell check. Run it
  before merging a change with UI. This departs from engineering standards §12.5/§12.8, which put it in CI.
- **`release.yml`** runs on `v*` tags. It pushes an immutably tagged server image (with the web build inside or
  alongside) to a registry.
- **Deploy is written fresh.** It runs compose on the server with a TLS-terminating reverse proxy, and the
  `/internal/` paths are blocked at the proxy. A deploy backs up the DB, pulls the tag, migrates and checks
  `/readyz`. A one-command rollback returns to the previous tag. Hosting is planned for Hong Kong (D9).

## 11. Delivery plan

**Always deployable.** Every slice ends with `main` green and runnable: `docker compose up` brings up a working
stack, `/healthz` and `/readyz` pass, migrations apply from empty, and the seed loads. Nothing half-built is
reachable; unfinished routes simply don't exist yet.

### Phase A: backend first, proven by tests

Each slice delivers its API, its unit and integration tests (every role, allowed and denied), its seed data, and
its entries in the API explorer (D20), so it can be checked by hand before any screen exists.

1. **Skeleton:** workspaces, toolchain pins, lint/format/hooks, CI, compose dev stack, `scripts/dev-setup`,
   fail-fast config, structured logging with request IDs, error shape, `/healthz` + `/readyz`, migrations at
   startup, `AGENTS.md`.
2. **Core domain:** crypto keyring + DEK, authz policy table, sharing state machine, count input rules. Pure
   modules, unit-tested exhaustively.
3. **Users and auth:** schema, `create-sysadmin` CLI, CAPTCHA, login/logout, sessions and devices, register,
   forgot password, TOTP, rate limits, seed users. Activity events for logins, failed logins and new devices.
4. **SYS_ADMIN API:** users and roles, password resets, the lint rules keeping the diary keyring out of admin
   code, activity log and summary, Attention list, sign-out-all and lock, the scheduler (`job_runs`,
   advisory locks, retention) and the email sender (optional SMTP). *(Done; step 3's activity events for
   logins, failed logins and new devices were added here.)*
5. **Diary API:** create, draft, submit and update, history cap, sanitising, size caps, server-set entry date,
   daily and per-entry limits, storage usage extended to entries, seed entries in every state; SYS_ADMIN
   document metadata and deletes, and the "no plaintext for SYS_ADMIN" test (it discovers every GET endpoint
   from the OpenAPI document). *(Done. The comments table exists already, so list counts are real; the
   comment API arrives in slice 6. Until slices 6–7 add the leader and reader views, an entry answers 404 to
   anyone but its owner.)*
6. **Leader API:** lists, calendar counts, comments, open approvals, read audit. *(Done. The whole sharing
   endpoint `POST /api/documents/:id/access` arrived here, owner actions included, because approvals need
   requests and the seed now goes through it.)*
7. **Open diaries API:** the month list of open entries and the reader view of an open entry. *(Done. The
   list carries no content; expanding a row reads the entry through `GET /api/documents/:id`, which checks
   access again. Readers' reads aren't audited: the audit is for leaders.)*
8. **Account API:** profile, password change, devices, preferences. *(Done. A wrong current password answers
   `wrong_password` (403, not 401, so the app doesn't treat it as signed out) and counts toward the same
   per-username throttle as sign-in.)*
9. **報數 API:** summary, latest, settings, count date and per-date limit, admin list, delete by date range,
   scheduler, job runs. *(Done. One auto entry per user per date, enforced by a unique index, so running the
   job again the same day changes nothing. Only manual entries are `count_entry` activity. Reaching the
   per-date cap flags the account like the daily caps.)*
10. **Translation API** (faked in tests). *(Done. The app's error handler now passes deliberate `HttpError`s
    through at 5xx too, so 502/503/504 keep their codes; only unexpected errors become `internal_error`.)*

### Phase B: frontend, iteratively, against seeded data

The dev stack runs the real API with seed data, so every screen is built against realistic content in all
states. Each slice is one screen group, with Playwright e2e tests at 360 px and 1280 px in both languages.

11. **App shell:** tokens, themes, text sizes, i18n, tab bar/top bar, toasts, error states. *(Done. The
    `web` container (nginx) serves the build, sets the CSP and forwards `/api`; it is the reverse proxy that
    Phase C adds TLS to. Tabs appear as their screens are built; until then every landing goes to 我的,
    which has appearance and sign-out. Playwright visual snapshots (FRONTEND.md §5) are deferred: CJK fonts
    differ between machines, so they need a pinned browser image first.)*
12. **Login, register, forgot password.** *(Done, with the authenticator step and first-time authenticator
    setup for SYS_ADMINs. Registration takes no photo yet; it arrives with the account page in slice 16.)*
13. **My diary, entry view, editor** (Tiptap, image downscaling, photo and length limits, 提交/更新).
    *(Done, with 開放日記 (no slice listed it; it reuses the entry view). A new entry is created by its first
    save, not by 撰寫日記, so an abandoned blank page uses none of the 20 daily creates. Stored HTML is shown
    through a read-only editor with the same schema, so the browser drops anything outside the allowlist a
    second time. The CSP now allows inline style attributes (`style-src-attr`) for the font and size spans;
    `<style>` and scripts stay blocked. Font sizes are `85%`, `1.25em` and `1.5em`, because the sanitiser's
    pattern rejects `125%`; `web/test/sanitiser-agreement.test.ts` checks every toolbar value against it.
    Leaders' own diaries use these screens; the leader's review and comment editor are slice 14.)*
14. **Leader review and open requests.** *(Done. 批閱 opens on today's submitted entries; the day, page,
    page size, student and open entry live in the address. Three panes on desktop, two on tablets, and on
    phones an entry opens full screen. The comment editor shares the diary editor's toolbar and photo
    handling; its autosave only runs while the comment isn't submitted, since saving a submitted comment as a
    draft takes it away from the student. The requests badge polls every minute. Leaders' tabs: 批閱 · 申請 ·
    日記 · 我的 on phones, plus 開放日記 on desktop; 報數 joins in slice 16. Afterwards (2026-10-15): 上一篇 /
    下一篇 and a 連續閱讀 feed on every list, one page-level guard for unsaved comments (`UnsavedGuard`), and
    開放日記 read-only for leaders, with their own comment listed there. Then 開放日記 became a filtered,
    read-only feed (calendar day and author, worked out from the month's list; no page per entry), and the
    leaders got 未讀 (`?unread=true`, from the read audit). Finally (agreed 2026-10-15, "fewest clicks"):
    every list is a continuous feed; 開放申請 became a filter of the one 批閱 tab; no page per entry and no
    one-at-a-time view, so the stepper and reading pane are gone. Then (D29, 2026-10-19) the approval flow
    went: no 申請開放 filter, badge or `GET /api/leader/open-requests`; leaders keep 取消開放.)*
15. **SYS_ADMIN screens**, including Attention and activity. *(Done, except 報數管理, which comes with 報數 in
    slice 16. Password resets became a filter of 用戶 (the 等待重設 count is its tab's badge) rather than a tab.
    Tabs: 注意 · 用戶 · 日記管理 · 我的. The e2e setup signs in one SYS_ADMIN (`admin2`, with its
    authenticator code) shared by every project; `admin` stays for the sign-in form test, since a code can't
    be used twice.)*
16. **報數 and account.** *(Done. `GET /api/count/summary` gained `mine` (my number and manual reports for
    each allowed date). 報數 is a tab for every role, SYS_ADMINs included; 報數管理 is a link from it. The
    account page has profile (photo resized in the browser), appearance, storage, password (a sheet), the
    SYS_ADMIN authenticator status and, since Q1 was decided, changing it; devices; and sign-out.)*
17. **Installable web app:** manifest, service worker, update toast, install help. Then the phone check for D10.
    *(Done, except the D10 phone check, which needs real phones. `vite-plugin-pwa` (generateSW) precaches only
    the built app files; there is no runtime caching, and `/api/` is never answered by the service worker.
    The update offer is a banner rather than a toast, hidden while any editor (entry or comment) reports
    unsaved writing via `web/src/lib/unsaved.ts`. Install help is a sheet on the account page plus the
    third-visit banner on phones; icons come from `web/scripts/make-icons.mjs`.)*

### Phase D: the mantra site (D30, D31, agreed 2026-11-02)

19. **Spec and docs:** the COUNT_USER role, mantra registration and the two sites in the spec, this document
    and FRONTEND.md.
20. **The COUNT_USER role:** enum migration (`ALTER TYPE … ADD VALUE`), the policy row (報數 only), every
    hand-written role list reviewed, the admin role filter, promotion allowed and demotion from the diary
    roles refused, seed accounts; the web shell's 報數 · 我的 tabs and landing. Tests: the policy row, every
    diary, leader and translate route refused to a COUNT_USER, the role-change rules. *(Done. The rule lives in
    `canChangeRole` (`shared/src/roles.ts`), used by the server and the admin form. `documentView` also
    requires `ReadOpenDiaries` before treating anyone as a reader. Remembered devices now last 30 days only
    for leaders and admins; before, every role but NORMAL_USER got the shorter limit.)*
21. **Registration creates a COUNT_USER:** display name, email and/or phone (at least one), the phone in the
    encrypted profile, shown to admins and editable on the account page. *(Done. `isPhone` and `hasContact`
    in `shared/src/auth.ts` are the one rule for the form and the server; brackets are allowed, as in
    "(07) 5555 1234". `PUT /api/me` refuses to leave a COUNT_USER with neither (400 `contact_required`).
    Profiles saved before this read with an empty phone. The pending-reset rows show email and phone.)*
22. **Two front doors:** `VITE_SITE` builds, the mantra palette and icons, nginx on :8082, Caddy's second
    block, `MANTRA_URL`, `npm run dev:mantra`, e2e for the mantra site (register → report → sign out, axe in
    both themes, 360 px and 22 px text) and for the diary site having no register link. *(Done. `vite --mode
    mantra` builds into `web/dist-mantra` with `web/public-mantra`; `data-site` is written into each build's
    `index.html`, so the palette applies before any script runs. The routes test `import.meta.env.VITE_SITE`
    directly, which keeps every diary screen out of the mantra bundle (5 files, about half the diary's). The
    mantra site has no 報數管理 link (that screen is the diary's). The diary build has no `/register`.
    `make-env.sh` now takes both hostnames. The e2e stack serves the mantra site on :8083; `mantra.spec.ts`
    covers it, and the registration test moved there.)*
23. **Deploy docs:** the second DNS name and settings in DEPLOY-EC2.md; registration opened. *(Done.)*

### Phase E: announcements, recordings and Vietnamese (D32–D34, agreed 2026-11-13)

Vietnamese comes first: it is independent, and announcements are where translation into Vietnamese matters
most.

24. **Vietnamese UI:** `vi.ts` (drafted), `Lang` and the three-way switch, `:lang(vi)` fonts, `OFFERED_LANGS`
    keeping Vietnamese hidden until the review; the e2e `t` fixture and the 360 px / 22 px checks in
    Vietnamese. Both sites. *(Done 2026-11-13, waiting for the review. A fifth e2e project, `phone-vi`
    (student `linjy`, sharing `leader.lin`), runs every test in Vietnamese at 360 px; it found the admin
    filters overflowing, since a select is as wide as its longest option. The seed now opens a few 注意 flags,
    because each project's 注意 test handles one and five projects outran the flags other tests raise.)*
25. **Translation targets:** `target` replaces `direction` (old field accepted for one release), the prompt
    per target, one translate button. Tests: each target's prompt, the old field still answered. *(Done
    2026-11-13. Remove `direction` from `shared/src/translate.ts` in the release after this one.)*
26. **Spec and docs:** announcements in project_prompt.md and FRONTEND.md (the 課堂 screen replacing 開放日記,
    and the new tab bars).
27. **Announcements API:** schema and migration, service under `services/diary/announcements/`, routes,
    replies, reads and unread counts, limits and warning levels, activity events, SYS_ADMIN metadata list and
    delete, seed announcements with replies. Integration tests for every role, allowed and denied, including
    COUNT_USER refused on every route.
28. **Announcements screens:** 開放日記 becomes 課堂 with the type filter and announcement cards, the unread
    badge, the read view with the thread and reply box, the leader's
    editor (no recording yet), translate on announcements and replies; e2e and axe in both themes.
29. **Recordings:** audio upload, storage and playback (API and screens), caps and magic-byte checks;
    playback across iPhone and Android checked on real phones (transcoding decided here).
30. **Transcription:** `ctx.transcriber`, config and `.env.example`, the Traditional-character conversion,
    rate limit, the transcribe button; PRIVACY.md wording. Then Vietnamese goes into the switch once the
    review is done.

### Phase C: production

18. **Ops:** deploy to Hong Kong with TLS, backup/restore, key rotation, RUNBOOK, SECURITY.md, PRIVACY.md,
    release pipeline. Includes two rate-limit tasks that only matter once there is a reverse proxy:
    - Tell the server to trust the proxy's `X-Forwarded-For` (and nothing else), otherwise every visitor
      appears to come from the proxy's address and shares one per-IP limit.
    - Add coarse per-IP limits at the proxy as a first line of defence. (A staging deploy can come earlier, as soon as slice 3 is done, to exercise the pipeline.)

    *(Started 2026-10-15 with a single-server test deploy for other regions (EC2), in `deploy/` and
    docs/DEPLOY-EC2.md: Caddy for HTTPS in front of the existing web and server images, `/internal/` blocked
    at Caddy, keys from `deploy/make-env.sh`, `pg_dump` backups with a tested restore. The first rate-limit
    task is done: `TRUST_PROXY_HOPS` (2 in `deploy/`). Still to do: Hong Kong, off-site backups, key
    rotation, RUNBOOK/SECURITY/PRIVACY, the release pipeline, and limits at the proxy.)*

Each slice ships with tests, both languages where it has UI, permission tests per role, and doc updates (§12.10).

## 12. Decisions

| # | Question | Status |
|---|---|---|
| D1 | Stack | **Agreed**: §2 |
| D2 | Start fresh | **Agreed**: branch `new-site`; deploy written fresh |
| D3 | Profile encryption | **Agreed**: Option A, profile DEK wrapped by `PROFILE_KEYRING` |
| D4 | Mobile auto-login without storing passwords | **Agreed**: "remember this device" session |
| D6 | Image downscale and caps | **Agreed**: §8.3 |
| D8 | App title | **Agreed**: 修行日記 |
| D9 | Hosting region | **Agreed: Hong Kong** (no ICP filing needed, low latency to the mainland) |
| D10 | Is the Android wrapper needed? | Open: decide after testing install on users' actual phones |
| D11 | Courses | **Dropped for now**: one global COURSE_LEADER role |
| D12 | Second factor | **Agreed**: TOTP required for SYS_ADMIN, optional for others |
| D13 | 报数 scope | **Agreed**: app-wide |
| D14 | Show owners who read their entry | **Agreed: no**. The read audit stays internal |
| D18 | A leader account is deleted | **Agreed**: submitted comments stay, labelled "former leader"; drafts are deleted |
| D19 | Can a COURSE_LEADER keep a diary? | **Agreed: yes**. Other leaders read and comment on it. Changed 2026-10-15: a leader may also comment on and approve sharing for their own entry, so the leader rules have no own-entry exception (approval itself removed by D29) |
| D20 | API explorer for checking the backend by hand | **Agreed**: `@fastify/swagger` + `@fastify/swagger-ui` + `fastify-type-provider-zod` (OpenAPI from the zod schemas; assets bundled, no CDN). On by default outside production, off in production; staging sets `API_DOCS=true` |
| D21 | Usage limits against a hijacked account | **Agreed**: per user per day 20 creates, 20 first submissions, 50 updates; per entry 2 photos and 5,000 characters (framed as care for the reading leader); 20 manual count reports per count date (a report replaces that date's number, so this only limits traffic; changed 2026-10-15). §8.3, §8.5 |
| D22 | Entry dates and the submit button | **Agreed**: date = creation date, set by the server; several entries per date; no backdating. 提交 for the first submit, then 更新 |
| D23 | Backdating counts | **Agreed**: up to 5 days back; the count limit applies per count date |
| D24 | Deleting entries | **Agreed**: SYS_ADMIN only, immediate. No user delete or trash until asked for |
| D25 | Storage quota | **Agreed: none**. Daily limits and image caps bound storage; usage is shown to the user and to SYS_ADMINs |
| D26 | Spotting odd behaviour | **Agreed**: metadata-only activity log (90 days), Attention list with simple rules, sign-out-all, lock, delete counts by date range. §8.9 |
| D27 | Alerting SYS_ADMINs | **Agreed**: in-app Attention list always; email via SMTP (`nodemailer`, approved) from a QQ/163 mailbox when `SMTP_URL` is set. Web Push rejected: Android push is blocked in mainland China |
| D28 | Warning levels separate from caps | **Agreed**: limits exist to spot misuse, keep leaders' reading load manageable and keep entries lean. Caps refuse; warning levels (about half the caps, plus 40 submitted comments a day) only flag the account, once a day. Per-entry refusals no longer flag. Comments have the entry's per-entry limits. §8.3, §8.9 |
| Q1 | SYS_ADMIN resetting their own authenticator (spec §4.4 "set up / reset") | **Agreed** (2026-10-15): yes, with the password and a current code, confirmed by a code from the new app; other devices are signed out and a 注意 alert is raised. A lost authenticator is still removed by another SYS_ADMIN or the CLI (§8, sign-in) |
| D29 | Who decides sharing | **Agreed** (2026-10-19, to reduce leaders' work): the author shares, with no approval. Any leader can unshare; the author can share again only after an 更新 that changes the entry. Levels `private` / `course` / `everyone`; only `course` is offered while there is one class. Migration 0009 turned `open` and `wait_for_open` into `course` |
| D30 | Who can sign up | **Agreed** (2026-11-02): the diary stays curated (accounts created by SYS_ADMINs after an invitation outside the app). Self-registration creates a **COUNT_USER**, who reaches 報數 and the account page only. Email and/or phone required (at least one), not verified; an optional display name. Promotion COUNT_USER → NORMAL_USER is allowed; diary members are never made COUNT_USERs. SMS or email verification, and auth frameworks with phone plugins, rejected for now: a paid SMS provider (and sender registration for mainland China) and a rewrite of working auth, for dozens of signups |
| D31 | One app or two | **Agreed** (2026-11-02): two sites, `diary.gcdr.org.au` and `mantra.gcdr.org.au`, on one server, database and account system; two builds of the one web app (`VITE_SITE`), each its own installable app; sessions per site. The mantra palette follows gcdr.org.au. §8.11 |
| D32 | Course announcements | **Agreed** (2026-11-13): leaders post to the whole class (one class for now); diary members read and reply; announcements share one screen (課堂) with 開放日記, told apart by a filter; COUNT_USERs and the mantra site have none. Replies form **one thread everyone in the class sees** (rejected: replies only to leaders, or a per-announcement choice). Bodies, replies and recordings encrypted with a per-announcement DEK under `DIARY_KEYRING`, in `services/diary/`. §8.12 |
| D33 | Recording announcements | **Agreed** (2026-11-13): a leader may record an announcement in English or Chinese; the recording is **kept and the class can play it**; a speech-to-text provider transcribes it into the draft, which the leader corrects before publishing. Open: the provider, and how Simplified output becomes Traditional. §8.13 |
| D34 | Vietnamese | **Agreed** (2026-11-13): a third interface language on both sites, reviewed by a Vietnamese practitioner before it is offered; translation gains Vietnamese as a target. Alert email unchanged. §8.10, §8.6 |
| F1–F6 | Frontend decisions | **Agreed**: see FRONTEND.md §11 |
