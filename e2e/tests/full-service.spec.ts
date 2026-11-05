import { type Browser, type BrowserContext, devices, expect, type Page, test } from '@playwright/test';

/**
 * P1 "done" criterion: one full service runs end to end with no camera —
 * seat → QR order → waiter approves (staff app) → kitchen (KDS) → served → bill → pay → left → clean.
 * Five people, five browser contexts: host/cashier (dashboard), guest (phone), waiter + busser (staff app), chef.
 */

const API = 'http://127.0.0.1:4000/api/v1';
const PASSWORD = 'dinesense123';
const TABLE = 'T5';

interface Snapshot {
  tables: { id: string; label: string; qrToken: string; live: { status: string } }[];
}

async function apiLogin(email: string) {
  const res = await fetch(`${API}/auth/login`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ email, password: PASSWORD }),
  });
  return ((await res.json()) as { accessToken: string }).accessToken;
}

async function floor(token: string, outletId: string) {
  const res = await fetch(`${API}/outlets/${outletId}/floor`, {
    headers: { authorization: `Bearer ${token}` },
  });
  return (await res.json()) as Snapshot;
}

async function dashboardAs(browser: Browser, email: string): Promise<Page> {
  const ctx = await browser.newContext({ viewport: { width: 1400, height: 900 } });
  const page = await ctx.newPage();
  await page.goto('http://localhost:3000/login');
  await page.getByLabel('Email').fill(email);
  await page.getByLabel('Password').fill(PASSWORD);
  await page.getByRole('button', { name: 'Sign in' }).click();
  await page.waitForURL('**/floor');
  return page;
}

/** Registers the staff terminal once (manager), then signs a person in by PIN. */
async function staffTerminal(browser: Browser): Promise<{ ctx: BrowserContext; page: Page }> {
  const ctx = await browser.newContext({ ...devices['Pixel 7'] });
  const page = await ctx.newPage();
  await page.goto('http://localhost:3002/');
  await page.getByLabel('Manager email').fill('manager@demo.dinesense.in');
  await page.getByLabel('Password').fill(PASSWORD);
  await page.getByRole('button', { name: 'Continue' }).click();
  await page.getByRole('button', { name: 'Register device' }).click();
  await expect(page.getByText('Who are you?')).toBeVisible();
  return { ctx, page };
}

async function pinIn(page: Page, name: string, pin: string) {
  await page.getByRole('button', { name: new RegExp(`^${name}`) }).click();
  for (const d of pin) await page.getByRole('button', { name: d, exact: true }).click();
  await page.getByRole('button', { name: 'Sign in' }).click();
  await expect(page.getByRole('button', { name: 'Switch user' })).toBeVisible();
}

