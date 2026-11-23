/**
 * 密码规则：至少 8 位，同时包含字母和数字。
 * 浏览器端提交前先查一遍（给出本地化提示），服务端在 Better Auth 里再强制一遍（见 src/lib/auth.ts）
 */
export const PASSWORD_MIN = 8;

export const isValidPassword = (p: string) => p.length >= PASSWORD_MIN && /[A-Za-z]/.test(p) && /\d/.test(p);
