/**
 * Demo seed: one organization, one outlet (Bengaluru), 20 tables in 3 sections, full staff roster,
 * 5 kitchen stations, 40 menu items with veg marks and Hindi names.
 *
 * Destructive: wipes every table first. Refuses to run with NODE_ENV=production.
 * Run: pnpm --filter @dinesense/api seed
 */
import { Prisma, PrismaClient, type Role, type VegType } from '@prisma/client';
import * as argon2 from 'argon2';
import { createHash, randomBytes } from 'node:crypto';

const prisma = new PrismaClient();

export const DEMO_PASSWORD = 'dinesense123';
/** Dev-only staff terminal token so PIN login works right after seeding. */
export const DEMO_DEVICE_TOKEN = 'sd_demo_floor_terminal_dev_only';

const token = () => randomBytes(12).toString('base64url');
const sha256 = (v: string) => createHash('sha256').update(v).digest('hex');
const hash = (s: string) =>
  argon2.hash(s, { type: argon2.argon2id, memoryCost: 19_456, timeCost: 2, parallelism: 1 });

async function wipe(): Promise<void> {
  const tables = Prisma.dmmf.datamodel.models.map((m) => `"${m.dbName ?? m.name}"`).join(', ');
  await prisma.$executeRawUnsafe(`TRUNCATE ${tables} RESTART IDENTITY CASCADE`);
}

type Station = 'tandoor' | 'curry' | 'chinese' | 'bar' | 'desserts';
type Item = [
  en: string,
  hi: string,
  veg: VegType,
  rupees: number,
  station: Station,
  spice?: number,
  allergens?: string[],
];

