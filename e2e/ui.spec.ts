import { expect, test } from '@playwright/test';

test.beforeEach(async ({ page }) => {
  await page.addInitScript(() => localStorage.setItem('marknote-language', 'en'));
  await page.goto('/?app=1');
  await expect(page.locator('[contenteditable=true]')).toBeVisible();
});

for (const width of [768, 1024, 1440]) {
  test(`the editor fits the ${width}px layout without horizontal overflow`, async ({ page }) => {
    await page.setViewportSize({ width, height: 900 });
    await page.getByRole('button', { name: 'New note', exact: true }).first().click();
    const editor = page.locator('[contenteditable=true]');
    await expect(editor).toBeVisible();
    await editor.fill(`Layout ${width}: a usable editing surface`);
    await expect(editor).toContainText(`Layout ${width}`);
    const bounds = await editor.boundingBox();
    expect(bounds).not.toBeNull();
    expect(bounds!.x).toBeGreaterThanOrEqual(-1);
    expect(bounds!.x + bounds!.width).toBeLessThanOrEqual(width + 1);
    const dimensions = await page.evaluate(() => ({ content: document.documentElement.scrollWidth, viewport: window.innerWidth }));
    expect(dimensions.content).toBeLessThanOrEqual(dimensions.viewport + 1);
  });
}

test('a 200 percent desktop zoom equivalent keeps controls inside the CSS viewport', async ({ page, context }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  const session = await context.newCDPSession(page);
  // Desktop zoom doubles pixel density and halves the CSS viewport. Headless Chromium
  // has no browser menu, so exercise those same metrics rather than mobile pinch zoom.
  await session.send('Emulation.setDeviceMetricsOverride', { width: 720, height: 450, deviceScaleFactor: 2, mobile: false, screenWidth: 1440, screenHeight: 900 });
  await page.getByRole('button', { name: 'New note', exact: true }).first().click();
  const editor = page.locator('[contenteditable=true]');
  await expect(editor).toBeVisible();
  await page.locator('input[placeholder="Untitled note"]').fill('Desktop zoom note');
  await editor.fill('Usable text at the doubled display scale');
  const dimensions = await page.evaluate(() => ({ content: document.documentElement.scrollWidth, viewport: window.innerWidth, scale: window.devicePixelRatio }));
  expect(dimensions.viewport).toBe(720);
  expect(dimensions.scale).toBe(2);
  expect(dimensions.content).toBeLessThanOrEqual(dimensions.viewport + 1);
  const bounds = await editor.boundingBox();
  expect(bounds).not.toBeNull();
  expect(bounds!.x).toBeGreaterThanOrEqual(-1);
  expect(bounds!.x + bounds!.width).toBeLessThanOrEqual(dimensions.viewport + 1);
});

test('a real safe link keeps its URL and text after saving and reopening', async ({ page }) => {
  await page.getByRole('button', { name: 'New note', exact: true }).first().click();
  const title = page.locator('input[placeholder="Untitled note"]');
  const editor = page.locator('[contenteditable=true]');
  await title.fill('Persisted safe link');
  await editor.fill('Link text survives reopening');
  await editor.press('Control+a');
  await page.getByRole('button', { name: 'Link', exact: true }).click();
  const dialog = page.getByRole('dialog');
  await dialog.getByLabel('Link URL', { exact: true }).fill('https://example.com/notes?view=safe#section');
  await dialog.getByRole('button', { name: 'Apply', exact: true }).click();
  const link = editor.locator('a');
  await expect(link).toHaveAttribute('href', 'https://example.com/notes?view=safe#section');
  await expect(link).toHaveText('Link text survives reopening');
  await page.keyboard.press('Control+s');
  await page.getByRole('button', { name: 'New note', exact: true }).first().click();
  await page.getByRole('button', { name: 'Persisted safe link', exact: true }).click();
  await expect(link).toHaveAttribute('href', 'https://example.com/notes?view=safe#section');
  await expect(link).toHaveText('Link text survives reopening');
  await page.reload();
  await page.getByRole('button', { name: 'Persisted safe link', exact: true }).click();
  await expect(editor.locator('a')).toHaveAttribute('href', 'https://example.com/notes?view=safe#section');
  await expect(editor.locator('a')).toHaveText('Link text survives reopening');
});
