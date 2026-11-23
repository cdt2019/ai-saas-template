/**
 * AI 功能配置 —— 每个付费功能一条：用什么模型、扣多少积分、输入上限
 *
 * 文本：任何 OpenAI 兼容接口（默认 OpenRouter，一个 key 可切换 Claude / GPT / Gemini / DeepSeek 等）
 *   AI_API_KEY=sk-or-...   AI_BASE_URL=https://openrouter.ai/api/v1（默认）
 * 图片、视频：fal.ai（视频走异步队列：提交任务 → 轮询或回调拿结果）
 *   FAL_KEY=...
 * 两者都没配置时（仅开发环境）自动使用 mock，返回演示结果，方便调 UI 和扣费流程。
 *
 * 定价建议：先算单次调用的模型成本，积分售价至少覆盖 3 倍成本（留出支付手续费、失败重试和免费额度）。
 */
export type AiFeature = {
  id: string;
  kind: "text" | "image" | "video";
  /** 每次调用消耗的积分 */
  cost: number;
  /** 模型 id（OpenRouter / fal.ai 的写法），可用环境变量覆盖 */
  model: string;
  /** 输入最大字符数 */
  maxInput: number;
  /** 额外传给模型的参数（各模型字段不同，以 fal 模型页的 API 文档为准） */
  extraInput?: Record<string, unknown>;
  /** 文本功能的系统提示词 */
  system?: string;
  /** 文本功能最多输出多少 token */
  maxTokens?: number;
};

export const aiFeatures: AiFeature[] = [
  {
    id: "rewrite",
    kind: "text",
    cost: 1,
    model: process.env.AI_TEXT_MODEL ?? "anthropic/claude-haiku-4.5",
    maxInput: 4000,
    maxTokens: 1200,
    system:
      "You are a precise writing assistant. Rewrite the user's text to be clearer and more natural while keeping its meaning, language and approximate length. Reply with the rewritten text only.",
  },
  {
    id: "image",
    kind: "image",
    cost: 5,
    model: process.env.AI_IMAGE_MODEL ?? "fal-ai/flux/schnell",
    maxInput: 1000,
  },
  {
    // 图生视频：用户上传一张照片 + 一句动作描述，生成一段短视频。一条视频要 1–3 分钟，走异步任务
    id: "video",
    kind: "video",
    cost: 50,
    model: process.env.AI_VIDEO_MODEL ?? "bytedance/seedance-2.5/us/image-to-video",
    maxInput: 500,
    // 时长和清晰度直接决定模型成本，先按单条成本定好积分价再放开
    extraInput: { duration: "5", resolution: "720p" },
  },
];

export const getAiFeature = (id: string) => aiFeatures.find((f) => f.id === id);
