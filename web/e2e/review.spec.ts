/**
 * The leader's review (FRONTEND.md §4.7, spec §6.3–6.4, §5.3–5.4): one feed of whole entries, chosen by 未讀,
 * 申請開放, a day or a student. Each test's student writes a fresh entry through the API, so tests never depend
 * on each other or on the other project sharing the same leader.
 */
import AxeBuilder from '@axe-core/playwright';
import type { Page } from '@playwright/test';
import { expect, test } from './fixtures.js';

interface Created {
  id: string;
  title: string;
}

/** The student creates and submits an entry (and optionally shares it with their class), through the API. */
async function submittedEntry(page: Page, word: string, share = false): Promise<Created> {
  const title = `${word} ${Date.now().toString(36)}${Math.floor(Math.random() * 1e4)}`;
  const me = await (await page.request.get('/api/me')).json();
  const headers = { 'x-csrf-token': me.csrfToken as string };
  const created = await (
    await page.request.post('/api/documents', {
      headers,
      data: { title, body: '<p>今天念佛。</p>' },
    })
  ).json();
  const submit = await page.request.post(`/api/documents/${created.id}/submit`, {
    headers,
    data: { title, body: '<p>今天念佛。</p>' },
  });
  expect(submit.ok()).toBe(true);
  if (share) {
    const request = await page.request.post(`/api/documents/${created.id}/access`, {
      headers,
      data: { action: 'share', scope: 'course' },
    });
    expect(request.ok()).toBe(true);
  }
  return { id: created.id as string, title };
}

/** What the student sees of the entry, through the API. */
async function ownerView(page: Page, id: string) {
  return (await page.request.get(`/api/documents/${id}`)).json();
}

/** A call as the signed-in user of `page`, with its CSRF token. */
async function apiAs(page: Page, method: 'POST' | 'PUT', path: string, data: object) {
  const me = await (await page.request.get('/api/me')).json();
  const response = await page.request.fetch(path, {
    method,
    headers: { 'x-csrf-token': me.csrfToken as string },
    data,
  });
  expect(response.ok(), `${method} ${path}`).toBe(true);
}

const thisMonth = () =>
  new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Shanghai',
    year: 'numeric',
    month: '2-digit',
  }).format(new Date());

/** Opens the filters, which fold under a summary line on phones. */
async function openFilters(page: Page) {
  // The screen loads lazily: wait for its filters, folded (phones) or beside the feed.
  await expect(page.locator('details, aside').first()).toBeVisible();
  const fold = page.locator('details');
  if ((await fold.count()) > 0 && !(await fold.evaluate((d) => (d as HTMLDetailsElement).open))) {
    await fold.locator('summary').click();
  }
}

/** An entry in the feed, scrolled to so it loads (which is when the server records the read). */
async function inFeed(page: Page, title: string) {
  const item = page.getByRole('listitem').filter({ hasText: title });
  // Retried: right after a filter change, the outgoing feed can still hold a matching item.
  await expect(async () => {
    await item.scrollIntoViewIfNeeded({ timeout: 2_000 });
    await expect(item.getByRole('article')).toBeVisible({ timeout: 2_000 });
  }).toPass();
  return item;
}

test('today’s entries show at once; a draft comment stays hidden until it is submitted', async ({
  userPage,
  leaderPage: page,
  t,
}) => {
  const entry = await submittedEntry(userPage, 'Review');
  // 批閱 (a leader's home, spec §4.1) opens on today's entries.
  await page.goto('/review');
  const item = await inFeed(page, entry.title);

  // Nothing written yet: a small button, not an empty editor.
  await item.getByRole('button', { name: t('comment.write') }).click();
  await item.getByRole('textbox', { name: t('comment.body') }).click();
  await page.keyboard.type('Keep going.');
  await item.getByRole('button', { name: t('comment.saveDraft') }).click();
  await expect(item.getByText(t('comment.draft'))).toBeVisible();
  expect((await ownerView(userPage, entry.id)).comments).toEqual([]);

  await item.getByRole('button', { name: t('comment.submit') }).click();
  await expect(item.getByRole('button', { name: t('comment.edit') })).toBeVisible();
  const comments = (await ownerView(userPage, entry.id)).comments;
  expect(comments).toHaveLength(1);
  expect(comments[0].body).toContain('Keep going.');

  // The student sees it under their entry; it is a conversation now, so it can't go back to only me (D37).
  await userPage.goto('/diary');
  const own = await inFeed(userPage, entry.title);
  await expect(own.getByText('Keep going.')).toBeVisible();
  await expect(own.getByRole('radio', { name: t('audience.me'), exact: true })).toBeDisabled();
  await expect(own.getByText(t('audience.meLocked'))).toBeVisible();
});

