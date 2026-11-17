# Developing: how-tos

Everyday tasks for running, resetting and trying out the app on your own machine. Setup and the full command
list are in [README.md](../README.md) and [AGENTS.md](../AGENTS.md); this page covers the workflows.

## Two ways to run it

| | Dev servers (reload on save) | Whole stack in Docker |
| --- | --- | --- |
| Start | `npm run db:up`, then `npm run dev` and `npm run dev:web` | `docker compose up -d --wait --build` |
| Open | http://localhost:5173 | http://localhost:8080 |
| Good for | changing code | checking what will ship: the nginx headers, the service worker, the start-up migration |

Both use the same database (the compose `db` service), so seeded data shows up in either. Both API servers
listen on port 3000, so run only one at a time: `docker compose stop server web` before `npm run dev`.

**After changing code**, rebuild the stack: `docker compose up -d --wait --build`. The server applies new
migrations when it starts. If http://localhost:8080 still shows the old app, Docker kept the old web image:
`docker compose build web && docker compose up -d web`.

## Development shortcuts: CAPTCHA, authenticator, translator

Two settings in `.env` make signing in quick while you work. `npm run dev:setup` turns both on. The server
refuses to start with either one on when `NODE_ENV=production`, so they can't reach real users.

| Setting | When on | Turn it off to |
| --- | --- | --- |
| `CAPTCHA_FIXED=true` | Every CAPTCHA asks "1 + 2" (answer **3**), so you can sign in by hand, from the API explorer (http://localhost:3000/docs) and in automated tests | see real CAPTCHA images |
| `SKIP_TOTP=true` | SYS_ADMINs sign in with their password alone; no authenticator code is asked for | test the authenticator (next sections) |

Changing either needs only a server restart (`docker compose up -d server`, or restart `npm run dev`), not a
rebuild. The end-to-end and functional tests rely on `CAPTCHA_FIXED=true`. The e2e stack always runs with
`SKIP_TOTP=false`, so its admin signs in with a real code.

Also, if the translation url, api-key, and models are not set in `.env` no problem, the translate button will simply not be live.

## Vietnamese

Vietnamese (`web/src/i18n/vi.ts`) is in the language switch, but its wording is a draft still waiting for a
Vietnamese practitioner's review (ARCHITECTURE.md §8.10). A future language can ship hidden the same way
Vietnamese first did: leave it out of `OFFERED_LANGS` in `web/src/i18n/messages.ts`, and open any page with
`?lang=<code>` to preview it on that device (the switch then keeps it there).

## Adding a recitation

The recitations a leader can pick on 持誦 (spec §7.5, D40) are a list in the code, so every name is translated
and reviewed like the rest of the interface.

1. Add a key to `RECITATIONS` in `shared/src/count.ts` (lower case with underscores, e.g. `shurangama_mantra`).
   The list's order is the dropdown's order.
2. Add `recitation.<key>` to `web/src/i18n/en.ts`, `zh-Hant.ts` and `vi.ts`. `npm run typecheck` fails until all
   three have it. Mark the Vietnamese for the reviewer.
3. Deploy. No migration is needed.

Never remove or rename a key once a leader has used it, because old rounds would lose their name. To stop
offering one, add it to `RETIRED_RECITATIONS` in the same file. If it's the one in use, it stays selectable
until a leader picks another.

## Sample data

```sh
npm run seed -- --reset    # wipes all data, then creates the sample users and entries
```

Every password is `password123`. With the development defaults, every CAPTCHA answer is **3**.

Usernames say what each account is for, `<role>.<situation>`, and together they cover every state a screen can
show (the seed command prints the same list; `server/src/services/seed.ts` has the details).

| Username | Role | What it shows |
| --- | --- | --- |
| `admin.main` | SYS_ADMIN | Signs in through the form in e2e. Authenticator keys are printed by the seed command |
| `admin.backup` | SYS_ADMIN | The e2e tests' shared admin session; sees the other admin's alerts |
| `leader.voice` | COURSE_LEADER | Own entries with voice notes: shared, pending add/remove, a draft with a note; comments |
| `leader.reviewer` | COURSE_LEADER | No diary of their own (empty state); comments and unshares |
| `student.full` | NORMAL_USER | Every entry state: draft, shared, unshared by a leader, 4 updates (history keeps the newest 3), 2 photos, a long entry (length counter), a draft too long to submit, new, seen and draft comments, a former leader's comment |
| `student.shared` | NORMAL_USER | Shares entries with the class |
| `student.commented` | NORMAL_USER | A private entry with a submitted and a draft comment |
| `student.daily` | NORMAL_USER | Reports 1080 every day; one shared entry |
| `student.new` | NORMAL_USER | No entries yet (empty diary); one count |
| `student.exleader` | NORMAL_USER | A former leader: their shared entry keeps its voice note (D35) |
| `student.locked` | NORMAL_USER | Waiting for a password reset: can't sign in until an admin sets one |

`leader.departed` is created, comments, and is deleted again, so `student.full`'s 放生 shows a comment from a
former leader. Voice notes are a 6-second tone, as MP3 like the app's recordings, from `server/seed-assets/`.

To start from an empty database instead: `docker compose down -v` (deletes the database volume), then
`docker compose up -d --wait --build`. With no users at all, create the first admin as in production (see
"Recovering an account" below).

## Testing the authenticator

In development, admins sign in without an authenticator code (`SKIP_TOTP=true` in `.env`). To try the real
flow:

1. In `.env`, set `SKIP_TOTP=false`, then restart the server: `docker compose up -d server` (no rebuild
   needed; the setting is read at start-up). For the dev server, restart `npm run dev`.
2. Choose how to get codes:
   - **Your own phone:** clear the seeded key with
     `docker compose exec server node server/dist/cli.js reset-totp admin.main`, sign in as `admin.main`, and scan
     the QR code the app shows.
   - **No phone:** keep the seeded key and get the current code with
     `npm run cli -w server -- totp-code <key printed by the seed>`.
3. **Change the authenticator:** go to 我的 → 更換驗證器, enter the password and a code from the current app,
   scan the new QR code, and enter a code from the new app. Other devices are signed out, and the other
   admins see 換了驗證器 under 注意 (sign in as `admin.backup` to check).
4. When you're done, set `SKIP_TOTP=true` again and restart the server.

Re-seeding gives the admins new random keys, so repeat step 2 afterwards. The server refuses to start with
`SKIP_TOTP=true` when `NODE_ENV=production`.

## Recovering an account

These are the same commands used in production. Run them in the server container:

```sh
docker compose exec server node server/dist/cli.js create-sysadmin <name>  # first admin: asks for a password, then a code from the QR it shows
docker compose exec server node server/dist/cli.js set-password <name>     # any account, including the last admin
docker compose exec server node server/dist/cli.js reset-totp <name>       # lost authenticator: set up a new one at next sign-in
```

`set-password` and `reset-totp` sign the account out everywhere. In the app, an admin can do the same for
another account under 用戶 (set a password, remove the authenticator). A user who used 忘記密碼 appears there
as waiting for a reset.

## Trying the app on a phone

The compose stack only listens on this computer (`127.0.0.1`), so a phone can't open it over Wi-Fi. Also,
installing the app and offline use need HTTPS (or `localhost`). Two ways round both:

- **Android, over USB:** turn on USB debugging on the phone, connect it, and run `adb reverse tcp:8080 tcp:8080`.
  Chrome on the phone can then open http://localhost:8080, and its menu offers **Install app** (confirmed
  working, 2026-10-15).
