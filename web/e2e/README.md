# End-to-end tests

**Part of CI** (the `e2e` job in `.github/workflows/ci.yml`, since 2026-11-14). Run them locally too before
pushing a change with UI, since CI takes longer to tell you. On failure, CI keeps the Playwright report and
traces as the `playwright-report` artifact.

Playwright drives the built web app in a browser at 360 px and 1280 px, in each language (five projects; Vietnamese at 360 px only; see
`../playwright.config.ts`). Each project signs in as its own seeded user.

## Their own stack

The tests never touch the development stack. They run against a separate Compose project,
`cultivation-diary-e2e`, with its own database and the ports in `stack.env` (app on http://localhost:8081).
Global setup, on every run:

1. builds and starts that stack, recreating the server so its per-IP limits start fresh;
2. wipes and reseeds its database, keeping the admins' new authenticator keys in `.auth/seed.json`;
3. signs each project's user in once and saves the session in `.auth/`, so tests needn't use the form.

The stack keeps running afterwards so the next run starts faster.

## Running

```sh
npx playwright install chromium   # once
npm run test:e2e                  # about 35 s, including the stack
npm run e2e:down                  # remove the test stack and its data when you're done
```

Needs `.env` from `npm run dev:setup` (it reads `POSTGRES_PASSWORD` and relies on `CAPTCHA_FIXED=true`).

Chromium starts with a fake microphone (a steady tone, allowed without a prompt; `launchOptions` in
`../playwright.config.ts`), so `voice.spec.ts` records real voice notes (MP3, as in every browser).

## Limits

The server's per-IP limits are real: 60 CAPTCHAs and 20 sign-ins a minute, and 5 forgot-password requests
an hour. They reset with each run, but tests that use them heavily run in one
project only.