test('a posted comment reads like the others until 編輯 opens it again', async ({
  userPage,
  leaderPage: page,
  t,
}) => {
  const entry = await submittedEntry(userPage, 'Posted');
  await page.goto('/review');
  const item = await inFeed(page, entry.title);
  await item.getByRole('button', { name: t('comment.write') }).click();
  const box = item.getByRole('textbox', { name: t('comment.body') });
  await box.click();
  await page.keyboard.type('First thought.');
  await item.getByRole('button', { name: t('comment.submit') }).click();

  await expect(box).toHaveCount(0);
  await expect(item.getByText('First thought.')).toBeVisible();
  await item.getByRole('button', { name: t('comment.edit') }).click();
  await expect(box).toContainText('First thought.');
  await item.getByRole('button', { name: t('common.cancel') }).click();
  await expect(box).toHaveCount(0);
});

test('a shared entry has no notice in review, just its chip and a small 取消開放', async ({
  userPage,
  leaderPage: page,
  t,
}) => {
  const entry = await submittedEntry(userPage, 'Shared', true);
  await page.goto('/review');
  const item = await inFeed(page, entry.title);
  await expect(item.getByText(t('chip.class'), { exact: true })).toBeVisible();
  await item.getByRole('button', { name: t('unshare.button') }).click();
  const dialog = page.getByRole('dialog', { name: t('unshare.title') });
  await dialog.getByRole('button', { name: t('unshare.button') }).click();
  await expect(page.getByText(t('unshare.done'))).toBeVisible();
  expect((await ownerView(userPage, entry.id)).access).toBe('private');

  // The student sees why, and can't share it again until they've updated it.
  await userPage.goto(`/diary/${entry.id}/edit`);
  await expect(userPage.getByText(t('share.unsharedByLeader'))).toBeVisible();
  await expect(
    userPage.getByRole('radio', { name: t('audience.class'), exact: true }),
  ).toBeDisabled();
});

test('changing the filter with an unsaved comment asks first', async ({
  userPage,
  leaderPage: page,
  t,
}) => {
  const entry = await submittedEntry(userPage, 'Unsaved');
  await page.goto('/review');
  const item = await inFeed(page, entry.title);
  await item.getByRole('button', { name: t('comment.write') }).click();
  await item.getByRole('textbox', { name: t('comment.body') }).click();
  await page.keyboard.type('Half a thought');

  await openFilters(page);
  await page.getByRole('button', { name: new RegExp(t('review.unread'), 'i') }).click();
  const dialog = page.getByRole('dialog', { name: t('leave.title') });
  await dialog.getByRole('button', { name: t('leave.stay') }).click();
  await expect(item.getByRole('textbox', { name: t('comment.body') })).toContainText(
    'Half a thought',
  );
});

test('the day’s feed pages, with an adjustable page size', async ({ leaderPage: page, t }) => {
  await page.goto('/review?size=1');
  const pages = page.getByRole('navigation', { name: t('review.pages') });
  await pages.getByRole('button', { name: t('review.page', { n: 2 }), exact: true }).click();
  await expect(page).toHaveURL(/page=2/);
  await expect(
    pages.getByRole('button', { name: t('review.page', { n: 2 }), exact: true }),
  ).toHaveAttribute('aria-current', 'page');
  await expect(page.locator('ol > li')).toHaveCount(1);
});