- **iPhone (or Android without a cable):** use an HTTPS tunnel, such as
  `cloudflared tunnel --url http://localhost:8080`, and open the `https://…` address it prints. In Safari:
  Share → **Add to Home Screen**. Note that the tunnel puts the app on the public internet, where every
  sample account's password is `password123`. Stop the tunnel as soon as you're done, and never run one
  against real data.

On the real deployment (HTTPS, Phase C), users just open the address and install it the same way. The app's
account page (加到主畫面) shows these steps for the phone it's on.

## Tests

There are four kinds. CI runs unit, integration and end-to-end tests (plus format, lint, typecheck, the image
build, the secret scan and the dependency audit). Functional tests are for you to run before merging a change
they cover; run end-to-end tests locally too before pushing a UI change.

| Kind | What it checks | Needs | Command |
| --- | --- | --- | --- |
| Unit | Pure logic with exact inputs and outputs: permissions, 報數 input, Beijing dates, crypto, the web app's rules | nothing | `npm run test:unit` |
| Integration | The API on a fresh database with a controllable clock: every role, allowed and denied | `npm run db:up` | `npm run test:integration` |
| Functional | The running Docker stack over real HTTP with its real settings, e.g. per-IP rate limits | the stack, freshly restarted | `docker compose restart server`, then `npm run test:functional` |
| End-to-end | The web app in a real browser (Chromium): 360 px and 1280 px, every language, axe accessibility checks | Docker; Chromium once via `npx playwright install chromium` | `npm run test:e2e` |

Other useful commands:

```sh
npm run check            # CI's fast checks (format, lint, types, unit, integration): run before pushing
npm test                 # unit and integration together
npm run test:watch       # unit tests, re-run on save
npm run test:coverage    # all tests, with an HTML report in coverage/
npx vitest run server/test/integration/account.test.ts      # one file
npx playwright test -c web/playwright.config.ts pwa count   # only some e2e files
```

**Integration tests** each get their own throwaway database, so they never touch your data.

**End-to-end tests** start their own stack (`cultivation-diary-e2e`, app on http://localhost:8081), reseed it on
every run, and never touch your development data. It stays running between runs for speed; remove it with
`npm run e2e:down`. Details:
[web/e2e/README.md](../web/e2e/README.md).

**Functional tests** use up your machine's sign-in limit for a minute, so restart the server afterwards if
you want to sign in by hand straight away. Details:
[server/test/functional/README.md](../server/test/functional/README.md).
