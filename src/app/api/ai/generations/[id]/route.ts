import { and, eq } from "drizzle-orm";
import { getAiFeature } from "@/config/ai";
import { getDb, schema } from "@/db";
import { getSession } from "@/lib/auth";
import { refreshVideoGeneration } from "@/lib/ai/video";

/**
 * 查询一次生成的状态：GET → { id, status: pending | succeeded | failed, url?, balance }
 * 视频任务每次查询时会顺便去平台同步进度（本地开发没有回调，全靠这里）。
 */
export async function GET(_: Request, { params }: RouteContext<"/api/ai/generations/[id]">) {
  const session = await getSession();
  if (!session) return Response.json({ error: "unauthorized" }, { status: 401 });
  const { id } = await params;

  const db = await getDb();
  let [gen] = await db
    .select()
    .from(schema.generation)
    .where(and(eq(schema.generation.id, id), eq(schema.generation.userId, session.user.id)));
  if (!gen) return Response.json({ error: "not_found" }, { status: 404 });
  if (getAiFeature(gen.feature)?.kind === "video") gen = await refreshVideoGeneration(gen);

  // 失败时积分已经退回，把最新余额带回去
  const [u] = await db.select({ credits: schema.user.credits }).from(schema.user).where(eq(schema.user.id, session.user.id));
  return Response.json({
    id: gen.id,
    status: gen.status,
    url: gen.status === "succeeded" ? gen.output : undefined,
    balance: u?.credits ?? 0,
  });
}
