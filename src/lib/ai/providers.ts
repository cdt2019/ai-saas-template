import "server-only";
import fs from "node:fs/promises";
import path from "node:path";

/**
 * AI 调用层：不依赖任何 SDK，直接调 HTTP，换模型 / 换平台只改配置。
 * - streamText：OpenAI 兼容的 /chat/completions 流式接口（OpenRouter、OpenAI、DeepSeek 等都兼容）
 * - generateImage：fal.ai 同步接口 https://fal.run/<model>
 * - submitVideo / checkVideo：fal.ai 队列接口 https://queue.fal.run/<model>（视频要排队 1–3 分钟）
 * - 未配置 key 的开发环境：mock 实现
 */

export const isMockAi = (kind: "text" | "image" | "video") =>
  process.env.NODE_ENV !== "production" && !(kind === "text" ? process.env.AI_API_KEY : process.env.FAL_KEY);

/** 流式生成文本，逐段 yield 字符串 */
export async function* streamText(opts: {
  model: string;
  system?: string;
  prompt: string;
  maxTokens?: number;
  signal?: AbortSignal;
}): AsyncGenerator<string> {
  if (isMockAi("text")) {
    yield* mockText(opts.prompt);
    return;
  }
  const key = process.env.AI_API_KEY;
  if (!key) throw new Error("AI_API_KEY is not set");
  const base = process.env.AI_BASE_URL ?? "https://openrouter.ai/api/v1";

  const res = await fetch(`${base}/chat/completions`, {
    method: "POST",
    signal: opts.signal,
    headers: {
      Authorization: `Bearer ${key}`,
      "Content-Type": "application/json",
      // OpenRouter 用于统计来源（可选）
      "HTTP-Referer": process.env.NEXT_PUBLIC_SITE_URL ?? "",
      "X-Title": "saas-template",
    },
    body: JSON.stringify({
      model: opts.model,
      stream: true,
      max_tokens: opts.maxTokens,
      messages: [
        ...(opts.system ? [{ role: "system", content: opts.system }] : []),
        { role: "user", content: opts.prompt },
      ],
    }),
  });
  if (!res.ok || !res.body) throw new Error(`AI request failed: ${res.status} ${await res.text().catch(() => "")}`);

  // 解析 SSE：每行 "data: {...}"，以 "data: [DONE]" 结束
  const reader = res.body.pipeThrough(new TextDecoderStream()).getReader();
  let buffer = "";
  while (true) {
    const { value, done } = await reader.read();
    if (done) break;
    buffer += value;
    const lines = buffer.split("\n");
    buffer = lines.pop() ?? "";
    for (const line of lines) {
      const data = line.trim().replace(/^data:\s*/, "");
      if (!data || data === "[DONE]" || line.startsWith(":")) continue;
      try {
        const json = JSON.parse(data) as {
          choices?: { delta?: { content?: string } }[];
          error?: { message?: string };
        };
        if (json.error) throw new Error(json.error.message ?? "AI stream error");
        const text = json.choices?.[0]?.delta?.content;
        if (text) yield text;
      } catch (e) {
        if (e instanceof SyntaxError) continue; // 不完整的行，忽略
        throw e;
      }
    }
  }
}

/** 生成一张图片，返回图片 URL */
export async function generateImage(opts: { model: string; prompt: string; signal?: AbortSignal }): Promise<string> {
  if (isMockAi("image")) return mockImage(opts.prompt);
  const key = process.env.FAL_KEY;
  if (!key) throw new Error("FAL_KEY is not set");

  const res = await fetch(`https://fal.run/${opts.model}`, {
    method: "POST",
    signal: opts.signal,
    headers: { Authorization: `Key ${key}`, "Content-Type": "application/json" },
    body: JSON.stringify({ prompt: opts.prompt, image_size: "square_hd", num_images: 1 }),
  });
  if (!res.ok) throw new Error(`Image request failed: ${res.status} ${await res.text().catch(() => "")}`);
  const data = (await res.json()) as { images?: { url: string }[] };
  const url = data.images?.[0]?.url;
  if (!url) throw new Error("Image model returned no image");
  return url;
}

/* ---------------- 视频（异步队列） ---------------- */

/** 存进 generation.job 的任务信息：fal 返回的查询地址，或 mock 的完成时间 */
export type VideoJob =
  | { provider: "fal"; requestId: string; statusUrl: string; responseUrl: string }
  | { provider: "mock"; readyAt: number; fail: boolean };

export type VideoStatus = { state: "pending" } | { state: "done"; url: string } | { state: "failed"; error: string };

/**
 * 提交一个图生视频任务，立即返回任务信息（不等结果）。
 * webhookUrl：线上传入后，fal 生成完会回调它，用户关掉页面也能完成并收到邮件。
 */
