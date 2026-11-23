import path from "node:path";
import { PGlite } from "@electric-sql/pglite";
import { eq, sql } from "drizzle-orm";
import { drizzle } from "drizzle-orm/pglite";
import { migrate } from "drizzle-orm/pglite/migrator";
import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import * as schema from "@/db/schema";

/** 积分账本：用内存里的真实 Postgres（PGlite）跑，幂等和并发才测得准 */
const state = vi.hoisted(() => ({ db: null as unknown }));
vi.mock("@/db", async () => ({ getDb: async () => state.db, schema: await import("@/db/schema") }));
vi.mock("@/lib/notify", () => ({ notifyIfLow: vi.fn() }));

const { deductCredits, grantCredits, spendCredits } = await import("@/lib/credits");

const db = drizzle(new PGlite(), { schema });
const USER = "user_test";
const balance = async () => (await db.select({ c: schema.user.credits }).from(schema.user).where(eq(schema.user.id, USER)))[0].c;
const ledger = async () => Number((await db.select({ n: sql`coalesce(sum(${schema.creditTransaction.delta}), 0)` }).from(schema.creditTransaction))[0].n);

beforeAll(async () => {
  await migrate(db, { migrationsFolder: path.resolve(__dirname, "../drizzle") });
  state.db = db;
});

beforeEach(async () => {
  await db.delete(schema.creditTransaction);
  await db.delete(schema.user);
  await db.insert(schema.user).values({ id: USER, name: "Test", email: "test@example.com", credits: 0 });
});

describe("grantCredits", () => {
  it("adds credits and writes the ledger", async () => {
    expect(await grantCredits({ userId: USER, amount: 100, reason: "purchase", refId: "order_1" })).toBe(true);
    expect(await balance()).toBe(100);
    expect(await ledger()).toBe(100);
  });

  it("is idempotent for the same refId", async () => {
    await grantCredits({ userId: USER, amount: 100, reason: "purchase", refId: "order_1" });
    expect(await grantCredits({ userId: USER, amount: 100, reason: "purchase", refId: "order_1" })).toBe(false);
    expect(await balance()).toBe(100);
  });

  it("grants once when the same webhook arrives concurrently", async () => {
    const results = await Promise.all(Array.from({ length: 10 }, () => grantCredits({ userId: USER, amount: 100, reason: "purchase", refId: "order_race" })));
    expect(results.filter(Boolean)).toHaveLength(1);
    expect(await balance()).toBe(100);
  });
});

describe("spendCredits", () => {
  beforeEach(() => grantCredits({ userId: USER, amount: 10, reason: "purchase", refId: "seed" }));

  it("spends and returns the new balance", async () => {
    expect(await spendCredits({ userId: USER, amount: 3 })).toEqual({ ok: true, balance: 7 });
    expect(await ledger()).toBe(7);
  });

  it("can spend the exact balance", async () => {
    expect((await spendCredits({ userId: USER, amount: 10 })).ok).toBe(true);
    expect(await balance()).toBe(0);
  });

  it("refuses to overspend and writes nothing", async () => {
    expect(await spendCredits({ userId: USER, amount: 11 })).toEqual({ ok: false, balance: 10 });
    expect(await balance()).toBe(10);
    expect(await ledger()).toBe(10);
  });

  it("never goes negative under concurrent spending", async () => {
    const results = await Promise.all(Array.from({ length: 25 }, () => spendCredits({ userId: USER, amount: 3 })));
    expect(results.filter((r) => r.ok)).toHaveLength(3);
    expect(await balance()).toBe(1);
    expect(await ledger()).toBe(1);
  });
});

describe("deductCredits", () => {
  it("can take the balance negative, which freezes paid features", async () => {
    await grantCredits({ userId: USER, amount: 10, reason: "purchase", refId: "seed" });
    expect(await deductCredits({ userId: USER, amount: 30, reason: "clawback", refId: "refund_1" })).toBe(true);
    expect(await balance()).toBe(-20);
    expect((await spendCredits({ userId: USER, amount: 1 })).ok).toBe(false);
  });

  it("is idempotent for the same refund", async () => {
    await grantCredits({ userId: USER, amount: 100, reason: "purchase", refId: "seed" });
    await deductCredits({ userId: USER, amount: 40, reason: "clawback", refId: "refund_1" });
    expect(await deductCredits({ userId: USER, amount: 40, reason: "clawback", refId: "refund_1" })).toBe(false);
    expect(await balance()).toBe(60);
  });

  it("keeps the balance equal to the ledger through a mixed sequence", async () => {
    await grantCredits({ userId: USER, amount: 100, reason: "purchase", refId: "a" });
    await spendCredits({ userId: USER, amount: 25 });
    await deductCredits({ userId: USER, amount: 50, reason: "clawback", refId: "b" });
    await grantCredits({ userId: USER, amount: 10, reason: "restore", refId: "c" });
    await spendCredits({ userId: USER, amount: 5 });
    expect(await balance()).toBe(30);
    expect(await ledger()).toBe(30);
  });
});
