/**
 * End-to-end tests (engineering standards §12.5): the built app against its own Docker stack, at a phone and
 * a desktop width, in each language. Runs in CI and locally. See e2e/README.md.
 */
import { defineConfig, devices } from '@playwright/test';
import type { E2eOptions } from './e2e/fixtures.js';
import { stackAddresses } from './e2e/stack.js';

// Always the tests' own stack (e2e/stack.ts), which global setup starts and reseeds.
const { baseURL } = stackAddresses();
const phone = { ...devices['Pixel 7'], viewport: { width: 360, height: 740 } };
const desktop = { ...devices['Desktop Chrome'], viewport: { width: 1280, height: 800 } };

export default defineConfig<E2eOptions>({
  testDir: './e2e',
  globalSetup: './e2e/global-setup.ts',
  // The server's per-IP sign-in limits are real here, so keep the pace modest.
  workers: 2,
  retries: process.env.CI ? 1 : 0,
  forbidOnly: Boolean(process.env.CI),
  reporter: process.env.CI ? [['list'], ['html', { open: 'never' }]] : 'list',
  use: { baseURL, trace: 'retain-on-failure', screenshot: 'only-on-failure' },
  // Each project signs in as its own seeded user, so projects running side by side never share settings.
  // Leaders are shared by two or three projects, so leader tests work on entries their own test just created.
  projects: [
    {
      name: 'phone-zh',
      use: { ...phone, lang: 'zh-Hant', user: 'student.full', leader: 'leader.voice' },
    },
    {
      name: 'phone-en',
      use: { ...phone, lang: 'en', user: 'student.shared', leader: 'leader.reviewer' },
    },
    {
      name: 'desktop-zh',
      use: { ...desktop, lang: 'zh-Hant', user: 'student.commented', leader: 'leader.voice' },
    },
    {
      name: 'desktop-en',
      use: { ...desktop, lang: 'en', user: 'student.daily', leader: 'leader.reviewer' },
    },
    // Vietnamese runs longest, so it gets the narrow screen (D34).
    {
      name: 'phone-vi',
      use: { ...phone, lang: 'vi', user: 'student.new', leader: 'leader.voice' },
    },
  ],
});
