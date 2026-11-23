import { randomBytes } from "node:crypto";

/** 生成带前缀的随机 id，如 ord_3kf9a...，便于在日志里一眼看出类型 */
export function newId(prefix: string): string {
  return `${prefix}_${randomBytes(12).toString("base64url")}`;
}
