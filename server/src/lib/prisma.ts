import { PrismaClient } from '@prisma/client';

/**
 * Single Prisma client. In dev, tsx watch reloads the module graph, so we stash
 * the instance on globalThis to avoid exhausting SQLite connections.
 */
const globalForPrisma = globalThis as unknown as { prisma?: PrismaClient };

export const prisma =
  globalForPrisma.prisma ??
  new PrismaClient({
    log: process.env.NODE_ENV === 'development' ? ['warn', 'error'] : ['error'],
  });

if (process.env.NODE_ENV !== 'production') {
  globalForPrisma.prisma = prisma;
}
