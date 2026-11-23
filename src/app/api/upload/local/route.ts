import fs from "node:fs/promises";
import path from "node:path";
import { getSession } from "@/lib/auth";
import { isR2Configured, upload } from "@/lib/storage";

/** 本地开发用的“假 R2”：接收 PUT 上传，存到 .data/uploads（线上配置 R2 后不会用到） */
export async function PUT(request: Request) {
  if (process.env.NODE_ENV === "production" || isR2Configured()) return new Response("Not found", { status: 404 });
  const session = await getSession();
  if (!session) return new Response("Unauthorized", { status: 401 });

  const key = new URL(request.url).searchParams.get("key") ?? "";
  // 只能写自己的目录，且不允许 ../ 之类的路径
  if (!key.startsWith(`uploads/${session.user.id}/`) || key.includes("..")) {
    return new Response("Forbidden", { status: 403 });
  }
  const body = Buffer.from(await request.arrayBuffer());
  if (body.length > upload.maxBytes) return new Response("Too large", { status: 413 });

  const file = path.join(process.cwd(), ".data", key);
  await fs.mkdir(path.dirname(file), { recursive: true });
  await fs.writeFile(file, body);
  return new Response(null, { status: 200 });
}