test('a student’s month shows their entries', async ({ userPage, leaderPage: page }) => {
  const entry = await submittedEntry(userPage, 'Month');
  const me = await (await userPage.request.get('/api/me')).json();
  const name = `${me.user.profile.familyName}${me.user.profile.givenName}`;
  await page.goto('/review');
  await openFilters(page);
  await page.getByRole('button', { name: new RegExp(name) }).click();
  await expect(page).toHaveURL(/user=/);
  await inFeed(page, entry.title);
  await expect(page.getByRole('heading', { name: new RegExp(name) }).first()).toBeVisible();
});

test('a comment written during review shows in 開放日記 on a shared entry, read-only there', async ({
  userPage,
  leaderPage: page,
  t,
}) => {
  const entry = await submittedEntry(userPage, 'Shared', true);
  await page.goto('/review');
  const item = await inFeed(page, entry.title);
  await item.getByRole('button', { name: t('comment.write') }).click();
  await item.getByRole('textbox', { name: t('comment.body') }).click();
  await page.keyboard.type('Well done.');
  await item.getByRole('button', { name: t('comment.submit') }).click();
  await expect(item.getByRole('button', { name: t('comment.edit') })).toBeVisible();

  // 開放日記 is for reading: the leader's own comment is listed with the others, without an editor.
  await page.goto(`/open?month=${thisMonth()}`);
  const open = await inFeed(page, entry.title);
  await expect(open.getByText('Well done.')).toBeVisible();
  await expect(open.getByRole('button', { name: t('comment.edit') })).toHaveCount(0);

  const owner = await (await userPage.request.get(`/api/documents/${entry.id}`)).json();
  expect(owner.comments.map((c: { body: string }) => c.body).join()).toContain('Well done.');
});

test('未讀 lists what the leader hasn’t read, until they read it, and again after an update', async ({
  userPage,
  leaderPage: page,
  t,
}) => {
  const entry = await submittedEntry(userPage, 'Unread');
  await page.goto('/review?unread=true');
  await expect(
    page.getByRole('heading', { name: t('review.unreadHeading') }).first(),
  ).toBeVisible();
  // Reading it in the feed is what the server records.
  await inFeed(page, entry.title);

  // Pressing 未讀 again refreshes the list, which held still while reading.
  await openFilters(page);
  // "未讀 3 篇" / "3 unread": the word, whatever the count.
  const unread = page.getByRole('button', { name: new RegExp(t('review.unread'), 'i') });
  await unread.click();
  await expect(page.getByRole('listitem').filter({ hasText: entry.title })).toHaveCount(0);

  await apiAs(userPage, 'POST', `/api/documents/${entry.id}/submit`, {
    title: entry.title,
    body: '<p>今天念佛，又加了一句。</p>',
  });
  await unread.click();
  await expect(page.getByRole('listitem').filter({ hasText: entry.title })).toHaveCount(1);
});

test('批閱 passes axe in both themes and fits at the largest text size', async ({
  leaderPage: page,
  t,
}) => {
  await page.goto('/review');
  const first = page
    .getByRole('listitem')
    .filter({ has: page.getByRole('article') })
    .first();
  await expect(first).toBeVisible();
  // With a comment editor open as well.
  await page
    .getByRole('button', { name: t('comment.write') })
    .first()
    .click();
  await openFilters(page);
  for (const scheme of ['light', 'dark'] as const) {
    await page.emulateMedia({ colorScheme: scheme });
    const results = await new AxeBuilder({ page }).analyze();
    expect(results.violations.map((v) => `${v.id}: ${v.nodes.map((n) => n.target)}`)).toEqual([]);
  }
  await page.evaluate(() => (document.documentElement.style.fontSize = '22px'));
  const overflow = await page.evaluate(
    () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
  );
  expect(overflow).toBeLessThanOrEqual(0);
});
