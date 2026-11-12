/**
 * The mantra site (ARCHITECTURE §8.11, D31): its own build on its own port, showing 報數 and 我的 only, in
 * its own palette, and the only place to register. Every test here runs against it. Sessions saved for the
 * diary work here too: locally both sites are `localhost`, and cookies ignore the port.
 */
import {
  expect,
  expectNoAxeViolations,
  expectNoSidewaysScroll,
  optionalField,
  test,
  unusedUsername,
} from './fixtures.js';
import { stackAddresses } from './stack.js';

test.use({ baseURL: stackAddresses().mantraURL });

test('is its own installable app, with a way to register', async ({ page, t }) => {
  await page.goto('/login');
  await expect(page).toHaveTitle(t('app.titleMantra'));
  await expect(page.locator('html')).toHaveAttribute('data-site', 'mantra');
  await expect(page.getByText(t('app.titleMantra'), { exact: true })).toBeVisible();
  const manifest = await (await page.request.get('/manifest.webmanifest')).json();
  expect(manifest).toMatchObject({ name: '大悲咒共修報數', theme_color: '#29382F' });
  await expect(page.getByRole('link', { name: t('auth.toRegister') })).toBeVisible();
});

test('shows 報數 and 我的 to everyone, diary members included, and no diary', async ({
  userPage: page,
  t,
}) => {
  await page.goto('/');
  await expect(page).toHaveURL(/\/count$/);
  const nav = page.getByRole('navigation', { name: t('nav.label') });
  await expect(nav.getByRole('link')).toHaveText([t('nav.count'), t('nav.me')]);
  await page.goto('/diary');
  await expect(page.getByText(t('state.notFound'))).toBeVisible();
});

test('a SYS_ADMIN reports here like anyone, and manages 報數 on the diary site', async ({
  adminPage: page,
  t,
}) => {
  await page.goto('/count');
  await expect(page.getByRole('heading', { name: t('count.title') })).toBeVisible();
  await expect(page.getByRole('link', { name: t('count.manage') })).toHaveCount(0);
});

// One page load per public screen: each fetches a CAPTCHA, and the server allows 60 a minute per address.
test('its screens pass axe in both themes and need no sideways scrolling at the largest size', async ({
  page,
  mantraPage,
  t,
}) => {
  for (const path of ['/login', '/register']) {
    await page.emulateMedia({ colorScheme: 'light' });
    await page.goto(path);
    await expect(page.getByRole('img').first()).toBeVisible();
    await expectNoAxeViolations(page);
    await page.emulateMedia({ colorScheme: 'dark' });
    await expectNoAxeViolations(page);
    await page.evaluate(() => (document.documentElement.style.fontSize = '22px'));
    await expectNoSidewaysScroll(page);
  }
  for (const path of ['/count', '/me']) {
    await mantraPage.emulateMedia({ colorScheme: 'light' });
    await mantraPage.goto(path);
    await expect(mantraPage.getByRole('heading', { level: 1 })).toBeVisible();
    await expectNoAxeViolations(mantraPage);
    await mantraPage.emulateMedia({ colorScheme: 'dark' });
    await expectNoAxeViolations(mantraPage);
    await mantraPage.evaluate(() => (document.documentElement.style.fontSize = '22px'));
    await expectNoSidewaysScroll(mantraPage);
  }
  await expect(mantraPage.getByText(t('register.contactHint'))).toBeVisible();
});

test.describe('one project only (the server allows few of these per hour)', () => {
  test.skip(({ lang, viewport }) => lang !== 'zh-Hant' || (viewport?.width ?? 0) >= 1024);

  test('registering makes a mantra-only account, leads to sign-in with the username filled in, and works', async ({
    page,
    t,
  }) => {
    const username = unusedUsername('e2e');
    await page.goto('/login');
    await page.getByRole('link', { name: t('auth.toRegister') }).click();

    await page.getByLabel(t('auth.username')).fill(username);
    await optionalField(page, t('register.displayName')).fill('測試');
    await page.getByLabel(t('auth.password'), { exact: true }).fill('long-enough-pass');
    await page.getByLabel(t('register.confirmPassword'), { exact: true }).fill('different-pass');
    await page.getByLabel(t('auth.captchaAnswer')).fill('3');
    await page.getByRole('button', { name: t('register.submit') }).click();
    // Caught before anything is sent (spec §4.2): the mismatch, and no email or phone.
    await expect(page.getByText(t('register.mismatch'))).toBeVisible();
    await expect(page.getByText(t('register.contactRequired'))).toBeVisible();

    await page.getByLabel(t('register.phone'), { exact: true }).fill('(07) 5555 1234');
    await page.getByLabel(t('register.confirmPassword'), { exact: true }).fill('long-enough-pass');
    await page.getByRole('button', { name: t('register.submit') }).click();

    await expect(page).toHaveURL(/\/login$/);
    await expect(page.getByRole('status').filter({ hasText: t('register.done') })).toBeVisible();
    await expect(page.getByLabel(t('auth.username'))).toHaveValue(username);
    await page.getByLabel(t('auth.password'), { exact: true }).fill('long-enough-pass');
    await page.getByLabel(t('auth.captchaAnswer')).fill('3');
    await page.getByRole('button', { name: t('auth.login'), exact: true }).click();
    // Mantra only: 報數 and 我的, and the display name stands in for the username.
    await expect(page).toHaveURL(/\/count$/);
    await page.getByRole('link', { name: t('nav.me'), exact: true }).click();
    await expect(page.getByText('測試', { exact: true })).toBeVisible();
    await expect(page.getByLabel(t('register.phone'))).toHaveValue('(07) 5555 1234');
  });
});
