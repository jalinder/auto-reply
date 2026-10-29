/* Local/staging demo data only. Never run against production. */
import { PrismaClient } from '@prisma/client';
import { hash } from '@node-rs/argon2';

const prisma = new PrismaClient();
const FIRST = ['Asha', 'Rohan', 'Meera', 'Kabir', 'Isha', 'Arjun', 'Diya', 'Vikram', 'Neha', 'Sameer', 'Priya', 'Farhan'];
const CITIES = ['Pune', 'Mumbai', 'Bengaluru', 'Jaipur', 'Kochi'];

async function main() {
  if (process.env.NODE_ENV === 'production') throw new Error('Refusing to seed production');
  const email = 'owner@demo.test';
  const user = await prisma.user.upsert({
    where: { email },
    create: { email, name: 'Demo Owner', passwordHash: await hash('DemoPassword123', { memoryCost: 19456, timeCost: 2, parallelism: 1 }) },
    update: {},
  });
  let tenant = await prisma.tenant.findUnique({ where: { slug: 'demo-store' } });
  if (!tenant) {
    tenant = await prisma.tenant.create({ data: { name: 'Demo Store', slug: 'demo-store', members: { create: { userId: user.id, role: 'owner' } } } });
  }
  for (let i = 0; i < 24; i++) {
    const phone = `+9198${String(10000000 + i * 7919).padStart(8, '0')}`;
    const c = await prisma.contact.upsert({
      where: { tenantId_phoneE164: { tenantId: tenant.id, phoneE164: phone } },
      create: {
        tenantId: tenant.id, phoneE164: phone, displayName: `${FIRST[i % FIRST.length]} ${String.fromCharCode(65 + i)}.`,
        customFields: { city: CITIES[i % CITIES.length] }, tags: i % 3 === 0 ? ['vip'] : ['newsletter'],
      },
      update: {},
    });
    if (i % 5 !== 4) {
      await prisma.contactConsent.create({ data: { tenantId: tenant.id, contactId: c.id, purpose: 'marketing', source: 'seed:checkout-optin', capturedAt: new Date() } });
    }
  }
  console.log(`Seeded. Sign in as ${email} / DemoPassword123`);
}

main().finally(() => prisma.$disconnect());
