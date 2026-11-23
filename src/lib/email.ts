import "server-only";
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { siteConfig } from "@/config/site";
import { isLocalDev } from "@/lib/env";

/**
 * 发送邮件：配置 RESEND_API_KEY 后通过 Resend 发送；未配置时打印到控制台（本地开发可直接复制验证码），
 * 本机开发时还会写到 .data/dev-mail/<收件人>.txt（每个收件人只留最新一封），测试脚本靠它拿验证码
 * 发件地址 EMAIL_FROM 需要是 Resend 里已验证的域名，如 "SeamNotes <hello@yourdomain.com>"
 */
export async function sendEmail({ to, subject, html, headers }: { to: string; subject: string; html: string; headers?: Record<string, string> }): Promise<boolean> {
  const key = process.env.RESEND_API_KEY;
  if (!key) {
    const text = `To: ${to}\nSubject: ${subject}\n${html.replace(/<[^>]+>/g, " ")}`;
    console.info(`\n[email:dev] ${text.replace(/\n/g, "\n[email:dev] ")}\n`);
    // 线上没配 Resend：验证码发不出去，用户注册不了，要在日志里显眼地报出来
    if (!isLocalDev()) console.error("[email] RESEND_API_KEY is not set, so this email was NOT delivered:", subject);
    if (isLocalDev()) {
      const dir = path.join(process.cwd(), ".data", "dev-mail");
      await mkdir(dir, { recursive: true });
      await writeFile(path.join(dir, `${to.replace(/[^\w.@+-]/g, "_")}.txt`), text);
    }
    return isLocalDev();
  }
  const res = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json" },
    body: JSON.stringify({
      from: process.env.EMAIL_FROM ?? `${siteConfig.name} <onboarding@resend.dev>`,
      to,
      subject,
      html,
      ...(headers ? { headers } : {}),
    }),
  });
  if (!res.ok) console.error("[email] send failed", res.status, await res.text());
  return res.ok;
}

/** 本地开发且没配 Resend：验证码页提示「验证码在终端里」 */
export const devMailHint = () => process.env.NODE_ENV !== "production" && !process.env.RESEND_API_KEY;

/** 验证码邮件：标题以验证码开头，手机通知栏里不点开就能看到 */
export function otpEmail(otp: string, type: string) {
  const reset = type === "forget-password";
  return {
    subject: `${otp} is your ${siteConfig.name} ${reset ? "password reset" : "verification"} code`,
    html: emailLayout({
      title: reset ? "Reset your password" : "Verify your email",
      body: reset
        ? "Enter this code to choose a new password. It expires in 10 minutes. If you didn't ask for this, you can ignore this email."
        : "Enter this code to finish signing up. It expires in 10 minutes. If you didn't try to sign up, you can ignore this email.",
      code: otp,
    }),
  };
}

/** 简洁的邮件模板：标题 + 正文 + 验证码 / 按钮 */
export function emailLayout({
  title,
  body,
  action,
  code,
  footer,
}: {
  title: string;
  body: string;
  action?: { label: string; url: string };
  code?: string;
  /** 正文下面的小字（可含 HTML，调用方负责转义），比如退订链接 */
  footer?: string;
}) {
  return `<!doctype html><html><body style="margin:0;background:#f7f3f8;font-family:-apple-system,Segoe UI,Helvetica,Arial,sans-serif;color:#1e1530">
<div style="max-width:520px;margin:0 auto;padding:40px 24px">
<p style="font-size:15px;font-weight:600;margin:0 0 32px"><span style="display:inline-block;width:22px;height:22px;border-radius:7px;background:#ff6a55;background-image:linear-gradient(135deg,#ff7a59,#e8488a 58%,#9b4bc4);vertical-align:-6px;margin-right:8px"></span>${siteConfig.name}</p>
<h1 style="font-size:24px;line-height:1.25;margin:0 0 16px">${title}</h1>
<p style="font-size:15px;line-height:1.6;color:#574d66;margin:0 0 28px">${body}</p>
${
  code
    ? `<p style="display:inline-block;margin:0;padding:14px 22px;border-radius:14px;background:#ffffff;border:1px solid #e6dcea;font:600 30px/1 ui-monospace,SFMono-Regular,Menlo,Consolas,monospace;letter-spacing:8px;color:#1e1530">${code}</p>`
    : ""
}
${
  action
    ? `<a href="${action.url}" style="display:inline-block;background:#1e1530;color:#ffffff;text-decoration:none;padding:12px 22px;border-radius:12px;font-size:14px;font-weight:600">${action.label}</a>
<p style="font-size:12px;color:#6e6480;margin:28px 0 0;word-break:break-all">${action.url}</p>`
    : ""
}
${footer ? `<p style="font-size:12px;line-height:1.6;color:#6e6480;margin:32px 0 0;padding-top:16px;border-top:1px solid #e6dcea">${footer}</p>` : ""}
</div></body></html>`;
}
