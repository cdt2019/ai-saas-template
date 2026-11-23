"use client";

/**
 * 核心工具组件 —— 每个新站主要替换这个文件。首页把它放在首屏下方的产品框里。
 * 默认是一个通用的 AI 输入框演示：选模式、写提示词，点生成后带着内容跳到 /studio 真正运行。
 * 换成你自己的工具时，外层的产品框（src/app/[lang]/(site)/page.tsx 里的 #tool）可以保留复用。
 */
import { useRouter } from "next/navigation";
import { useState, type FormEvent } from "react";
import { Film, ImageIcon, PenLine, Play, Sparkles } from "lucide-react";
import type { Locale } from "@/config/site";
import type { Dictionary } from "@/i18n/dictionaries/en";
import { localePath } from "@/lib/paths";

type Mode = "text" | "image" | "video";
type Props = { t: Dictionary["tool"]; locale: Locale; costs: Record<Mode, number> };

const MODES: { id: Mode; icon: typeof Sparkles }[] = [
  { id: "text", icon: PenLine },
  { id: "image", icon: ImageIcon },
  { id: "video", icon: Film },
];

export function Tool({ t, locale, costs }: Props) {
  const router = useRouter();
  const [mode, setMode] = useState<Mode>("image");
  const [prompt, setPrompt] = useState("");
  const cost = costs[mode];

  const onSubmit = (e: FormEvent) => {
    e.preventDefault();
    const q = new URLSearchParams({ tab: mode, ...(prompt.trim() ? { prompt: prompt.trim().slice(0, 1000) } : {}) });
    router.push(`${localePath(locale, "/studio")}?${q}`);
  };

  return (
    <form onSubmit={onSubmit} className="overflow-hidden rounded-[1.25rem] text-left">
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-line px-4 py-3 sm:px-5">
        <div role="tablist" aria-label={t.label} className="seg">
          {MODES.map(({ id, icon: Icon }) => (
            <button key={id} type="button" role="tab" aria-selected={mode === id} onClick={() => setMode(id)} className="seg-item">
              <Icon className="size-3.5" /> {t.tabs[id]}
            </button>
          ))}
        </div>
        <span className="font-mono text-xs text-fg-3">{cost === 1 ? t.costOne : t.cost.replace("{n}", String(cost))}</span>
      </div>

      <div className="grid lg:grid-cols-[1.15fr_1fr]">
        <div className="flex flex-col gap-4 p-4 sm:p-5 lg:border-r lg:border-line">
          <label className="sr-only" htmlFor="tool-prompt">
            {t.placeholders[mode]}
          </label>
          <textarea
            id="tool-prompt"
            value={prompt}
            onChange={(e) => setPrompt(e.target.value)}
            placeholder={t.placeholders[mode]}
            rows={5}
            maxLength={1000}
            className="field min-h-40 resize-none bg-surface-2 text-[0.9875rem]"
          />
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div className="flex min-w-0 flex-wrap items-center gap-1.5">
              <span className="label-mono mr-1">{t.exampleLabel}</span>
              {t.examples[mode].map((ex, i) => (
                <button
                  key={ex}
                  type="button"
                  onClick={() => setPrompt(ex)}
                  className="max-w-48 truncate rounded-full border border-line bg-surface px-3 py-1 text-xs text-fg-2 transition hover:border-line-2 hover:text-fg"
                >
                  {i + 1}. {ex}
                </button>
              ))}
            </div>
            <button type="submit" className="btn btn-brand ml-auto">
              <Sparkles className="size-4" /> {t.generate}
            </button>
          </div>
          <p className="text-xs text-fg-3">{t.hint}</p>
        </div>

        {/* 结果预览：演示用的占位画面 */}
        <div className="flex flex-col gap-3 bg-surface-2/60 p-4 sm:p-5">
          <p className="flex items-center justify-between text-sm font-medium">
            {t.resultTitle}
            <span className="label-mono">{t.tabs[mode]}</span>
          </p>
          {mode === "text" ? (
            <div className="flex flex-1 flex-col gap-2.5 rounded-xl border border-line bg-surface p-4">
              {[92, 100, 84, 96, 60].map((w, i) => (
                <span key={i} className="h-2.5 rounded-full bg-viz-muted" style={{ width: `${w}%` }} />
              ))}
              <p className="mt-auto pt-3 text-xs text-fg-3">{t.resultEmpty}</p>
            </div>
          ) : (
            <div className="relative grid min-h-48 flex-1 place-items-center overflow-hidden rounded-xl border border-line bg-[radial-gradient(circle_at_28%_24%,#ffc2a8_0%,transparent_36%),radial-gradient(circle_at_76%_72%,#f0609e_0%,transparent_42%),linear-gradient(160deg,#3a2350_0%,#5a2b55_50%,#271c3a_100%)]">
              {mode === "video" && (
                <span className="grid size-12 place-items-center rounded-full bg-white/15 text-white ring-1 ring-white/30 backdrop-blur">
                  <Play className="size-5 translate-x-px" />
                </span>
              )}
              <span className="absolute bottom-3 left-3 rounded-full bg-black/30 px-2.5 py-1 font-mono text-[0.6875rem] text-white/85 backdrop-blur">
                {mode === "image" ? "1024 × 1024" : "720p · 5s"}
              </span>
            </div>
          )}
        </div>
      </div>
    </form>
  );
}
