# 修行日記 · Cultivation Diary

A private diary platform in 繁體中文, English and (once reviewed) Tiếng Việt, with supervision by course
leaders, plus a shared daily-count (報數) activity. Diaries are encrypted at rest; account administrators never see their content.

- What it does: [docs/project_prompt.md](docs/project_prompt.md)
- How it's built: [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md), screens in [docs/FRONTEND.md](docs/FRONTEND.md)
- Working on it: [AGENTS.md](AGENTS.md); running, resetting and phone testing: [docs/DEVELOPING.md](docs/DEVELOPING.md)
- A test deployment on one AWS EC2 server: [docs/DEPLOY-EC2.md](docs/DEPLOY-EC2.md)

**Status:** Phase A done (slices 1–10): skeleton; core domain; users and sign-in; SYS_ADMIN user management,
activity log, Attention list and optional email alerts; the diary (encrypted entries, drafts, 提交/更新 with
history, limits, sanitising) and SYS_ADMIN document management; the leader API (review lists, calendar,
reading submitted entries with a read audit, comments, and stopping sharing); open diaries; the account API (profile, appearance, password, devices); 報數 (count, progress, auto-submit at
02:00 Beijing, SYS_ADMIN tools); translation through an optional OpenAI-compatible provider. Phase B (the web
app) has begun: the app shell (themes, text sizes, both languages); sign-in, forgot password
and authenticator setup; my diary, the entry view, the editor (photos, limits, 提交/更新, history) and open
diaries; the leaders' review; the SYS_ADMIN screens; 報數 and the account page; the installable app (manifest,
app-shell-only service worker, offline notice, update banner, install help) (slices 11–17). Next: the D10 phone
check, then Phase C (production). The community's 報數 site (Phase D, 2026-11-02) became a separate app with
its own repository on 2026-11-16 (D39); this repository is the curated diary only. See the delivery plan in
ARCHITECTURE.md §11.

## Quick start

Requires Node 24 (see `.nvmrc`) and Docker with Compose.

```sh
npm ci
npm run dev:setup      # writes .env with throwaway development keys
npm run db:up          # PostgreSQL on 127.0.0.1:55432
npm run dev            # API on http://localhost:3000
npm run seed -- --reset # sample users; every password is password123
curl localhost:3000/readyz
npm run dev:web        # the web app on http://localhost:5173 (forwards /api to :3000)
```

Then open http://localhost:5173 and sign in as `student.full` (a normal user), `leader.voice` (a leader) or `admin.main`;
with the dev defaults the CAPTCHA answer is always 3 (`CAPTCHA_FIXED`) and admins need no authenticator code
(`SKIP_TOTP`). http://localhost:3000/docs lets you
browse and try every API endpoint (development and staging only).

Or run everything in containers: `docker compose up -d --wait --build`, then open http://localhost:8080.

## Tests

```sh
npm test                  # all tests (needs `npm run db:up` for the integration half)
npm run test:unit         # no database needed
npm run test:integration  # needs `npm run db:up`
npm run test:watch        # unit tests, re-run on save
npm run test:coverage     # all tests plus a coverage report in coverage/
npm run test:functional   # against the running stack (local only; see server/test/functional/README.md)
npm run test:e2e          # the web app in a browser, on its own throwaway stack (see web/e2e/README.md)
npm run check             # everything CI runs before the Docker and secret-scan stages
```
