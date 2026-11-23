/**
 * 价格方案 —— 改价格、加套餐只改这里
 *
 * 每个方案在支付平台后台要先建好对应的产品/价格，然后把 ID 填进环境变量：
 *   Stripe：STRIPE_PRICE_<方案ID大写>，如 STRIPE_PRICE_STARTER=price_xxx
 *   Creem ：CREEM_PRODUCT_<方案ID大写>，如 CREEM_PRODUCT_STARTER=prod_xxx
 */
export type Plan = {
  id: string;
  /** one_time：一次性购买积分包；subscription：订阅，每个周期发放积分 */
  mode: "one_time" | "subscription";
  /** 价格，单位：分（USD） */
  price: number;
  currency: "usd";
  interval?: "month" | "year";
  /** 一次性购买获得的积分，或订阅每个周期发放的积分 */
  credits: number;
  /**
   * 订阅试用期发的积分（在支付平台的产品上开了试用才用得到）。不填 = 0：试用期不发积分，第一次正式扣款才发整期的。
   * 试用期照发整期积分的话，开个试用、把积分用光、到期前取消就能白拿，AI 站这些积分是真金白银的模型成本。
   * 怎么认出试用：这一期的标价（折扣前）低于正价。优惠券只是少付钱，标价不变，照发整期积分。
   */
  trialCredits?: number;
  highlight?: boolean;
};

/**
 * 默认主推一次性积分包：热点、新词站的用户大多做完一次就走，不会订阅。
 * 只有用户会反复回来用的长期工具，才把 highlight 挪到订阅档。
 */
export const plans: Plan[] = [
  { id: "starter", mode: "one_time", price: 500, currency: "usd", credits: 100, highlight: true },
  { id: "max", mode: "one_time", price: 4900, currency: "usd", credits: 1500 },
  { id: "pro", mode: "subscription", price: 1900, currency: "usd", interval: "month", credits: 1000 },
];

export const getPlan = (id: string) => plans.find((p) => p.id === id);

export const formatPrice = (cents: number, currency = "usd") =>
  new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: currency.toUpperCase(),
    minimumFractionDigits: cents % 100 ? 2 : 0,
  }).format(cents / 100);
