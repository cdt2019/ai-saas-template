import { guardAiRequest } from "@/lib/ai/guard";
import { beginGeneration, failGeneration, succeedGeneration } from "@/lib/ai/billing";
import { generateImage } from "@/lib/ai/providers";

/** 图片生成：POST { feature: "image", input: 提示词 } → { url, balance }；失败自动退积分 */
export const maxDuration = 60;

export async function POST(request: Request) {
  const guard = await guardAiRequest(request, "image");
  if (guard instanceof Response) return guard;
  const { session, feature, input } = guard;

  const gen = await beginGeneration(session.user.id, feature, input);
  if (!gen.ok) return Response.json({ error: "insufficient_credits", balance: gen.balance }, { status: 402 });

  try {
    const url = await generateImage({ model: feature.model, prompt: input, signal: request.signal });
    await succeedGeneration(gen.id, url, gen.startedAt);
    return Response.json({ url, balance: gen.balance, id: gen.id });
  } catch (e) {
    await failGeneration(gen.id, session.user.id, feature.cost, e, gen.startedAt);
    return Response.json({ error: "generation_failed", balance: gen.balance + feature.cost }, { status: 502 });
  }
}