export async function submitVideo(opts: {
  model: string;
  prompt: string;
  imageUrl: string;
  extraInput?: Record<string, unknown>;
  webhookUrl?: string;
}): Promise<VideoJob> {
  if (isMockAi("video")) {
    // 8 秒后完成；提示词里带 __fail__ 时模拟失败，用来测试自动退积分
    return { provider: "mock", readyAt: Date.now() + 8000, fail: opts.prompt.includes("__fail__") };
  }
  const key = process.env.FAL_KEY;
  if (!key) throw new Error("FAL_KEY is not set");

  const url = new URL(`https://queue.fal.run/${opts.model}`);
  if (opts.webhookUrl) url.searchParams.set("fal_webhook", opts.webhookUrl);
  const res = await fetch(url, {
    method: "POST",
    headers: { Authorization: `Key ${key}`, "Content-Type": "application/json" },
    body: JSON.stringify({ ...opts.extraInput, prompt: opts.prompt, image_url: await reachableImageUrl(opts.imageUrl) }),
  });
  if (!res.ok) throw new Error(`Video submit failed: ${res.status} ${await res.text().catch(() => "")}`);
  const data = (await res.json()) as { request_id?: string; status_url?: string; response_url?: string };
  if (!data.request_id || !data.status_url || !data.response_url) throw new Error("Video submit returned no request id");
  // 必须用返回的地址查询：带子路径的模型自己拼地址会 405
  return { provider: "fal", requestId: data.request_id, statusUrl: data.status_url, responseUrl: data.response_url };
}

/** 查询视频任务进度 */
export async function checkVideo(job: VideoJob): Promise<VideoStatus> {
  if (job.provider === "mock") {
    if (Date.now() < job.readyAt) return { state: "pending" };
    return job.fail ? { state: "failed", error: "Mock model failure" } : { state: "done", url: "/mock/sample-video.mp4" };
  }
  const headers = { Authorization: `Key ${process.env.FAL_KEY ?? ""}` };
  const status = await fetch(job.statusUrl, { headers });
  if (!status.ok) throw new Error(`Video status failed: ${status.status}`); // 网络抖动：保持 pending，下次再查
  const { status: state } = (await status.json()) as { status?: string };
  if (state === "IN_QUEUE" || state === "IN_PROGRESS") return { state: "pending" };

  const res = await fetch(job.responseUrl, { headers });
  const data = (await res.json().catch(() => ({}))) as { video?: { url?: string }; detail?: unknown; error?: unknown };
  if (!res.ok) return { state: "failed", error: `${res.status} ${JSON.stringify(data.detail ?? data.error ?? "")}`.slice(0, 500) };
  const videoUrl = data.video?.url;
  return videoUrl ? { state: "done", url: videoUrl } : { state: "failed", error: "Video model returned no video" };
}

/** 本地开发上传的图片是 /api/files/... 相对地址，fal 访问不到，转成 data URI 传过去 */
async function reachableImageUrl(url: string): Promise<string> {
  if (!url.startsWith("/api/files/")) return url;
  const rel = url.replace(/^\/api\/files\//, "");
  if (!rel.startsWith("uploads/") || rel.includes("..")) throw new Error("Invalid image url");
  const data = await fs.readFile(path.join(process.cwd(), ".data", rel));
  const ext = rel.endsWith(".png") ? "png" : rel.endsWith(".webp") ? "webp" : "jpeg";
  return `data:image/${ext};base64,${data.toString("base64")}`;
}

/* ---------------- mock（仅开发环境） ---------------- */

/** 输入里包含 __fail__ 时模拟模型报错，用来测试“失败自动退积分” */
async function* mockText(prompt: string): AsyncGenerator<string> {
  if (prompt.includes("__fail__")) throw new Error("Mock model failure");
  const reply = `[mock] ${prompt.trim().replace(/\s+/g, " ")} — rewritten to be clearer and more natural. Configure AI_API_KEY to use a real model.`;
  for (const word of reply.split(/(?<= )/)) {
    await new Promise((r) => setTimeout(r, 25));
    yield word;
  }
}

async function mockImage(prompt: string): Promise<string> {
  if (prompt.includes("__fail__")) throw new Error("Mock model failure");
  await new Promise((r) => setTimeout(r, 600));
  const text = prompt.slice(0, 60).replace(/[<&>"]/g, "");
  const hue = [...prompt].reduce((h, c) => (h + c.charCodeAt(0)) % 360, 0);
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="512" height="512"><defs><linearGradient id="g" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="hsl(${hue},80%,70%)"/><stop offset="1" stop-color="hsl(${(hue + 90) % 360},70%,45%)"/></linearGradient></defs><rect width="512" height="512" fill="url(#g)"/><text x="32" y="470" font-family="monospace" font-size="18" fill="#fff">mock · ${text}</text></svg>`;
  return `data:image/svg+xml;base64,${Buffer.from(svg).toString("base64")}`;
}
