import "server-only";
import { notFound } from "next/navigation";
import { adminEmails as adminEmailList } from "./admin-emails";
import { getSession } from "./auth";

/**
 * 管理员校验，满足任一条件即可：
 *   1. 数据库里 role 为 admin（后台「用户」里可以改，或 UPDATE "user" SET role='admin' WHERE email='...'）
 *   2. 邮箱在 ADMIN_EMAILS 里，**并且邮箱已验证**：用 Google / GitHub 登录（邮箱由对方验证过），
 *      或邮箱注册后输入过验证码
 * 只看邮箱不看验证的话，站点上线后、你注册之前，任何人用你的邮箱抢注就能拿到后台，给自己加积分。
 */
const ADMIN_EMAILS = adminEmailList();

export function isAdminUser(u: { role?: string | null; email: string; emailVerified: boolean }) {
  return u.role === "admin" || (u.emailVerified && ADMIN_EMAILS.includes(u.email.toLowerCase()));
}

/** 管理员因为 ADMIN_EMAILS 而是管理员（不是数据库 role）：后台改不了，要改环境变量 */
export const isEnvAdmin = (email: string) => ADMIN_EMAILS.includes(email.toLowerCase());
export const adminEmails = () => ADMIN_EMAILS;

export async function getAdminSession() {
  const session = await getSession();
  return session && isAdminUser(session.user) ? session : null;
}

/** 后台页面用：非管理员一律 404，不暴露后台的存在 */
export async function requireAdmin() {
  const session = await getAdminSession();
  if (!session) notFound();
  return session;
}
