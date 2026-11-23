/** 任务运行时拿到的上下文：写日志（会存进运行记录）、手动运行时带的参数、触发方式 */
export type JobContext = {
  log: (line: string) => void;
  params: Record<string, unknown>;
  trigger: JobTrigger;
};

/** tick：外部定时调用（Vercel Cron / GitHub Actions / crontab）；internal：进程内定时器；manual：后台手动运行 */
export type JobTrigger = "tick" | "internal" | "manual";

export type JobDef = {
  name: string;
  /** 默认频率（cron，UTC）；后台可以改 */
  schedule: string;
  /** 最长运行时间：超过就算失败，并释放锁 */
  timeoutMs: number;
  run: (ctx: JobContext) => Promise<Record<string, unknown>>;
};
