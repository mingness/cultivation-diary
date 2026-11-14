/**
 * The app shell (FRONTEND.md §1–3, §8): language, text size and theme, navigation, and accessibility in
 * both themes. Every screen built so far gets an axe check here.
 */
import { expect, expectNoAxeViolations, expectNoSidewaysScroll, test } from './fixtures.js';

test('the language switch shows the language in use, switches every string and is remembered', async ({
  page,
  t,
  lang,
}) => {
  // Three buttons (Vietnamese in use) shorten the Latin names.
  const names =
    lang === 'vi'
      ? ({ 'zh-Hant': '中文', en: 'EN', vi: 'VI' } as const)
      : ({ 'zh-Hant': '中文', en: 'English', vi: 'Tiếng Việt' } as const);
  const other = lang === 'zh-Hant' ? 'en' : 'zh-Hant';
  await page.goto('/login');
  await expect(page.locator('html')).toHaveAttribute('lang', lang);
  const languages = page.getByRole('group', { name: t('lang.label') });
  await expect(languages.getByRole('button', { name: names[lang] })).toHaveAttribute(
    'aria-pressed',
    'true',
  );
  await languages.getByRole('button', { name: names[other] }).click();

  await expect(page.locator('html')).toHaveAttribute('lang', other);
  await page.reload();
  await expect(page.locator('html')).toHaveAttribute('lang', other);
  await expect(page.getByRole('button', { name: t('auth.login'), exact: true })).toHaveCount(0);
});

test('?lang=vi previews Vietnamese, and the switch keeps it on that device only', async ({
  page,
  browser,
  lang,
}) => {
  test.skip(lang !== 'zh-Hant', 'one project is enough; each load costs a CAPTCHA');
  await page.goto('/login?lang=vi');
  await expect(page.locator('html')).toHaveAttribute('lang', 'vi');
  const languages = page.getByRole('group');
  await expect(languages.getByRole('button', { name: 'VI' })).toHaveAttribute(
    'aria-pressed',
    'true',
  );
  await languages.getByRole('button', { name: '中文' }).click();
  await page.reload();
  await expect(page.getByRole('group').getByRole('button', { name: 'VI' })).toBeVisible();

  // Another device, without the preview, isn't offered Vietnamese.
  const other = await browser.newPage();
  await other.goto('/login');
  await expect(other.getByRole('group').getByRole('button')).toHaveText(['中文', 'English']);
  await other.close();
});

// One page load per screen: the server allows 60 CAPTCHAs a minute per address, and every public screen
// fetches one. The theme and text size can both change without a reload.
test('public screens pass axe in both themes and need no sideways scrolling at the largest size', async ({
  page,
}) => {
  // Registering is on the mantra site (mantra.spec.ts).
  for (const path of ['/login', '/forgot-password']) {
    await page.emulateMedia({ colorScheme: 'light' });
    await page.goto(path);
    await expect(page.getByRole('img').first()).toBeVisible();
    await expectNoAxeViolations(page);
    await page.emulateMedia({ colorScheme: 'dark' });
    await expectNoAxeViolations(page);
    await page.evaluate(() => (document.documentElement.style.fontSize = '22px'));
    await expectNoSidewaysScroll(page);
  }
});

test('the account screen passes axe in both themes', async ({ userPage, t }) => {
  await userPage.goto('/me');
  await expect(userPage.getByRole('heading', { name: t('account.appearance') })).toBeVisible();
  for (const scheme of ['light', 'dark'] as const) {
    await userPage.emulateMedia({ colorScheme: scheme });
    await expectNoAxeViolations(userPage);
  }
});

test('text size and theme are saved to the account and applied at once', async ({
  userPage,
  t,
}) => {
  await userPage.goto('/me');
  const html = userPage.locator('html');
  await userPage.getByRole('radio', { name: t('account.size22'), exact: true }).check();
  await userPage.getByRole('radio', { name: t('account.themeDark'), exact: true }).check();
  await expect(html).toHaveCSS('font-size', '22px');
  await expect(html).toHaveAttribute('data-theme', 'dark');
  await expectNoSidewaysScroll(userPage);

  // Stored on the server: a device with nothing cached gets them back after sign-in. The two saves run one
  // after the other, so wait for them to finish before reloading.
  await userPage.waitForLoadState('networkidle');
  await userPage.evaluate(() => localStorage.clear());
  await userPage.reload();
  await expect(html).toHaveCSS('font-size', '22px');
  await expect(html).toHaveAttribute('data-theme', 'dark');

  await userPage.getByRole('radio', { name: t('account.size18'), exact: true }).check();
  await userPage.getByRole('radio', { name: t('account.themeSystem'), exact: true }).check();
  await expect(html).toHaveCSS('font-size', '18px');
  await expect(html).not.toHaveAttribute('data-theme');
});

test('unknown addresses show "not found" inside the app', async ({ userPage, t }) => {
  await userPage.goto('/no-such-page');
  await expect(userPage.getByRole('heading', { name: t('state.notFound') })).toBeVisible();
  await expect(userPage.getByRole('navigation', { name: t('nav.label') })).toBeVisible();
});

test('English and Vietnamese text use Latin fonts first, so punctuation isn’t full-width', async ({
  page,
  lang,
}) => {
  test.skip(lang === 'zh-Hant', 'Chinese keeps its full-width punctuation');
  await page.goto('/login');
  // The apostrophe's width relative to the text size, in the interface font and the diary font.
  const widths = await page.evaluate(() =>
    ['--font-ui', '--font-serif'].map((token) => {
      const span = document.createElement('span');
      span.style.fontFamily = `var(${token})`;
      span.style.fontSize = '100px';
      span.style.whiteSpace = 'pre';
      span.textContent = '’';
      document.body.append(span);
      const width = span.getBoundingClientRect().width / 100;
      span.remove();
      return width;
    }),
  );
  for (const width of widths) expect(width).toBeLessThan(0.5);
});