const MENU: Record<string, { hi: string; items: Item[] }> = {
  Starters: {
    hi: 'स्टार्टर्स',
    items: [
      ['Paneer Tikka', 'पनीर टिक्का', 'VEG', 320, 'tandoor', 2, ['dairy']],
      ['Hara Bhara Kebab', 'हरा भरा कबाब', 'VEG', 260, 'tandoor', 1],
      ['Chicken Tikka', 'चिकन टिक्का', 'NON_VEG', 380, 'tandoor', 2, ['dairy']],
      ['Tandoori Chicken (Half)', 'तंदूरी चिकन (हाफ़)', 'NON_VEG', 420, 'tandoor', 2, ['dairy']],
      ['Fish Amritsari', 'फ़िश अमृतसरी', 'NON_VEG', 450, 'curry', 2, ['fish', 'gluten']],
      ['Egg Pakora', 'अंडा पकौड़ा', 'EGG', 210, 'curry', 1, ['egg', 'gluten']],
    ],
  },
  'Main Course — Veg': {
    hi: 'मुख्य व्यंजन — शाकाहारी',
    items: [
      ['Paneer Butter Masala', 'पनीर बटर मसाला', 'VEG', 340, 'curry', 1, ['dairy', 'nuts']],
      ['Dal Makhani', 'दाल मखनी', 'VEG', 290, 'curry', 1, ['dairy']],
      ['Palak Paneer', 'पालक पनीर', 'VEG', 320, 'curry', 1, ['dairy']],
      ['Chana Masala', 'चना मसाला', 'VEG', 260, 'curry', 2],
      ['Malai Kofta', 'मलाई कोफ़्ता', 'VEG', 330, 'curry', 1, ['dairy', 'nuts']],
      ['Bhindi Do Pyaza', 'भिंडी दो प्याज़ा', 'VEG', 270, 'curry', 2],
    ],
  },
  'Main Course — Non-Veg': {
    hi: 'मुख्य व्यंजन — मांसाहारी',
    items: [
      ['Butter Chicken', 'बटर चिकन', 'NON_VEG', 420, 'curry', 1, ['dairy', 'nuts']],
      ['Chicken Chettinad', 'चिकन चेट्टिनाड', 'NON_VEG', 410, 'curry', 3],
      ['Mutton Rogan Josh', 'मटन रोगन जोश', 'NON_VEG', 520, 'curry', 2],
      ['Goan Fish Curry', 'गोअन फ़िश करी', 'NON_VEG', 480, 'curry', 2, ['fish']],
      ['Egg Curry', 'अंडा करी', 'EGG', 260, 'curry', 2, ['egg']],
    ],
  },
  Breads: {
    hi: 'रोटियाँ',
    items: [
      ['Butter Naan', 'बटर नान', 'VEG', 70, 'tandoor', 0, ['gluten', 'dairy']],
      ['Garlic Naan', 'गार्लिक नान', 'VEG', 90, 'tandoor', 0, ['gluten', 'dairy']],
      ['Tandoori Roti', 'तंदूरी रोटी', 'VEG', 40, 'tandoor', 0, ['gluten']],
      ['Lachha Paratha', 'लच्छा पराठा', 'VEG', 80, 'tandoor', 0, ['gluten', 'dairy']],
    ],
  },
  'Rice & Biryani': {
    hi: 'चावल और बिरयानी',
    items: [
      ['Jeera Rice', 'जीरा राइस', 'VEG', 180, 'curry'],
      ['Veg Dum Biryani', 'वेज दम बिरयानी', 'VEG', 300, 'curry', 2, ['dairy']],
      ['Hyderabadi Chicken Biryani', 'हैदराबादी चिकन बिरयानी', 'NON_VEG', 390, 'curry', 2, ['dairy']],
      ['Mutton Biryani', 'मटन बिरयानी', 'NON_VEG', 480, 'curry', 2, ['dairy']],
      ['Egg Biryani', 'अंडा बिरयानी', 'EGG', 280, 'curry', 2, ['egg']],
    ],
  },
  'Indo-Chinese': {
    hi: 'इंडो-चाइनीज़',
    items: [
      ['Veg Manchurian', 'वेज मंचूरियन', 'VEG', 250, 'chinese', 2, ['soy', 'gluten']],
      ['Chilli Paneer', 'चिली पनीर', 'VEG', 290, 'chinese', 3, ['dairy', 'soy']],
      ['Hakka Noodles', 'हक्का नूडल्स', 'VEG', 230, 'chinese', 1, ['soy', 'gluten']],
      ['Chicken Fried Rice', 'चिकन फ़्राइड राइस', 'NON_VEG', 280, 'chinese', 1, ['soy', 'egg']],
      ['Chilli Chicken', 'चिली चिकन', 'NON_VEG', 340, 'chinese', 3, ['soy', 'gluten']],
    ],
  },
  Desserts: {
    hi: 'मिठाइयाँ',
    items: [
      ['Gulab Jamun', 'गुलाब जामुन', 'VEG', 140, 'desserts', 0, ['dairy', 'gluten']],
      ['Rasmalai', 'रसमलाई', 'VEG', 160, 'desserts', 0, ['dairy', 'nuts']],
      ['Gajar Halwa', 'गाजर हलवा', 'VEG', 150, 'desserts', 0, ['dairy', 'nuts']],
      ['Kulfi Falooda', 'कुल्फ़ी फ़ालूदा', 'VEG', 180, 'desserts', 0, ['dairy', 'nuts']],
    ],
  },
  Beverages: {
    hi: 'पेय',
    items: [
      ['Masala Chaas', 'मसाला छाछ', 'VEG', 90, 'bar', 0, ['dairy']],
      ['Sweet Lassi', 'मीठी लस्सी', 'VEG', 120, 'bar', 0, ['dairy']],
      ['Fresh Lime Soda', 'फ़्रेश लाइम सोडा', 'VEG', 110, 'bar'],
      ['Filter Coffee', 'फ़िल्टर कॉफ़ी', 'VEG', 80, 'bar', 0, ['dairy']],
      ['Masala Chai', 'मसाला चाय', 'VEG', 60, 'bar', 0, ['dairy']],
    ],
  },
};

const STATIONS: Record<Station, { en: string; hi: string }> = {
  tandoor: { en: 'Tandoor', hi: 'तंदूर' },
  curry: { en: 'Curry & Rice', hi: 'करी और चावल' },
  chinese: { en: 'Chinese', hi: 'चाइनीज़' },
  bar: { en: 'Bar & Beverages', hi: 'बार और पेय' },
  desserts: { en: 'Desserts', hi: 'मिठाइयाँ' },
};

