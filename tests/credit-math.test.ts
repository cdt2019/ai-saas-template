import { describe, expect, it } from "vitest";
import { computeClawback, computeRefund, refundBlock, refundStatus } from "@/lib/credit-math";

const rules = { maxUsedRatio: 0.5, minAmount: 50 };
const pack = { paid: 500, granted: 100, linkedNet: 0, spentSinceGrant: 0, balance: 100 };

describe("computeRefund", () => {
  it("refunds everything when nothing was used", () => {
    expect(computeRefund(pack)).toEqual({ remaining: 100, unused: 100, amount: 500, credits: 100 });
  });

  it("refunds in proportion to unused credits", () => {
    expect(computeRefund({ ...pack, spentSinceGrant: 30, balance: 70 })).toEqual({ remaining: 100, unused: 70, amount: 350, credits: 70 });
  });

  it("uses the discounted price actually paid", () => {
    expect(computeRefund({ ...pack, paid: 400, spentSinceGrant: 25, balance: 75 }).amount).toBe(300);
  });

  it("rounds the money down and the credits up", () => {
    const r = computeRefund({ paid: 999, granted: 7, linkedNet: 0, spentSinceGrant: 2, balance: 5 });
    expect(r.amount).toBe(713); // 999 * 5 / 7 = 713.57
    expect(r.credits).toBe(5); // 7 * 713 / 999 = 4.996
  });

  it("never exceeds the current balance", () => {
    expect(computeRefund({ ...pack, balance: 20 }).unused).toBe(20);
  });

  it("subtracts credits already clawed back", () => {
    const r = computeRefund({ ...pack, linkedNet: -40, balance: 60 });
    expect(r.remaining).toBe(60);
    expect(r.amount).toBe(300);
  });

  it("adds back credits restored after a clawback", () => {
    expect(computeRefund({ ...pack, linkedNet: -40 + 10, balance: 70 }).remaining).toBe(70);
  });

  it("treats a negative spend figure as zero", () => {
    expect(computeRefund({ ...pack, spentSinceGrant: -5 }).unused).toBe(100);
  });

  it("returns nothing for a negative balance", () => {
    expect(computeRefund({ ...pack, balance: -10 })).toMatchObject({ unused: 0, amount: 0, credits: 0 });
  });

  it("returns nothing when everything was spent", () => {
    expect(computeRefund({ ...pack, spentSinceGrant: 100, balance: 0 })).toMatchObject({ unused: 0, amount: 0, credits: 0 });
  });

  it("handles free and zero-credit grants without dividing by zero", () => {
    expect(computeRefund({ ...pack, paid: 0 }).amount).toBe(0);
    expect(computeRefund({ ...pack, granted: 0, balance: 0 }).amount).toBe(0);
  });

  it("holds its invariants for every small combination", () => {
    for (const paid of [1, 50, 99, 450, 500, 999, 1900, 4900]) {
      for (const granted of [1, 3, 7, 100, 1000, 1500]) {
        for (const spent of [0, 1, Math.floor(granted / 2), granted - 1, granted]) {
          for (const balance of [0, 1, granted - spent, granted, granted * 3]) {
            const r = computeRefund({ paid, granted, linkedNet: 0, spentSinceGrant: spent, balance });
            expect(r.amount).toBeGreaterThanOrEqual(0);
            expect(r.amount).toBeLessThanOrEqual(paid);
            expect(r.credits).toBeLessThanOrEqual(r.unused);
            // 退的钱不超过扣回积分对应的价值
            expect(r.amount * granted).toBeLessThanOrEqual(r.credits * paid);
          }
        }
      }
    }
  });
});

describe("refundBlock", () => {
  const block = (input: Partial<typeof pack>) => {
    const merged = { ...pack, ...input };
    return refundBlock(computeRefund(merged), merged.balance, rules);
  };

  it("allows an eligible refund", () => expect(block({})).toBeNull());
  it("allows exactly the maximum used ratio", () => expect(block({ spentSinceGrant: 50, balance: 50 })).toBeNull());
  it("blocks just over the maximum used ratio", () => expect(block({ spentSinceGrant: 51, balance: 49 })).toBe("used"));
  it("blocks a negative balance as frozen", () => expect(block({ balance: -1 })).toBe("frozen"));
  it("blocks when nothing remains", () => expect(block({ linkedNet: -100, balance: 0 })).toBe("nothing"));
  it("blocks below the minimum amount", () => expect(block({ paid: 60, spentSinceGrant: 40, balance: 60 })).toBe("nothing"));
  it("allows exactly the minimum amount", () => expect(block({ paid: 50 })).toBeNull());
});

describe("computeClawback", () => {
  it("claws back the whole grant by default", () => {
    expect(computeClawback({ granted: 100, alreadyClawed: 0 })).toEqual({ amount: 100, change: 100 });
  });

  it("claws back a partial refund, rounding up", () => {
    expect(computeClawback({ granted: 100, ratio: 0.333, alreadyClawed: 0 }).amount).toBe(34);
  });

  it("never claws back more than was granted across refunds", () => {
    expect(computeClawback({ granted: 100, ratio: 0.8, alreadyClawed: 50 }).amount).toBe(50);
    expect(computeClawback({ granted: 100, ratio: 1, alreadyClawed: 100 }).amount).toBe(0);
  });

  it("treats a cumulative refund as a running total", () => {
    expect(computeClawback({ granted: 100, ratio: 0.5, alreadyClawed: 30, cumulative: true }).amount).toBe(20);
    expect(computeClawback({ granted: 100, ratio: 0.2, alreadyClawed: 30, cumulative: true }).amount).toBe(0);
  });

  it("counts held credits towards the clawback", () => {
    expect(computeClawback({ granted: 100, ratio: 0.7, alreadyClawed: 0, held: 70 })).toEqual({ amount: 70, change: 0 });
  });

  it("claws back the difference when the refund is larger than the hold", () => {
    expect(computeClawback({ granted: 100, ratio: 1, alreadyClawed: 0, held: 70 }).change).toBe(30);
  });

  it("returns excess when the refund is smaller than the hold", () => {
    expect(computeClawback({ granted: 100, ratio: 0.5, alreadyClawed: 0, held: 70 }).change).toBe(-20);
  });

  it("clamps out-of-range ratios", () => {
    expect(computeClawback({ granted: 100, ratio: 2, alreadyClawed: 0 }).amount).toBe(100);
    expect(computeClawback({ granted: 100, ratio: -1, alreadyClawed: 0 }).amount).toBe(0);
  });
});

describe("refundStatus", () => {
  it("maps refunded amounts to a status", () => {
    expect(refundStatus(0, 500)).toBe("paid");
    expect(refundStatus(1, 500)).toBe("partially_refunded");
    expect(refundStatus(499, 500)).toBe("partially_refunded");
    expect(refundStatus(500, 500)).toBe("refunded");
    expect(refundStatus(600, 500)).toBe("refunded");
  });
});
