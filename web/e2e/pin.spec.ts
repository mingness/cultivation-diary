/**
 * Pinned entries and leaders' notices (D36, FRONTEND.md §4.4). Two or three projects share each leader and a
 * leader may pin 3 entries at once, so every test pins one entry it created and unpins it before it ends.
 */
import type { Page } from '@playwright/test';
import { expect, expectNoAxeViolations, sendToLeaders, test } from './fixtures.js';

const SAVED = /\/diary\/[0-9a-f-]{36}\/edit$/;

async function csrf(page: Page) {
  return { 'x-csrf-token': (await (await page.request.get('/api/me')).json()).csrfToken as string };
}

async function inFeed(page: Page, title: string) {
  const item = page.getByRole('listitem').filter({ hasText: title });
  await expect(async () => {
    await item.scrollIntoViewIfNeeded({ timeout: 2_000 });
    await expect(item.getByRole('article')).toBeVisible({ timeout: 2_000 });
  }).toPass();
  return item;
}

test('a leader’s 提交 says who can read it, and a pinned entry heads every month of 開放日記', async ({
  leaderPage: page,
  userPage,
  t,
}) => {
  const title = `Pinned ${Date.now().toString(36)}${Math.floor(Math.random() * 1e4)}`;
  await page.goto('/diary/new/edit');
  await page.getByLabel(t('editor.title')).fill(title);
  await page.getByRole('textbox', { name: t('editor.body') }).click();
  await page.keyboard.type('共修通知');
  await sendToLeaders(page, t, true);
  // A leader's entry goes to the other leaders, not to "your leaders".
  await expect(page.getByText(t('editor.submittedLeader'))).toBeVisible();
  await expect(page).toHaveURL(SAVED);
  const id = page.url().split('/').at(-2)!;
  const share = await page.request.post(`/api/documents/${id}/access`, {
    headers: await csrf(page),
    data: { action: 'share', scope: 'course' },
  });
  expect(share.ok()).toBe(true);

  // The leader pins it from their own diary.
  await page.goto('/diary');
  const own = await inFeed(page, title);
  await own.getByRole('checkbox', { name: t('pin.label') }).check();
  await expect(page.getByText(t('pin.pinned'))).toBeVisible();

  try {
    // A student sees it on top of a month long before it was written.
    await userPage.goto('/open?month=2020-01');
    const pinned = userPage.getByRole('region', { name: t('open.pinned') });
    await expect(pinned.getByRole('heading', { name: title })).toBeVisible();
    for (const scheme of ['light', 'dark'] as const) {
      await userPage.emulateMedia({ colorScheme: scheme });
      await expectNoAxeViolations(userPage);
    }

    // To its author it is marked as their own.
    await page.goto('/open?month=2020-01');
    const mine = await inFeed(page, title);
    await expect(mine.getByText(t('entry.mine'), { exact: true })).toBeVisible();
  } finally {
    await page.goto('/diary');
    await (await inFeed(page, title)).getByRole('checkbox', { name: t('pin.label') }).uncheck();
    await expect(page.getByText(t('pin.unpinned'))).toBeVisible();
  }
  await userPage.goto('/open?month=2020-01');
  await expect(userPage.getByRole('heading', { name: title })).toHaveCount(0);
});