async function main(): Promise<void> {
  if (process.env.NODE_ENV === 'production') throw new Error('Refusing to seed a production database');
  await wipe();

  const org = await prisma.organization.create({ data: { name: 'Demo Hospitality Pvt Ltd' } });
  const organizationId = org.id;
  const outlet = await prisma.outlet.create({
    data: {
      organizationId,
      name: 'Spice Route — Indiranagar',
      gstin: '29ABCDE1234F1Z5',
      legalName: 'Demo Hospitality Pvt Ltd',
      address: '100 Feet Rd, Indiranagar, Bengaluru, Karnataka 560038',
      invoicePrefix: 'SR',
      settings: { create: { organizationId } },
    },
  });
  const outletId = outlet.id;

  // ── Sections & 20 tables ──
  const layout = [
    { name: 'Main Hall', color: '#2563eb', count: 8, capacities: [2, 2, 4, 4, 4, 4, 6, 6] },
    { name: 'Patio', color: '#16a34a', count: 6, capacities: [2, 2, 2, 4, 4, 4] },
    { name: 'Family Lounge', color: '#9333ea', count: 6, capacities: [4, 4, 6, 6, 8, 8] },
  ];
  const sectionIds: string[] = [];
  let n = 1;
  for (const [si, s] of layout.entries()) {
    const section = await prisma.section.create({
      data: { organizationId, outletId, name: s.name, color: s.color, sortOrder: si },
    });
    sectionIds.push(section.id);
    for (let i = 0; i < s.count; i++, n++) {
      const capacity = s.capacities[i] ?? 4;
      await prisma.table.create({
        data: {
          organizationId,
          outletId,
          sectionId: section.id,
          label: `T${n}`,
          capacity,
          minCapacity: Math.max(1, capacity - 2),
          shape: capacity <= 2 ? 'ROUND' : capacity >= 8 ? 'BOOTH' : 'RECT',
          x: 80 + (i % 4) * 160,
          y: 80 + si * 260 + Math.floor(i / 4) * 120,
          w: capacity >= 6 ? 120 : 80,
          h: 80,
          joinableWith: [],
          qrToken: token(),
          staffQrToken: token(),
        },
      });
    }
  }

  // ── Staff ──
  const passwordHash = await hash(DEMO_PASSWORD);
  const staff: { name: string; role: Role; email?: string; pin: string; sections?: number[] }[] = [
    { name: 'Arjun Mehta', role: 'OWNER', email: 'owner@demo.dinesense.in', pin: '9000' },
    { name: 'Priya Nair', role: 'MANAGER', email: 'manager@demo.dinesense.in', pin: '9001' },
    { name: 'Kabir Singh', role: 'HOST', email: 'host@demo.dinesense.in', pin: '9002' },
    { name: 'Meera Iyer', role: 'CASHIER', email: 'cashier@demo.dinesense.in', pin: '9003' },
    { name: 'Ravi Kumar', role: 'CHEF', pin: '9004' },
    { name: 'Anil Sharma', role: 'WAITER', pin: '1001', sections: [0] },
    { name: 'Sunita Reddy', role: 'WAITER', pin: '1002', sections: [0] },
    { name: 'Farhan Ali', role: 'WAITER', pin: '1003', sections: [1] },
    { name: 'Deepa Joshi', role: 'WAITER', pin: '1004', sections: [1] },
    { name: 'Vikram Rao', role: 'WAITER', pin: '1005', sections: [2] },
    { name: 'Neha Gupta', role: 'WAITER', pin: '1006', sections: [2, 0] },
    { name: 'Suresh Yadav', role: 'BUSSER', pin: '2001', sections: [0, 1, 2] },
    { name: 'Lakshmi Pillai', role: 'BUSSER', pin: '2002', sections: [0, 1, 2] },
  ];

  // Today's shift in IST: 11:00–23:00.
  const ist = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Kolkata' }).format(new Date());
  const startsAt = new Date(`${ist}T11:00:00+05:30`);
  const endsAt = new Date(`${ist}T23:00:00+05:30`);

  const pinIndex: string[] = [];
  for (const s of staff) {
    const user = await prisma.user.create({
      data: {
        organizationId,
        name: s.name,
        email: s.email ?? null,
        passwordHash: s.email ? passwordHash : null,
        pinHash: await hash(s.pin),
        roles: { create: { outletId, role: s.role } },
      },
    });
    if (['WAITER', 'BUSSER', 'HOST', 'CHEF', 'CASHIER'].includes(s.role)) {
      await prisma.shift.create({
        data: {
          organizationId,
          outletId,
          userId: user.id,
          role: s.role,
          startsAt,
          endsAt,
          sectionIds: (s.sections ?? []).map((i) => sectionIds[i]!),
        },
      });
    }
    pinIndex.push(
      `  ${s.role.padEnd(8)} ${s.name.padEnd(16)} PIN ${s.pin}  id=${user.id}${s.email ? `  ${s.email}` : ''}`,
    );
  }

  await prisma.staffDevice.create({
    data: {
      organizationId,
      outletId,
      name: 'Floor terminal 1 (demo)',
      kind: 'STAFF_TERMINAL',
      tokenHash: sha256(DEMO_DEVICE_TOKEN),
    },
  });

  // ── Stations, modifiers, menu ──
  const stationIds = {} as Record<Station, string>;
  for (const [code, name] of Object.entries(STATIONS) as [Station, { en: string; hi: string }][]) {
    stationIds[code] = (
      await prisma.kitchenStation.create({ data: { organizationId, outletId, code, name } })
    ).id;
  }

  const portion = await prisma.modifierGroup.create({
    data: {
      organizationId,
      outletId,
      name: { en: 'Portion', hi: 'मात्रा' },
      minSelect: 1,
      maxSelect: 1,
      modifiers: {
        create: [
          { name: { en: 'Full', hi: 'फ़ुल' }, priceDeltaPaise: 0, sortOrder: 0 },
          { name: { en: 'Half', hi: 'हाफ़' }, priceDeltaPaise: -9000, sortOrder: 1 },
        ],
      },
    },
  });
  const spice = await prisma.modifierGroup.create({
    data: {
      organizationId,
      outletId,
      name: { en: 'Spice level', hi: 'तीखापन' },
      minSelect: 0,
      maxSelect: 1,
      modifiers: {
        create: [
          { name: { en: 'Mild', hi: 'हल्का' }, sortOrder: 0 },
          { name: { en: 'Medium', hi: 'मध्यम' }, sortOrder: 1 },
          { name: { en: 'Hot', hi: 'तीखा' }, sortOrder: 2 },
        ],
      },
    },
  });
  const addOns = await prisma.modifierGroup.create({
    data: {
      organizationId,
      outletId,
      name: { en: 'Add-ons', hi: 'ऐड-ऑन' },
      minSelect: 0,
      maxSelect: 3,
      modifiers: {
        create: [
          { name: { en: 'Extra butter', hi: 'एक्स्ट्रा बटर' }, priceDeltaPaise: 3000, sortOrder: 0 },
          { name: { en: 'Extra cheese', hi: 'एक्स्ट्रा चीज़' }, priceDeltaPaise: 4000, sortOrder: 1 },
        ],
      },
    },
  });

  let itemCount = 0;
  for (const [ci, [category, { hi, items }]] of Object.entries(MENU).entries()) {
    const cat = await prisma.menuCategory.create({
      data: { organizationId, outletId, name: { en: category, hi }, sortOrder: ci },
    });
    for (const [
      ii,
      [en, hiName, vegType, rupees, station, spiceLevel = 0, allergens = []],
    ] of items.entries()) {
      const groups: string[] = [];
      if (category.startsWith('Main Course') || category === 'Rice & Biryani') groups.push(portion.id);
      if (spiceLevel > 0) groups.push(spice.id);
      if (category === 'Breads' || category.startsWith('Main Course — Veg')) groups.push(addOns.id);
      await prisma.menuItem.create({
        data: {
          organizationId,
          outletId,
          categoryId: cat.id,
          name: { en, hi: hiName },
          vegType,
          allergens,
          spiceLevel,
          stationId: stationIds[station],
          pricePaise: rupees * 100,
          taxRateBps: 500, // 5% GST (2.5% CGST + 2.5% SGST) for non-AC/standalone restaurants
          sortOrder: ii,
          modifierGroups: {
            create: groups.map((modifierGroupId, sortOrder) => ({ modifierGroupId, sortOrder })),
          },
        },
      });
      itemCount++;
    }
  }

  console.warn(
    [
      '',
      `Seeded "${outlet.name}" (outlet ${outletId})`,
      `  20 tables / 3 sections, ${staff.length} staff, ${Object.keys(STATIONS).length} stations, ${itemCount} menu items`,
      `  Dashboard login password for email users: ${DEMO_PASSWORD}`,
      `  Staff terminal device token (x-device-token): ${DEMO_DEVICE_TOKEN}`,
      ...pinIndex,
      '',
    ].join('\n'),
  );
}

main()
  .catch((e: unknown) => {
    console.error(e);
    process.exitCode = 1;
  })
  .finally(() => void prisma.$disconnect());
