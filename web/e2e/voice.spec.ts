/**
 * Leaders' voice notes (D35, FRONTEND.md §4.3–4.4), recorded from Chromium's fake microphone (a steady tone;
 * see playwright.config.ts). Two or three projects share each leader, so every test works on an entry it
 * creates itself.
 */
import type { Locator, Page } from '@playwright/test';
import {
  expect,
  expectNoAxeViolations,
  expectNoSidewaysScroll,
  test,
  sendToLeaders,
  type Fixtures,
} from './fixtures.js';

const SAVED = /\/diary\/[0-9a-f-]{36}\/edit$/;
const uniqueTitle = (word: string) => `${word} ${Date.now().toString(36)}`;

/**
 * Presses play on the `index`th note in `scope` and waits until its sound is really moving: a download
 * alone proves little (the Content-Security-Policy once blocked every note after it had downloaded).
 */
async function expectPlays(scope: Locator, t: Fixtures['t'], index: number, label: string) {
  await scope.getByRole('button', { name: `${t('voice.play')} ${label}` }).click();
  await expect
    .poll(() =>
      scope
        .locator('audio')
        .nth(index)
        .evaluate((a: HTMLAudioElement) => a.currentTime),
    )
    .toBeGreaterThan(0.2);
  await expect(scope.getByText(t('voice.playFailed'))).toHaveCount(0);
}

/** Opens the recorder, records about a second and a half, and stops. */
async function recordNote(page: Page, t: Fixtures['t']) {
  await page.getByRole('button', { name: t('voice.record'), exact: true }).click();
  const sheet = page.getByRole('dialog', { name: t('voice.heading') });
  await expect(sheet.getByRole('timer')).toBeVisible();
  await page.waitForTimeout(1500);
  await sheet.getByRole('button', { name: t('voice.stop') }).click();
  await expect(sheet.getByRole('button', { name: t('voice.keep') })).toBeVisible();
  // 試聽 plays the recording before it is kept.
  await expectPlays(sheet, t, 0, t('voice.listen'));
  return sheet;
}

test('a leader records a note on a new entry, and 提交 makes it part of the entry', async ({
  leaderPage: page,
  t,
}) => {
  const title = uniqueTitle('Voice');
  await page.goto('/diary/new/edit');
  await page.getByLabel(t('editor.title')).fill(title);

  const sheet = await recordNote(page, t);
  await sheet.getByRole('button', { name: t('voice.keep') }).click();
  // Keeping a note on a new entry saved the entry first.
  await expect(sheet).toBeHidden();
  await expect(page).toHaveURL(SAVED);
  const id = page.url().split('/').at(-2)!;
  const note1 = t('voice.note', { n: 1 });
  await expect(page.getByText(t('voice.pending'), { exact: true })).toBeVisible();

  // Kept, but waiting for 提交 (who may hear what is the server's job; see voice-notes.test.ts).
  const before = await (await page.request.get(`/api/documents/${id}`)).json();
  expect(before.audio).toEqual([expect.objectContaining({ pending: 'add' })]);

  await sendToLeaders(page, t, true);
  await expect(page.getByText(t('voice.pending'), { exact: true })).toHaveCount(0);
  const after = await (await page.request.get(`/api/documents/${id}`)).json();
  expect(after.audio).toEqual([expect.objectContaining({ pending: null })]);
  expect(after.audio[0].durationMs).toBeGreaterThan(500);

  // The diary feed plays it, downloading it only now.
  await page.goto('/diary');
  const item = page.getByRole('listitem').filter({ hasText: title });
  await item.scrollIntoViewIfNeeded();
  const download = page.waitForResponse((r) => r.url().includes(`/api/documents/${id}/audio/`));
  await expectPlays(item, t, 0, note1);
  const response = await download;
  expect(response.status()).toBe(200);
  expect(response.headers()['content-type']).toBe('audio/mpeg');
  expect(response.headers()['cache-control']).toBe('no-store');
});

