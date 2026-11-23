import { guardAiRequest } from "@/lib/ai/guard";
import { attachJob, beginGeneration, failGeneration } from "@/lib/ai/billing";
import { submitVideo } from "@/lib/ai/providers";
import { videoWebhookUrl } from "@/lib/ai/video";

/**
 * 图生视频：POST { feature: "video", input: 动作描述, imageUrl: 上传后拿到的 publicUrl } → { id, balance }
 * 只提交任务、不等结果（视频要 1–3 分钟）；前端再用 GET /api/ai/generations/{id} 轮询进度。
 * 先扣积分再提交；提交失败、生成失败、超时都会自动退积分。
 */
export async function POST(request: Request) {
  const guard = await guardAiRequest(request, "video");
  if (guard instanceof Response) return guard;
  const { session, feature, input, body } = guard;

  const imageUrl = typeof body.imageUrl === "string" ? body.imageUrl : "";
  if (!isOwnUpload(imageUrl, session.user.id)) return Response.json({ error: "invalid_image" }, { status: 400 });

  const gen = await beginGeneration(session.user.id, feature, input);
  if (!gen.ok) return Response.json({ error: "insufficient_credits", balance: gen.balance }, { status: 402 });

  try {
    const job = await submitVideo({
      model: feature.model,
      prompt: input,
      imageUrl,
      extraInput: feature.extraInput,
      webhookUrl: videoWebhookUrl(gen.id),
    });
    await attachJob(gen.id, job);
    return Response.json({ id: gen.id, balance: gen.balance });
  } catch (e) {
    await failGeneration(gen.id, session.user.id, feature.cost, e, gen.startedAt);
    return Response.json({ error: "generation_failed", balance: gen.balance + feature.cost }, { status: 502 });
  }
}

/** 只接受用户自己上传的图片（本地 /api/files/uploads/<用户>/，线上 R2 公开域名下的 uploads/<用户>/），且是模型支持的格式 */
function isOwnUpload(url: string, userId: string) {
  if (!/\.(png|jpe?g|webp)$/i.test(url) || url.includes("..")) return false;
  const prefix = `uploads/${userId}/`;
  const r2 = (process.env.R2_PUBLIC_URL ?? "").replace(/\/$/, "");
  return url.startsWith(`/api/files/${prefix}`) || (!!r2 && url.startsWith(`${r2}/${prefix}`));
}
