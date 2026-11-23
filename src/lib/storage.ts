import "server-only";
import { AwsClient } from "aws4fetch";

/**
 * 文件存储：浏览器直传（不经过我们的服务器，省带宽、不受函数体积限制）
 * - 线上：Cloudflare R2（S3 兼容，出站流量免费）→ 返回预签名 PUT 地址
 *     R2_ACCOUNT_ID / R2_ACCESS_KEY_ID / R2_SECRET_ACCESS_KEY / R2_BUCKET
 *     R2_PUBLIC_URL：桶绑定的公开域名，如 https://files.yourdomain.com
 * - 本地开发未配置 R2：上传到 .data/uploads，通过 /api/files/... 访问
 */
export const upload = {
  /** 允许的文件类型 → 扩展名 */
  types: {
    "image/png": "png",
    "image/jpeg": "jpg",
    "image/webp": "webp",
    "image/gif": "gif",
  } as Record<string, string>,
  maxBytes: 10 * 1024 * 1024,
};

export const isR2Configured = () =>
  !!(process.env.R2_ACCOUNT_ID && process.env.R2_ACCESS_KEY_ID && process.env.R2_SECRET_ACCESS_KEY && process.env.R2_BUCKET);

/** 生成直传地址：{ uploadUrl（PUT）, publicUrl } */
export async function createUploadUrl(key: string, contentType: string) {
  if (!isR2Configured()) {
    if (process.env.NODE_ENV === "production") throw new Error("R2 is not configured");
    return {
      uploadUrl: `/api/upload/local?key=${encodeURIComponent(key)}`,
      publicUrl: `/api/files/${key}`,
    };
  }
  const client = new AwsClient({
    accessKeyId: process.env.R2_ACCESS_KEY_ID!,
    secretAccessKey: process.env.R2_SECRET_ACCESS_KEY!,
    service: "s3",
    region: "auto",
  });
  const url = new URL(`https://${process.env.R2_ACCOUNT_ID}.r2.cloudflarestorage.com/${process.env.R2_BUCKET}/${key}`);
  url.searchParams.set("X-Amz-Expires", "600"); // 10 分钟内有效
  const signed = await client.sign(new Request(url, { method: "PUT", headers: { "Content-Type": contentType } }), {
    aws: { signQuery: true },
  });
  const publicBase = (process.env.R2_PUBLIC_URL ?? "").replace(/\/$/, "");
  return { uploadUrl: signed.url, publicUrl: `${publicBase}/${key}` };
}