test('a full manual service runs end to end', async ({ browser }) => {
  const errors: string[] = [];
  const watch = (p: Page, who: string) => p.on('pageerror', (e) => errors.push(`${who}: ${e.message}`));

  const managerToken = await apiLogin('manager@demo.dinesense.in');
  const [outlet] = (await (
    await fetch(`${API}/outlets`, { headers: { authorization: `Bearer ${managerToken}` } })
  ).json()) as { id: string }[];
  const t5 = (await floor(managerToken, outlet!.id)).tables.find((t) => t.label === TABLE)!;
  const tableStatus = async () =>
    (await floor(managerToken, outlet!.id)).tables.find((t) => t.label === TABLE)!.live.status;

  // ── Host seats the party ──
  const host = await dashboardAs(browser, 'host@demo.dinesense.in');
  watch(host, 'host');
  await host.getByRole('button', { name: new RegExp(`^${TABLE}`) }).click();
  await host.getByLabel('Party size').fill('2');
  await host.getByRole('button', { name: 'Seat party' }).click();
  await expect.poll(tableStatus).toBe('OCCUPIED');

  // ── Guest orders from the table QR ──
  const guestCtx = await browser.newContext({ ...devices['iPhone 13'] });
  const guest = await guestCtx.newPage();
  watch(guest, 'guest');
  await guest.goto(`http://localhost:3001/t/${t5.qrToken}`);
  await guest.getByRole('button', { name: /Paneer Tikka/ }).click();
  await guest.getByRole('button', { name: 'Add to table order' }).click();
  await guest.getByRole('button', { name: /Cart \(1\)/ }).click();
  await guest.getByRole('button', { name: 'Place order' }).click();
  await expect(guest.getByText('Waiting for confirmation')).toBeVisible();

  // ── Waiter approves on the staff app and greets the table ──
  const { ctx: terminalCtx, page: waiter } = await staffTerminal(browser);
  watch(waiter, 'waiter');
  await pinIn(waiter, 'Anil Sharma', '1001');
  await waiter.getByText(`Approve QR order — table ${TABLE}`).click();
  await waiter.getByRole('button', { name: 'Open table' }).first().click();
  await waiter.getByRole('button', { name: 'Approve' }).click();
  await expect(guest.getByText('In the kitchen')).toBeVisible();
  await waiter.getByRole('button', { name: 'At table (greet)' }).click();
  await expect.poll(tableStatus).toBe('ORDERED');

  // ── Kitchen cooks it ──
  const chef = await dashboardAs(browser, 'chef@demo.dinesense.in');
  watch(chef, 'chef');
  await chef.goto('http://localhost:3000/kds/tandoor');
  await chef.getByRole('button', { name: /Paneer Tikka/ }).click();
  await expect(guest.getByText('Cooking')).toBeVisible();
  await chef.getByRole('button', { name: /Paneer Tikka/ }).click();
  await expect(chef.getByText('All clear — no open tickets.')).toBeHidden();

  // ── Waiter serves (first order complete → SERVED) ──
  await waiter.getByRole('button', { name: 'Served', exact: true }).click();
  await expect.poll(tableStatus).toBe('SERVED');

  // ── Guest asks for the bill ──
  await guest.keyboard.press('Escape');
  await guest.getByRole('button', { name: 'Bill', exact: true }).click();
  await expect(guest.getByText('Your bill has been requested.')).toBeVisible();
  await expect.poll(tableStatus).toBe('BILL_REQUESTED');

  // ── Cashier bills and takes cash ──
  const cashier = await dashboardAs(browser, 'cashier@demo.dinesense.in');
  watch(cashier, 'cashier');
  await cashier.getByRole('button', { name: new RegExp(`^${TABLE}`) }).click();
  await cashier.getByRole('button', { name: 'Create bill' }).click();
  await cashier.getByRole('button', { name: 'Finalise bill' }).click();
  await expect(cashier.getByText('Final — unpaid')).toBeVisible();
  await cashier.getByRole('button', { name: 'Record payment' }).click();
  await expect.poll(tableStatus).toBe('PAID');
  const invoiceHref = await cashier.getByRole('link', { name: 'Print / share invoice' }).getAttribute('href');

  // ── Guests leave; waiter marks it; busser cleans ──
  await waiter.keyboard.press('Escape');
  await waiter.getByRole('button', { name: 'Tables', exact: true }).click();
  await waiter
    .getByRole('button', { name: new RegExp(`^${TABLE}`) })
    .first()
    .click();
  await waiter.getByRole('button', { name: 'Guests left' }).click();
  await expect.poll(tableStatus).toBe('NEEDS_CLEANING');
  await waiter.keyboard.press('Escape');
  await waiter.getByRole('button', { name: 'Switch user' }).click();
  await pinIn(waiter, 'Lakshmi Pillai', '2002');
  await waiter.getByRole('button', { name: 'Clean', exact: true }).click();
  await waiter.getByRole('button', { name: 'Cleaned' }).click();
  await expect.poll(tableStatus).toBe('VACANT');

  // ── The invoice is a proper GST tax invoice ──
  const invoice = await (await fetch(`http://127.0.0.1:4000${invoiceHref}`)).text();
  expect(invoice).toContain('TAX INVOICE');
  expect(invoice).toContain('Paneer Tikka');
  expect(invoice).toMatch(/SR\/\d{4}-\d{2}\/00001/);

  expect(errors).toEqual([]);
  await Promise.all([guestCtx.close(), terminalCtx.close()]);
});
