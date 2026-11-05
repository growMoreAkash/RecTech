import type { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { type PrismaClient, type Role } from '@prisma/client';
import { randomBytes } from 'node:crypto';
import request from 'supertest';
import { AppModule } from '../src/app.module';
import { hashSecret, randomToken, sha256 } from '../src/auth/crypto';
import { configureApp } from '../src/bootstrap';
import { PUSH_SENDER, type PushSender } from '../src/notifications/push.service';
import { PrismaService } from '../src/prisma/prisma.service';

export const PASSWORD = 'correct-horse-battery';

export async function createApp(
  opts: { pushSender?: PushSender } = {},
): Promise<{ app: INestApplication; prisma: PrismaService }> {
  let builder = Test.createTestingModule({ imports: [AppModule] });
  if (opts.pushSender) builder = builder.overrideProvider(PUSH_SENDER).useValue(opts.pushSender);
  const mod = await builder.compile();
  const app = configureApp(mod.createNestApplication({ logger: false, rawBody: true }));
  await app.init();
  return { app, prisma: app.get(PrismaService) };
}

let counter = 0;

export interface Tenant {
  organizationId: string;
  outletId: string;
  deviceToken: string;
  /** Two sections (A: T1–T3, B: T4) when created with `{ floor: true }`. */
  sections: string[];
  tables: Record<'T1' | 'T2' | 'T3' | 'T4', string>;
  users: Record<
    'owner' | 'manager' | 'host' | 'waiter' | 'busser',
    { id: string; email: string; pin: string }
  >;
}

/** A fresh organization with one outlet, one user per key role, and a registered staff terminal. */
export async function createTenant(prisma: PrismaClient, opts: { floor?: boolean } = {}): Promise<Tenant> {
  const tag = `${Date.now().toString(36)}${counter++}`;
  const org = await prisma.organization.create({ data: { name: `Org ${tag}` } });
  const outlet = await prisma.outlet.create({
    data: { organizationId: org.id, name: `Outlet ${tag}`, settings: { create: { organizationId: org.id } } },
  });
  const passwordHash = await hashSecret(PASSWORD);
  const roles: [keyof Tenant['users'], Role, string][] = [
    ['owner', 'OWNER', '9000'],
    ['manager', 'MANAGER', '9001'],
    ['host', 'HOST', '9002'],
    ['waiter', 'WAITER', '1001'],
    ['busser', 'BUSSER', '2001'],
  ];
  const users = {} as Tenant['users'];
  for (const [key, role, pin] of roles) {
    const email = `${key}.${tag}@test.dinesense.in`;
    const u = await prisma.user.create({
      data: {
        organizationId: org.id,
        name: `${key} ${tag}`,
        email,
        passwordHash,
        pinHash: await hashSecret(pin),
        roles: { create: { outletId: outlet.id, role } },
      },
    });
    users[key] = { id: u.id, email, pin };
  }
  const deviceToken = randomToken('sd', 24);
  await prisma.staffDevice.create({
    data: {
      organizationId: org.id,
      outletId: outlet.id,
      name: 'Test terminal',
      kind: 'STAFF_TERMINAL',
      tokenHash: sha256(deviceToken),
    },
  });
  const sections: string[] = [];
  const tables = {} as Tenant['tables'];
  if (opts.floor) {
    for (const name of ['A', 'B']) {
      sections.push(
        (await prisma.section.create({ data: { organizationId: org.id, outletId: outlet.id, name } })).id,
      );
    }
    const layout: [keyof Tenant['tables'], number][] = [
      ['T1', 0],
      ['T2', 0],
      ['T3', 0],
      ['T4', 1],
    ];
    for (const [i, [label, s]] of layout.entries()) {
      const t = await prisma.table.create({
        data: {
          organizationId: org.id,
          outletId: outlet.id,
          sectionId: sections[s]!,
          label,
          capacity: 4,
          x: i * 100,
          y: 0,
          w: 80,
          h: 80,
          joinableWith: [],
          qrToken: randomToken('q', 9),
          staffQrToken: randomToken('s', 9),
        },
      });
      tables[label] = t.id;
    }
  }
  return { organizationId: org.id, outletId: outlet.id, deviceToken, users, sections, tables };
}

/** Logs in every fixture user and returns their access tokens. */
export async function loginAll(app: INestApplication, t: Tenant) {
  const out = {} as Record<keyof Tenant['users'], string>;
  for (const k of Object.keys(t.users) as (keyof Tenant['users'])[])
    out[k] = (await login(app, t.users[k].email)).accessToken;
  return out;
}

export async function login(app: INestApplication, email: string, password = PASSWORD) {
  const res = await request(app.getHttpServer())
    .post('/api/v1/auth/login')
    .send({ email, password })
    .expect(200);
  return res.body as { accessToken: string; refreshToken: string };
}

export const bearer = (token: string) => ({ Authorization: `Bearer ${token}` });
export const randomId = () => randomBytes(8).toString('hex');

export interface MenuFixture {
  stations: { main: string; bar: string };
  categoryId: string;
  portionGroupId: string;
  portion: { full: string; half: string };
  items: { dal: string; lassi: string; soldOut: string; breakfast: string };
}

/** Small menu: Dal (main, requires a portion), Lassi (bar), a sold-out item and one outside its time window. */
export async function createMenu(prisma: PrismaClient, t: Tenant): Promise<MenuFixture> {
  const base = { organizationId: t.organizationId, outletId: t.outletId };
  const main = await prisma.kitchenStation.create({ data: { ...base, code: 'main', name: { en: 'Main' } } });
  const bar = await prisma.kitchenStation.create({ data: { ...base, code: 'bar', name: { en: 'Bar' } } });
  const cat = await prisma.menuCategory.create({ data: { ...base, name: { en: 'Food', hi: 'खाना' } } });
  const group = await prisma.modifierGroup.create({
    data: {
      ...base,
      name: { en: 'Portion' },
      minSelect: 1,
      maxSelect: 1,
      modifiers: {
        create: [
          { name: { en: 'Full' }, priceDeltaPaise: 0, sortOrder: 0 },
          { name: { en: 'Half' }, priceDeltaPaise: -10_000, sortOrder: 1 },
        ],
      },
    },
    include: { modifiers: { orderBy: { sortOrder: 'asc' } } },
  });
  const item = (name: string, stationId: string, pricePaise: number, extra: object = {}) =>
    prisma.menuItem.create({
      data: {
        ...base,
        categoryId: cat.id,
        stationId,
        name: { en: name },
        vegType: 'VEG',
        pricePaise,
        allergens: [],
        ...extra,
      },
    });
  const dal = await item('Dal Makhani', main.id, 30_000, {
    modifierGroups: { create: { modifierGroupId: group.id } },
  });
  const lassi = await item('Lassi', bar.id, 12_000);
  const soldOut = await item('Rasmalai', main.id, 16_000, { isAvailable: false });
  // A window that is never open: Sunday 03:00–03:01.
  const breakfast = await item('Poha', main.id, 9_000, {
    availabilityWindows: [{ days: [7], from: '03:00', to: '03:01' }],
  });
  return {
    stations: { main: main.id, bar: bar.id },
    categoryId: cat.id,
    portionGroupId: group.id,
    portion: { full: group.modifiers[0]!.id, half: group.modifiers[1]!.id },
    items: { dal: dal.id, lassi: lassi.id, soldOut: soldOut.id, breakfast: breakfast.id },
  };
}
