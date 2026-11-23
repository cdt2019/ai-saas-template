import { eq } from "drizzle-orm";
import { getDb, schema } from "@/db";
import { refreshVideoGeneration, verifyWebhookToken } from "@/lib/ai/video";

/**
 * fal 生成完成的回调（提交视频任务时通过 fal_webhook 传入，地址里带签名）。
 * 不信任回调内容，只把它当作「去查一下」的信号：结果仍以我们用自己的 key 查到的为准。
 */
export async function POST(request: Request) {
  const url = new URL(request.url);
  const id = url.searchParams.get("gen") ?? "";
  const token = url.searchParams.get("token") ?? "";
  if (!id || !verifyWebhookToken(id, token)) return new Response("Forbidden", { status: 403 });

  const db = await getDb();
  const [gen] = await db.select().from(schema.generation).where(eq(schema.generation.id, id));
  if (gen) await refreshVideoGeneration(gen);
  return Response.json({ ok: true });
}
