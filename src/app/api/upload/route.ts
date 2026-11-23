import { getSession } from "@/lib/auth";
import { limits } from "@/lib/abuse";
import { newId } from "@/lib/ids";
import { rateLimit, tooManyRequests } from "@/lib/rate-limit";
import { createUploadUrl, upload } from "@/lib/storage";

/**
 * 申请上传：POST { contentType, size } → { uploadUrl, publicUrl, key }
 * 前端拿到 uploadUrl 后用 PUT 直接把文件传上去（带同样的 Content-Type）。
 */
export async function POST(request: Request) {
  const session = await getSession();
  if (!session) return Response.json({ error: "unauthorized" }, { status: 401 });

  const { contentType = "", size = 0 } = (await request.json().catch(() => ({}))) as {
    contentType?: string;
    size?: number;
  };
  const ext = upload.types[contentType];
  if (!ext) return Response.json({ error: "unsupported_type" }, { status: 400 });
  if (!size || size > upload.maxBytes) return Response.json({ error: "file_too_large", max: upload.maxBytes }, { status: 400 });

  const r = await rateLimit(`upload:${session.user.id}`, limits.uploadsPerUserPerHour, 3600);
  if (!r.ok) return tooManyRequests(r.retryAfter);

  // 按用户分目录，文件名随机，避免覆盖和被猜到
  const key = `uploads/${session.user.id}/${newId("f")}.${ext}`;
  const urls = await createUploadUrl(key, contentType);
  return Response.json({ ...urls, key });
}
