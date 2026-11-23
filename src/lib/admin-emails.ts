/** ADMIN_EMAILS（逗号分隔，小写）。单独一个文件、不依赖登录模块，auth.ts / notify.ts 都能用，不会循环引用 */
export const adminEmails = () =>
  (process.env.ADMIN_EMAILS ?? "")
    .split(",")
    .map((e) => e.trim().toLowerCase())
    .filter(Boolean);
