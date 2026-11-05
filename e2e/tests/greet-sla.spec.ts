import { devices, expect, test } from '@playwright/test';

/**
 * P2 core rule on the real stack (BullMQ timers, sockets, staff app):
 * a seated table nobody greets is assigned to the on-shift waiter automatically; "On my way" acknowledges it.
 * The SLA is set to its minimum (30 s) so the test stays short.
 */

const API = 'http://127.0.0.1:4000/api/v1';
const PASSWORD = 'dinesense123';
const TABLE = 'T8';

const login = async (email: string) =>
  (
    (await (
      await fetch(`${API}/auth/login`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ email, password: PASSWORD }),
      })
    ).json()) as { accessToken: string }
  ).accessToken;

test('an ungreeted table is assigned to the on-shift waiter, who acknowledges and greets', async ({
  browser,
}) => {
  test.setTimeout(150_000);
  const token = await login('manager@demo.dinesense.in');
  const h = { authorization: `Bearer ${token}`, 'content-type': 'application/json' };
  const [outlet] = (await (await fetch(`${API}/outlets`, { headers: h })).json()) as { id: string }[];
  const o = `${API}/outlets/${outlet!.id}`;
  await fetch(`${o}/settings`, {
    method: 'PATCH',
    headers: h,
    body: JSON.stringify({ greetSlaSeconds: 30, reassignAfterSeconds: 120, escalateAfterSeconds: 600 }),
  });
  const floor = (await (await fetch(`${o}/floor`, { headers: h })).json()) as {
    tables: { id: string; label: string }[];
  };
  const table = floor.tables.find((t) => t.label === TABLE)!;

  // Waiter Anil (Main Hall) checks in on the staff app.
  const ctx = await browser.newContext({ ...devices['Pixel 7'] });
  const waiter = await ctx.newPage();
  await waiter.goto('http://localhost:3002/');
  await waiter.getByLabel('Manager email').fill('manager@demo.dinesense.in');
  await waiter.getByLabel('Password').fill(PASSWORD);
  await waiter.getByRole('button', { name: 'Continue' }).click();
  await waiter.getByRole('button', { name: 'Register device' }).click();
  await waiter.getByRole('button', { name: /^Anil Sharma/ }).click();
  for (const d of '1001') await waiter.getByRole('button', { name: d, exact: true }).click();
  await waiter.getByRole('button', { name: 'Sign in' }).click();
  await waiter.getByRole('button', { name: 'My shift' }).click();
  await waiter.getByRole('button', { name: 'Check in' }).click();
  await expect(waiter.getByText('On shift', { exact: false })).toBeVisible();
  await waiter.getByRole('button', { name: 'Tasks', exact: true }).click();

  // Host seats T8; nobody greets.
  const res = await fetch(`${o}/tables/${table.id}/seat`, {
    method: 'POST',
    headers: h,
    body: JSON.stringify({ partySize: 2 }),
  });
  expect(res.status).toBe(200);

  // After 30 s the engine assigns it to Anil — the task appears live on his phone.
  await expect(waiter.getByText(`Greet table ${TABLE}`)).toBeVisible({ timeout: 75_000 });

  // The manager's floor shows who must greet, not yet acknowledged.
  const mctx = await browser.newContext({ viewport: { width: 1400, height: 900 } });
  const manager = await mctx.newPage();
  await manager.goto('http://localhost:3000/login');
  await manager.getByLabel('Email').fill('manager@demo.dinesense.in');
  await manager.getByLabel('Password').fill(PASSWORD);
  await manager.getByRole('button', { name: 'Sign in' }).click();
  await manager.getByRole('button', { name: new RegExp(`^${TABLE}\\b`) }).click();
  const drawer = manager.getByRole('dialog');
  await expect(drawer.getByText('Anil Sharma (attempt 1)')).toBeVisible();
  await expect(drawer.getByText('not yet acknowledged')).toBeVisible();

  // "On my way" → acknowledged on the manager's screen; "At table" → greeted.
  await waiter.getByRole('button', { name: 'On my way' }).click();
  await expect(drawer.getByText('on the way')).toBeVisible();
  await waiter.getByRole('button', { name: 'At table (greet)' }).click();
  await expect(waiter.getByText(`Greet table ${TABLE}`)).toBeHidden();
  await expect
    .poll(
      async () =>
        (
          (await (await fetch(`${o}/floor`, { headers: h })).json()) as {
            tables: { id: string; live: { status: string } }[];
          }
        ).tables.find((t) => t.id === table.id)!.live.status,
    )
    .toBe('GREETED');

  // Leave the outlet as we found it for other tests.
  await fetch(`${o}/settings`, {
    method: 'PATCH',
    headers: h,
    body: JSON.stringify({ greetSlaSeconds: 300 }),
  });
  await Promise.all([ctx.close(), mctx.close()]);
});
