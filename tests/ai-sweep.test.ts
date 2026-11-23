import path from "node:path";
import { PGlite } from "@electric-sql/pglite";
import { eq } from "drizzle-orm";
import { drizzle } from "drizzle-orm/pglite";
import { migrate } from "drizzle-orm/pglite/migrator";
import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import * as schema from "@/db/schema";

/** 没人再查询的 AI 任务：该结单的结单，该退款的退款，而且只退一次 */
const state = vi.hoisted(() => ({ db: null as unknown, video: { state: "pending" } as Record<string, string> }));
vi.mock("@/db", async () => ({ getDb: async () => state.db, schema: await import("@/db/schema") }));
vi.mock("@/lib/notify", () => ({ notify: vi.fn(), notifyIfLow: vi.fn() }));
vi.mock("@/lib/email", () => ({ sendEmail: vi.fn(), emailLayout: () => "" }));
vi.mock("@/lib/env", () => ({ authSecret: () => "test-secret" }));
vi.mock("@/lib/monitoring", () => ({ captureError: vi.fn() }));
vi.mock("@/lib/ai/providers", () => ({ checkVideo: async () => state.video }));

const { sweepPendingGenerations } = await import("@/lib/ai/video");
const { failGeneration, succeedGeneration } = await import("@/lib/ai/billing");

const db = drizzle(new PGlite(), { schema });
const USER = "user_sweep";
const MIN = 60_000;
const log = () => {};
const balance = async () => (await db.select({ c: schema.user.credits }).from(schema.user).where(eq(schema.user.id, USER)))[0].c;
const statusOf = async (id: string) => (await db.select({ s: schema.generation.status }).from(schema.generation).where(eq(schema.generation.id, id)))[0].s;

/** 模拟 begin：已经扣了积分、记录是 pending */
async function pending(id: string, opts: { feature?: string; ageMin: number; job?: boolean; cost?: number }) {
  const cost = opts.cost ?? 50;
  await db.update(schema.user).set({ credits: (await balance()) - cost }).where(eq(schema.user.id, USER));
  await db.insert(schema.generation).values({
    id,
    userId: USER,
    feature: opts.feature ?? "video",
    model: "test",
    cost,
    status: "pending",
    job: opts.job === false ? null : JSON.stringify({ provider: "mock" }),
    createdAt: new Date(Date.now() - opts.ageMin * MIN),
  });
}

beforeAll(async () => {
  await migrate(db, { migrationsFolder: path.resolve(__dirname, "../drizzle") });
  state.db = db;
});

beforeEach(async () => {
  state.video = { state: "pending" };
  await db.delete(schema.creditTransaction);
  await db.delete(schema.generation);
  await db.delete(schema.user);
  await db.insert(schema.user).values({ id: USER, name: "Test", email: "sweep@example.com", credits: 100 });
});

describe("sweepPendingGenerations", () => {
  it("leaves recent jobs to polling and webhooks", async () => {
    await pending("g1", { ageMin: 2 });
    expect((await sweepPendingGenerations(log)).checked).toBe(0);
    expect(await statusOf("g1")).toBe("pending");
  });

  it("keeps a job that is still running inside the timeout", async () => {
    await pending("g1", { ageMin: 10 });
    expect((await sweepPendingGenerations(log)).stillPending).toBe(1);
    expect(await balance()).toBe(50);
  });

  it("refunds a video past the timeout", async () => {
    await pending("g1", { ageMin: 25 });
    expect((await sweepPendingGenerations(log)).refunded).toBe(1);
    expect(await statusOf("g1")).toBe("failed");
    expect(await balance()).toBe(100);
  });

  it("finishes a video the provider already completed, without refunding", async () => {
    state.video = { state: "done", url: "https://example.com/v.mp4" };
    await pending("g1", { ageMin: 25 });
    expect((await sweepPendingGenerations(log)).succeeded).toBe(1);
    expect(await balance()).toBe(50);
  });

  it("refunds a video the provider reports as failed", async () => {
    state.video = { state: "failed", error: "model error" };
    await pending("g1", { ageMin: 6 });
    await sweepPendingGenerations(log);
    expect(await balance()).toBe(100);
  });

  it("refunds a charge that never reached the provider, only after the timeout", async () => {
    await pending("g1", { ageMin: 10, job: false });
    await sweepPendingGenerations(log);
    expect(await statusOf("g1")).toBe("pending");
    await pending("g2", { ageMin: 25, job: false });
    await sweepPendingGenerations(log);
    expect(await statusOf("g2")).toBe("failed");
    expect(await balance()).toBe(50);
  });

  it("refunds interrupted text calls after the timeout but not before", async () => {
    await pending("t1", { feature: "rewrite", ageMin: 10, job: false, cost: 1 });
    await pending("t2", { feature: "rewrite", ageMin: 25, job: false, cost: 1 });
    await sweepPendingGenerations(log);
    expect(await statusOf("t1")).toBe("pending");
    expect(await statusOf("t2")).toBe("failed");
    expect(await balance()).toBe(99);
  });

  it("refunds once when swept repeatedly or concurrently", async () => {
    await pending("g1", { ageMin: 25 });
    await Promise.all([sweepPendingGenerations(log), sweepPendingGenerations(log), sweepPendingGenerations(log)]);
    await sweepPendingGenerations(log);
    expect(await balance()).toBe(100);
  });
});

describe("failGeneration", () => {
  it("doesn't refund a generation that already succeeded", async () => {
    await pending("g1", { ageMin: 1 });
    expect(await succeedGeneration("g1", "https://example.com/v.mp4", Date.now())).toBe(true);
    expect(await failGeneration("g1", USER, 50, new Error("late timeout"), Date.now())).toBe(false);
    expect(await statusOf("g1")).toBe("succeeded");
    expect(await balance()).toBe(50);
  });
});
