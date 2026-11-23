/**
 * 积分和退款的纯计算（不碰数据库），单元测试在 tests/credit-math.test.ts。
 * 金额都是分，积分都是整数。取整方向是规则的一部分：退给用户的钱向下取整，扣回的积分向上取整，平台不会多退、用户不会多留
 */

export type RefundFigures = {
  /** 这笔付款还没被扣回的积分 */
  remaining: number;
  /** 其中用户还没用掉的 */
  unused: number;
  /** 可退金额（分） */
  amount: number;
  /** 退这么多钱要扣回的积分 */
  credits: number;
};

/**
 * 这笔付款现在能退多少：
 * - 剩余 = 当初发的积分 + 关联流水净额（扣回是负数，退还是正数）
 * - 发放之后用掉的积分（AI 失败自动退回的已抵消）保守地认为先用的是这一笔
 * - 未用 = min(当前余额, 剩余 − 发放后用掉的)；退款金额 = 实付 × 未用 / 当初发的，向下取整到分
 * - 要扣回的积分 = 按退款金额占实付的比例向上取整（不会超过未用）
 */
export function computeRefund(input: { paid: number; granted: number; linkedNet: number; spentSinceGrant: number; balance: number }): RefundFigures {
  const { paid, granted, linkedNet, spentSinceGrant, balance } = input;
  const remaining = granted + linkedNet;
  const unused = Math.max(0, Math.min(balance, remaining - Math.max(0, spentSinceGrant)));
  const amount = paid > 0 && granted > 0 ? Math.floor((paid * unused) / granted) : 0;
  const credits = amount > 0 ? Math.ceil((granted * amount) / paid) : 0;
  return { remaining, unused, amount, credits };
}

export type RefundLimits = { maxUsedRatio: number; minAmount: number };

/** 算出来的结果能不能自助退款：不能的话返回原因，能的话返回 null */
export function refundBlock(f: RefundFigures, balance: number, rules: RefundLimits): "nothing" | "frozen" | "used" | null {
  if (f.remaining <= 0) return "nothing";
  if (balance < 0) return "frozen";
  if ((f.remaining - f.unused) / f.remaining > rules.maxUsedRatio) return "used";
  if (f.amount < rules.minAmount) return "nothing";
  return null;
}

/**
 * 平台退款 / 拒付到账时要扣回多少积分：
 * - target = 当初发的 × 退款比例，向上取整
 * - cumulative（Stripe 报的是累计已退）：扣到 target 为止；否则这次最多扣 target，且累计不超过当初发的
 * - held 是提交申请时已经冻结的积分，算作这次扣回的一部分：change > 0 再扣，change < 0 退还多冻结的
 */
export function computeClawback(input: { granted: number; ratio?: number; alreadyClawed: number; held?: number; cumulative?: boolean }) {
  const { granted, alreadyClawed, held = 0, cumulative = false } = input;
  const ratio = Math.min(Math.max(input.ratio ?? 1, 0), 1);
  const target = Math.ceil(granted * ratio);
  const amount = Math.max(cumulative ? target - alreadyClawed : Math.min(target, granted - alreadyClawed), 0);
  return { amount, change: amount - held };
}

/** 付款的退款状态 */
export const refundStatus = (refunded: number, amount: number) => (refunded <= 0 ? "paid" : refunded >= amount ? "refunded" : "partially_refunded");
