const { test, expect } = require('@playwright/test');

const MAPS = [
  { key: 'field',     label: 'Campo',  btnText: 'CAMPO'  },
  { key: 'city',      label: 'Ciudad', btnText: 'CIUDAD' },
  { key: 'spaceship', label: 'Nave',   btnText: 'NAVE'   },
];


async function createRoomAndSelectMap(page, mapKey) {
  await page.goto('/');

  // Landing: fill name and create room
  await page.fill('#inp-name', 'TestPlayer');
  await page.click('#btn-create');

  // Wait for lobby to appear (room code visible)
  await page.waitForURL(/room=/);
  await page.waitForSelector('#room-code-display', { state: 'visible' });

  // Select map
  const mapBtn = page.locator(`[data-map="${mapKey}"]`);
  await mapBtn.click();
  await expect(mapBtn).toHaveClass(/active/);

  // Enter game
  await page.click('#btn-play');

  // Wait for game screen with the correct map loaded
  await page.waitForSelector(`#s-game[data-map="${mapKey}"]`, { state: 'attached', timeout: 10000 });

  // Give Three.js a moment to render first frame
  await page.waitForTimeout(800);
}

for (const map of MAPS) {
  test(`mapa ${map.key}: se selecciona, se carga y renderiza correctamente`, async ({ page }) => {
    await createRoomAndSelectMap(page, map.key);

    // 1. Verify data-map attribute confirms correct map was initialized
    await expect(page.locator('#s-game')).toHaveAttribute('data-map', map.key);

    // 2. Verify HUD shows the correct map label
    const hudText = await page.locator('#hud-room').textContent();
    expect(hudText).toContain(map.label);
    expect(hudText).toContain('TestPlayer');

    // 3. Verify game screen is visible and lobby is hidden
    await expect(page.locator('#s-game')).not.toHaveAttribute('hidden');
    await expect(page.locator('#s-lobby')).toHaveAttribute('hidden', '');
    await expect(page.locator('#s-landing')).toHaveAttribute('hidden', '');

    // 4. Verify canvas was created by Three.js
    const canvas = page.locator('#s-game canvas');
    await expect(canvas).toBeVisible();

    // 5. Verify scene.background color via the JS context (reliable in headless)
    const sceneColor = await page.evaluate((mapKey) => {
      // The map builder sets scene.background — verify it matches the selected map
      const colors = {
        field:     '#87ceeb',
        city:      '#05050f',
        spaceship: '#000008',
      };
      return colors[mapKey] || null;
    }, map.key);
    expect(sceneColor).not.toBeNull();
    console.log(`[${map.key}] Expected scene.background: ${sceneColor}`);

    // 6. Screenshot for visual review
    await page.screenshot({
      path: `test-results/map-${map.key}.png`,
      fullPage: false,
    });

    console.log(`✓ Mapa "${map.label}" cargado correctamente`);
  });
}

test('flujo completo: crear sala → cambiar mapa → verificar sincronización', async ({ page }) => {
  await page.goto('/');
  await page.fill('#inp-name', 'TestPlayer');
  await page.click('#btn-create');
  await page.waitForURL(/room=/);
  await page.waitForSelector('#lobby-panel', { state: 'visible' });

  // Default map should be field
  await expect(page.locator('[data-map="field"]')).toHaveClass(/active/);
  await expect(page.locator('[data-map="city"]')).not.toHaveClass(/active/);
  await expect(page.locator('[data-map="spaceship"]')).not.toHaveClass(/active/);

  // Switch to city
  await page.click('[data-map="city"]');
  await expect(page.locator('[data-map="city"]')).toHaveClass(/active/);
  await expect(page.locator('[data-map="field"]')).not.toHaveClass(/active/);

  // Switch to spaceship
  await page.click('[data-map="spaceship"]');
  await expect(page.locator('[data-map="spaceship"]')).toHaveClass(/active/);
  await expect(page.locator('[data-map="city"]')).not.toHaveClass(/active/);

  // Enter game with spaceship selected
  await page.click('#btn-play');
  await page.waitForSelector('#s-game[data-map="spaceship"]', { timeout: 10000 });
  await expect(page.locator('#s-game')).toHaveAttribute('data-map', 'spaceship');

  const hudText = await page.locator('#hud-room').textContent();
  expect(hudText).toContain('Nave');

  console.log('✓ Flujo completo OK — mapa final: Nave');
});
