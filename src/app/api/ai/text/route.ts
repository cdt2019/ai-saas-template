import { guardAiRequest } from "@/lib/ai/guard";
import { beginGeneration, failGeneration, succeedGeneration } from "@/lib/ai/billing";
import { streamText } from "@/lib/ai/providers";
import { AI_ERROR_MARKER } from "@/lib/ai/constants";

/**
 * 文本生成（流式）：POST { feature: "rewrite", input } → text/plain 流
 * 响应头 X-Credits-Balance 为扣费后的余额。模型中途出错时自动退积分，并在流末尾追加错误标记。
 */
export async function POST(request: Request) {
  const guard = await guardAiRequest(request, "text");
  if (guard instanceof Response) return guard;
  const { session, feature, input } = guard;

  const gen = await beginGeneration(session.user.id, feature, input);
  if (!gen.ok) return Response.json({ error: "insufficient_credits", balance: gen.balance }, { status: 402 });

  const encoder = new TextEncoder();
  const abort = new AbortController();
  let output = "";
  let cancelled = false;

  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      try {
        for await (const chunk of streamText({
          model: feature.model,
          system: feature.system,
          prompt: input,
          maxTokens: feature.maxTokens,
          signal: abort.signal,
        })) {
          if (cancelled) break;
          output += chunk;
          controller.enqueue(encoder.encode(chunk));
        }
        if (!output) throw new Error(cancelled ? "Cancelled before any output" : "Empty response from model");
        await succeedGeneration(gen.id, output, gen.startedAt);
      } catch (e) {
        // 用户已经看到了部分结果再断开：照常计费。否则「读完再断开」就能白拿结果、积分全退
        if (cancelled && output) await succeedGeneration(gen.id, output, gen.startedAt);
        else await failGeneration(gen.id, session.user.id, feature.cost, e, gen.startedAt);
        if (!cancelled) controller.enqueue(encoder.encode(AI_ERROR_MARKER));
      } finally {
        if (!cancelled) controller.close();
      }
    },
    cancel() {
      // 用户中途关闭页面：停止调用模型，已生成的部分照常计费
      cancelled = true;
      abort.abort();
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "text/plain; charset=utf-8",
      "Cache-Control": "no-store",
      "X-Credits-Balance": String(gen.balance),
      "X-Generation-Id": gen.id,
    },
  });
}
