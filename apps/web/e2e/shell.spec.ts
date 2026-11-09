import AxeBuilder from '@axe-core/playwright';
import { expect, test } from '@playwright/test';

test('/ redirects to /dashboard and shows the studio shell', async ({ page }) => {
  await page.goto('/');
  await expect(page).toHaveURL(/\/dashboard$/);
  await expect(page.getByRole('banner').getByText('Site Refresh Studio')).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Projects', level: 1 })).toBeVisible();
  await expect(page.getByText('No projects yet')).toBeVisible();
});

test('review route shows the design preview region', async ({ page }) => {
  await page.goto('/review/test-token');
  await expect(page.getByRole('heading', { name: 'Design preview' })).toBeVisible();
  await expect(page.getByText('Comments will appear here')).toBeVisible();
});

for (const path of ['/dashboard', '/review/test-token']) {
  test(`no horizontal overflow at 375px on ${path}`, async ({ page }) => {
    await page.setViewportSize({ width: 375, height: 800 });
    await page.goto(path);
    const overflow = await page.evaluate(
      () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
    );
    expect(overflow).toBeLessThanOrEqual(0);
  });

  test(`skip link is usable on ${path}`, async ({ page }) => {
    await page.goto(path);
    await page.keyboard.press('Tab');
    const skip = page.getByRole('link', { name: 'Skip to main content' });
    await expect(skip).toBeFocused();
    await expect(skip).toBeVisible();
    const box = await skip.boundingBox();
    expect(box?.height ?? 0).toBeGreaterThanOrEqual(44);
    await page.keyboard.press('Enter');
    await expect(page).toHaveURL(/#main$/);
    expect(await page.evaluate(() => document.activeElement?.closest('#main') !== null)).toBe(true);
  });

  for (const width of [1280, 375]) {
    test(`axe at ${width}px: no serious or critical violations on ${path}`, async ({ page }) => {
      await page.setViewportSize({ width, height: 800 });
      await page.goto(path);
      const { violations } = await new AxeBuilder({ page })
        .withTags(['wcag2a', 'wcag2aa', 'wcag21aa'])
        .analyze();
      const blocking = violations.filter((v) => v.impact === 'serious' || v.impact === 'critical');
      expect(blocking.map((v) => `${v.id} (${v.impact}): ${v.help}`)).toEqual([]);
      console.log(
        `axe ${path} @${width}: ${violations.length} violations total, ${blocking.length} serious/critical`,
      );
    });
  }
}