test('readers play the seeded notes in 開放日記', async ({ userPage: page, t }) => {
  await page.goto('/open');
  // Pinned entries may come first; an entry further down is only a title until it is scrolled near.
  const item = page.getByRole('listitem').filter({ hasText: '今晚共修的提醒' });
  await item.scrollIntoViewIfNeeded();
  const entry = item.getByRole('article');
  await expect(entry).toBeVisible();
  await expectPlays(entry, t, 0, t('voice.note', { n: 1 }));
  await expectPlays(entry, t, 1, t('voice.note', { n: 2 }));
});

test('removing a submitted note waits for 更新, and 更新 alone sends it', async ({
  leaderPage: page,
  t,
}) => {
  await page.goto('/diary/new/edit');
  await page.getByLabel(t('editor.title')).fill(uniqueTitle('Remove'));
  await (await recordNote(page, t)).getByRole('button', { name: t('voice.keep') }).click();
  await expect(page).toHaveURL(SAVED);
  await sendToLeaders(page, t, true);
  const update = page.getByRole('button', { name: t('editor.publish') });
  await expect(update).toBeDisabled();

  await page
    .getByRole('button', { name: `${t('voice.remove')} ${t('voice.note', { n: 1 })}` })
    .click();
  await page
    .getByRole('dialog', { name: t('voice.removeTitle') })
    .getByRole('button', { name: t('voice.remove') })
    .click();
  await expect(page.getByText(t('voice.pendingRemove'), { exact: true })).toBeVisible();
  await expect(update).toBeEnabled();
  await update.click();
  await expect(page.getByText(t('voice.pendingRemove'), { exact: true })).toHaveCount(0);
  await expect(
    page.getByRole('button', { name: `${t('voice.play')} ${t('voice.note', { n: 1 })}` }),
  ).toHaveCount(0);
});

test('a recording not yet kept asks before it is thrown away', async ({ leaderPage: page, t }) => {
  await page.goto('/diary/new/edit');
  const sheet = await recordNote(page, t);
  await page.keyboard.press('Escape');
  await expect(sheet.getByText(t('voice.discardTitle'))).toBeVisible();
  await sheet.getByRole('button', { name: t('voice.keepRecording') }).click();
  await expect(sheet.getByRole('button', { name: t('voice.keep') })).toBeVisible();
  await sheet.getByRole('button', { name: t('voice.discard') }).click();
  await sheet.getByRole('button', { name: t('voice.discard') }).click();
  await expect(sheet).toBeHidden();
  // Nothing was kept, so nothing was saved.
  await expect(page).toHaveURL(/\/diary\/new\/edit$/);
});

test('students have no recorder', async ({ userPage: page, t }) => {
  await page.goto('/diary/new/edit');
  await expect(page.getByRole('heading', { name: t('editor.newTitle') })).toBeAttached();
  await expect(page.getByRole('button', { name: t('voice.record'), exact: true })).toHaveCount(0);
});

test('the recorder passes axe in both themes and fits the phone at the largest text size', async ({
  leaderPage: page,
  t,
}) => {
  await page.goto('/diary/new/edit');
  await page.getByRole('button', { name: t('voice.record'), exact: true }).click();
  const sheet = page.getByRole('dialog', { name: t('voice.heading') });
  await expect(sheet.getByRole('timer')).toBeVisible();
  for (const scheme of ['light', 'dark'] as const) {
    await page.emulateMedia({ colorScheme: scheme });
    await expectNoAxeViolations(page);
  }
  await sheet.getByRole('button', { name: t('voice.stop') }).click();
  await expect(sheet.getByRole('button', { name: t('voice.keep') })).toBeVisible();
  await page.evaluate(() => (document.documentElement.style.fontSize = '22px'));
  for (const scheme of ['light', 'dark'] as const) {
    await page.emulateMedia({ colorScheme: scheme });
    await expectNoAxeViolations(page);
  }
  await expectNoSidewaysScroll(page);
});
