"use client";

/**
 * AI 工作台（演示 AI 封装的前端用法）：
 *   - 文本：POST /api/ai/text，逐块读取流式响应
 *   - 图片：POST /api/ai/image
 *   - 视频：上传照片 → POST /api/ai/video 提交任务 → 每 3 秒 GET /api/ai/generations/{id} 查进度
 *   - 上传：POST /api/upload 拿直传地址 → PUT 文件
 * 首页的 Tool 演示会带 ?tab=image&prompt=… 跳过来，这里读出来预填。
 * 做新站时，把这里换成你的核心功能 UI，接口调用方式照抄即可。
 */
import Link from "next/link";
import { useEffect, useRef, useState, useSyncExternalStore, type FormEvent } from "react";
import { Download, Film, ImageIcon, Lock, PenLine, Sparkles, Upload, Zap } from "lucide-react";
import type { Locale } from "@/config/site";
import type { Dictionary } from "@/i18n/dictionaries/en";
import { useSession } from "@/lib/auth-client";
import { usePulse } from "@/lib/pulse";
import { AI_ERROR_MARKER } from "@/lib/ai/constants";
import { localePath } from "@/lib/paths";
import { SwapLabel } from "@/components/ui";

type T = Dictionary["studio"];
type Tab = "text" | "image" | "video" | "upload";
type Costs = { text: number; image: number; video: number };

const TABS: Tab[] = ["text", "image", "video", "upload"];
const ICONS: Record<Tab, typeof Sparkles> = { text: PenLine, image: ImageIcon, video: Film, upload: Upload };

/** 地址栏里的 ?tab= / ?prompt=（服务端渲染时为空） */
const noSubscribe = () => () => {};
const readQuery = () => window.location.search;
const useQuery = () => new URLSearchParams(useSyncExternalStore(noSubscribe, readQuery, () => ""));

/** 把接口错误码翻译成用户能看懂的提示 */
function errorMessage(status: number, t: T, locale: Locale): React.ReactNode {
  if (status === 402)
    return (
      <>
        {t.insufficient}{" "}
        <Link href={localePath(locale, "/pricing")} className="font-medium underline">
          {t.buy}
        </Link>
      </>
    );
  if (status === 429) return t.rateLimited;
  if (status === 400) return t.tooLong;
  return t.failed;
}

function ErrorText({ children }: { children: React.ReactNode }) {
  return <p className="rounded-xl border border-danger/25 bg-danger-soft px-3.5 py-2.5 text-sm text-danger-fg">{children}</p>;
}

export function Studio({ t, locale, costs }: { t: T; locale: Locale; costs: Costs }) {
  const { data: session, isPending, refetch } = useSession();
  const pulse = usePulse();
  const query = useQuery();
  const queryTab = query.get("tab") as Tab | null;
  const prompt = query.get("prompt") ?? "";
  const [picked, setPicked] = useState<Tab | null>(null);
  const tab: Tab = picked ?? (queryTab && TABS.includes(queryTab) ? queryTab : "text");
  const [balance, setBalance] = useState<number | null>(null);
  const shownBalance = balance ?? session?.user.credits ?? 0;
  const cost = tab === "upload" ? 0 : costs[tab];

  const onBalance = (b: number) => {
    setBalance(b);
    refetch();
    pulse?.refresh(); // 同步右上角的积分显示（以及「积分不足」之类的新通知）
  };

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div role="tablist" className="seg">
          {TABS.map((id) => {
            const Icon = ICONS[id];
            return (
              <button key={id} type="button" role="tab" aria-selected={tab === id} onClick={() => setPicked(id)} className="seg-item">
                <Icon className="size-3.5" /> {t.tabs[id]}
              </button>
            );
          })}
        </div>
        <div className="flex items-center gap-2">
          {cost > 0 && (
            <span className="badge badge-neutral badge-plain font-mono">
              {cost} {cost === 1 ? t.costOne : t.cost}
            </span>
          )}
          {session && (
            <span className="badge badge-brand badge-plain gap-1.5 font-mono">
              <Zap className="size-3" /> {t.balance} <span className="tabular-nums">{shownBalance.toLocaleString()}</span>
            </span>
          )}
        </div>
      </div>

      <div className="bezel">
        <div className="card min-h-[420px] overflow-hidden">
          {isPending ? (
            <div className="grid min-h-[420px] place-items-center">
              <span className="size-6 animate-spin rounded-full border-2 border-line border-t-brand-1" />
            </div>
          ) : !session ? (
            <div className="relative grid min-h-[420px] place-items-center overflow-hidden px-6 text-center">
              <div aria-hidden className="absolute inset-0 bg-[radial-gradient(ellipse_at_50%_0%,var(--glow-1),transparent_60%)]" />
              <div className="relative">
                <span className="mx-auto grid size-12 place-items-center rounded-2xl bg-brand-gradient text-white shadow-[0_12px_28px_-10px_var(--glow-1)]">
                  <Lock className="size-5" />
                </span>
                <p className="mx-auto mt-5 max-w-sm text-fg-2">{t.signIn}</p>
                <div className="mt-6 flex flex-wrap justify-center gap-2">
                  <Link
                    href={`${localePath(locale, "/login")}?next=${encodeURIComponent(localePath(locale, "/studio"))}`}
                    className="btn btn-secondary"
                  >
                    {locale === "zh" ? "登录" : "Sign in"}
                  </Link>
                  <Link href={localePath(locale, "/signup")} className="btn btn-brand">
                    {locale === "zh" ? "免费注册" : "Sign up free"}
                  </Link>
                </div>
              </div>
            </div>
          ) : tab === "text" ? (
            <TextPanel key="text" t={t} locale={locale} cost={costs.text} onBalance={onBalance} prompt={queryTab === "text" ? prompt : ""} />
          ) : tab === "image" ? (
            <ImagePanel key="image" t={t} locale={locale} cost={costs.image} onBalance={onBalance} prompt={queryTab === "image" ? prompt : ""} />
          ) : tab === "video" ? (
            <VideoPanel key="video" t={t} locale={locale} cost={costs.video} onBalance={onBalance} prompt={queryTab === "video" ? prompt : ""} />
          ) : (
            <UploadPanel t={t} />
          )}
        </div>
      </div>
    </div>
  );
}

/** 左输入、右输出的两栏 */
function Split({ input, output, onSubmit }: { input: React.ReactNode; output: React.ReactNode; onSubmit?: (e: FormEvent<HTMLFormElement>) => void }) {
  const body = (
    <div className="grid min-h-[420px] lg:grid-cols-2">
      <div className="flex flex-col gap-4 p-5 sm:p-6 lg:border-r lg:border-line">{input}</div>
      <div className="flex flex-col gap-3 bg-surface-2/60 p-5 sm:p-6">{output}</div>
    </div>
  );
  return onSubmit ? <form onSubmit={onSubmit}>{body}</form> : body;
}

function PanelLabel({ children }: { children: React.ReactNode }) {
  return <p className="label-mono">{children}</p>;
}

function RunButton({ t, cost, pending }: { t: T; cost: number; pending: boolean }) {
  return (
    <div className="flex flex-wrap items-center gap-3">
      <button type="submit" disabled={pending} className="btn btn-brand">
        <SwapLabel
          show={pending}
          alt={
            <>
              <Sparkles className="size-4 animate-pulse" /> {t.running}
            </>
          }
        >
          <Sparkles className="size-4" /> {t.run}
        </SwapLabel>
      </button>
      <span className="font-mono text-xs text-fg-3">
        {cost} {cost === 1 ? t.costOne : t.cost}
      </span>
    </div>
  );
}

function TextPanel({
  t,
  locale,
  cost,
  onBalance,
  prompt,
}: {
  t: T;
  locale: Locale;
  cost: number;
  onBalance: (b: number) => void;
  prompt: string;
}) {
  const [output, setOutput] = useState("");
  const [error, setError] = useState<React.ReactNode>(null);
  const [pending, setPending] = useState(false);

  const onSubmit = async (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    const input = String(new FormData(e.currentTarget).get("input"));
    setPending(true);
    setOutput("");
    setError(null);

    const res = await fetch("/api/ai/text", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ feature: "rewrite", input }),
    });
    if (!res.ok || !res.body) {
      setPending(false);
      return setError(errorMessage(res.status, t, locale));
    }
    const balance = Number(res.headers.get("X-Credits-Balance"));
    if (!Number.isNaN(balance)) onBalance(balance);

    // 逐块读取流式输出
    const reader = res.body.pipeThrough(new TextDecoderStream()).getReader();
    let text = "";
    while (true) {
      const { value, done } = await reader.read();
      if (done) break;
      text += value;
      setOutput(text.replace(AI_ERROR_MARKER, ""));
    }
    if (text.endsWith(AI_ERROR_MARKER)) {
      setError(t.failed);
      onBalance(balance + cost); // 服务端已退款
    }
    setPending(false);
  };

  return (
    <Split
      onSubmit={onSubmit}
      input={
        <>
          <PanelLabel>{t.input}</PanelLabel>
          <textarea
            name="input"
            required
            rows={10}
            maxLength={4000}
            defaultValue={prompt}
            placeholder={t.textPlaceholder}
            className="field flex-1 resize-y bg-surface-2"
          />
          <RunButton t={t} cost={cost} pending={pending} />
        </>
      }
      output={
        <>
          <PanelLabel>{t.output}</PanelLabel>
          <div className="min-h-48 flex-1 rounded-xl border border-line bg-surface p-4 text-[0.9375rem] leading-relaxed whitespace-pre-wrap">
            {output || <span className="text-fg-3">{pending ? "…" : t.outputEmpty}</span>}
          </div>
          {error && <ErrorText>{error}</ErrorText>}
        </>
      }
    />
  );
}

function ImagePanel({
  t,
  locale,
  cost,
  onBalance,
  prompt,
}: {
  t: T;
  locale: Locale;
  cost: number;
  onBalance: (b: number) => void;
  prompt: string;
}) {
  const [url, setUrl] = useState("");
  const [error, setError] = useState<React.ReactNode>(null);
  const [pending, setPending] = useState(false);

  const onSubmit = async (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    const input = String(new FormData(e.currentTarget).get("input"));
    setPending(true);
    setError(null);
    const res = await fetch("/api/ai/image", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ feature: "image", input }),
    });
    const data = (await res.json().catch(() => ({}))) as { url?: string; balance?: number };
    setPending(false);
    if (typeof data.balance === "number") onBalance(data.balance);
    if (!res.ok || !data.url) return setError(errorMessage(res.status, t, locale));
    setUrl(data.url);
  };

  return (
    <Split
      onSubmit={onSubmit}
      input={
        <>
          <PanelLabel>{t.input}</PanelLabel>
          <textarea
            name="input"
            required
            rows={6}
            maxLength={1000}
            defaultValue={prompt}
            placeholder={t.imagePlaceholder}
            className="field resize-y bg-surface-2"
          />
          <RunButton t={t} cost={cost} pending={pending} />
          {error && <ErrorText>{error}</ErrorText>}
        </>
      }
      output={
        <>
          <div className="flex items-center justify-between">
            <PanelLabel>{t.output}</PanelLabel>
            {url && (
              <a href={url} download target="_blank" rel="noreferrer" className="btn btn-secondary btn-sm">
                <Download className="size-3.5" /> {t.download}
              </a>
            )}
          </div>
          <div className="grid aspect-square w-full place-items-center overflow-hidden rounded-xl border border-line bg-surface">
            {url ? (
              // 生成结果来自第三方域名，用原生 img 即可
              // eslint-disable-next-line @next/next/no-img-element
              <img src={url} alt="" className="size-full object-cover" />
            ) : (
              <span className="flex flex-col items-center gap-3 text-sm text-fg-3">
                <ImageIcon className={`size-9 ${pending ? "animate-pulse text-brand" : ""}`} />
                {pending ? t.running : t.outputEmpty}
              </span>
            )}
          </div>
        </>
      }
    />
  );
}

/** 直传一个文件，返回可访问的地址（失败返回 null） */
async function uploadFile(file: File): Promise<string | null> {
  const res = await fetch("/api/upload", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ contentType: file.type, size: file.size }),
  });
  const data = (await res.json().catch(() => ({}))) as { uploadUrl?: string; publicUrl?: string };
  if (!data.uploadUrl || !data.publicUrl) return null;
  const put = await fetch(data.uploadUrl, { method: "PUT", headers: { "Content-Type": file.type }, body: file });
  return put.ok ? data.publicUrl : null;
}

/** 刷新页面后接着查上一次没完成的视频任务 */
const PENDING_VIDEO_KEY = "studio:pending-video";
const savePending = (id: string | null) => {
  try {
    if (id) localStorage.setItem(PENDING_VIDEO_KEY, id);
    else localStorage.removeItem(PENDING_VIDEO_KEY);
  } catch {}
};

function VideoPanel({
  t,
  locale,
  cost,
  onBalance,
  prompt,
}: {
  t: T;
  locale: Locale;
  cost: number;
  onBalance: (b: number) => void;
  prompt: string;
}) {
  const fileInput = useRef<HTMLInputElement>(null);
  const [imageUrl, setImageUrl] = useState("");
  const [uploading, setUploading] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  // 这个面板只在客户端拿到登录态后才渲染，可以直接读 localStorage
  const [jobId, setJobId] = useState<string | null>(() => {
    try {
      return localStorage.getItem(PENDING_VIDEO_KEY);
    } catch {
      return null;
    }
  });
  const [elapsed, setElapsed] = useState(0);
  const [videoUrl, setVideoUrl] = useState("");
  const [error, setError] = useState<React.ReactNode>(null);
  // onBalance 每次渲染都是新函数，用 ref 拿最新的，避免轮询反复重启
  const onBalanceRef = useRef(onBalance);
  useEffect(() => {
    onBalanceRef.current = onBalance;
  });

  // 有任务时每 3 秒查一次进度，直到成功或失败
  useEffect(() => {
    if (!jobId) return;
    let stopped = false;
    let timer: ReturnType<typeof setTimeout>;
    const started = Date.now();
    const tick = async () => {
      const res = await fetch(`/api/ai/generations/${jobId}`).catch(() => null);
      if (stopped) return;
      setElapsed(Math.round((Date.now() - started) / 1000));
      const data = (await res?.json().catch(() => ({}))) as { status?: string; url?: string; balance?: number } | undefined;
      if (data?.status === "succeeded" && data.url) {
        setVideoUrl(data.url);
      } else if (data?.status === "failed" || res?.status === 404) {
        setError(t.failed);
        if (typeof data?.balance === "number") onBalanceRef.current(data.balance); // 积分已退回
      } else {
        timer = setTimeout(tick, 3000);
        return;
      }
      savePending(null);
      setJobId(null);
    };
    tick();
    return () => {
      stopped = true;
      clearTimeout(timer);
    };
  }, [jobId, t.failed]);

  const onFile = async (file: File) => {
    setUploading(true);
    setError(null);
    const url = await uploadFile(file);
    setUploading(false);
    if (!url) return setError(t.failed);
    setImageUrl(url);
  };

  const onSubmit = async (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    if (!imageUrl) return setError(t.videoNeedPhoto);
    const input = String(new FormData(e.currentTarget).get("input"));
    setSubmitting(true);
    setError(null);
    setVideoUrl("");
    const res = await fetch("/api/ai/video", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ feature: "video", input, imageUrl }),
    });
    const data = (await res.json().catch(() => ({}))) as { id?: string; balance?: number };
    setSubmitting(false);
    if (typeof data.balance === "number") onBalance(data.balance);
    if (!res.ok || !data.id) return setError(errorMessage(res.status, t, locale));
    setElapsed(0);
    savePending(data.id);
    setJobId(data.id);
  };

  const busy = submitting || !!jobId;

  return (
    <Split
      onSubmit={onSubmit}
      input={
        <>
          <PanelLabel>{t.input}</PanelLabel>
          <input
            ref={fileInput}
            type="file"
            accept="image/png,image/jpeg,image/webp"
            className="hidden"
            onChange={(e) => e.target.files?.[0] && onFile(e.target.files[0])}
          />
          <div className="flex items-center gap-4 rounded-xl border border-dashed border-line-2 bg-surface-2 p-3">
            <button
              type="button"
              onClick={() => fileInput.current?.click()}
              disabled={busy || uploading}
              aria-label={t.choose}
              className="grid size-20 shrink-0 place-items-center overflow-hidden rounded-lg border border-line bg-surface transition hover:border-brand-1"
            >
              {imageUrl ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img src={imageUrl} alt="" className="size-full object-cover" />
              ) : (
                <Upload className={`size-6 text-fg-3 ${uploading ? "animate-pulse text-brand" : ""}`} />
              )}
            </button>
            <p className="text-sm text-fg-2">{t.videoPhotoHint}</p>
          </div>
          <textarea
            name="input"
            required
            rows={3}
            maxLength={500}
            defaultValue={prompt || t.videoPromptDefault}
            className="field resize-y bg-surface-2"
          />
          <RunButton t={t} cost={cost} pending={busy} />
          <p className="text-xs text-fg-3">{t.videoEmail}</p>
          {error && <ErrorText>{error}</ErrorText>}
        </>
      }
      output={
        <>
          <PanelLabel>{t.output}</PanelLabel>
          <div className="grid aspect-video w-full place-items-center overflow-hidden rounded-xl border border-line bg-surface">
            {videoUrl ? (
              <div className="relative size-full">
                <video src={videoUrl} controls autoPlay loop playsInline className="size-full bg-black object-contain" />
                <a
                  href={videoUrl}
                  download
                  target="_blank"
                  rel="noreferrer"
                  className="btn btn-secondary btn-sm absolute top-3 right-3"
                >
                  <Download className="size-3.5" /> {t.download}
                </a>
              </div>
            ) : (
              <div className="px-6 text-center">
                <Film className={`mx-auto size-9 ${jobId ? "animate-pulse text-brand" : "text-fg-3"}`} />
                <p className="mt-3 text-sm text-fg-3">
                  {jobId ? (
                    <>
                      {t.videoWaiting} <span className="font-mono tabular-nums">{elapsed}s</span>
                    </>
                  ) : (
                    t.outputEmpty
                  )}
                </p>
              </div>
            )}
          </div>
        </>
      }
    />
  );
}

function UploadPanel({ t }: { t: T }) {
  const input = useRef<HTMLInputElement>(null);
  const [url, setUrl] = useState("");
  const [status, setStatus] = useState("");

  const onFile = async (file: File) => {
    setStatus("…");
    setUrl("");
    const res = await fetch("/api/upload", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ contentType: file.type, size: file.size }),
    });
    const data = (await res.json().catch(() => ({}))) as { uploadUrl?: string; publicUrl?: string; error?: string };
    if (!data.uploadUrl) return setStatus(data.error ?? "error");
    const put = await fetch(data.uploadUrl, { method: "PUT", headers: { "Content-Type": file.type }, body: file });
    if (!put.ok) return setStatus(`upload failed (${put.status})`);
    setUrl(data.publicUrl!);
    setStatus(t.uploaded);
  };

  return (
    <Split
      input={
        <>
          <PanelLabel>{t.input}</PanelLabel>
          <input
            ref={input}
            type="file"
            accept="image/png,image/jpeg,image/webp,image/gif"
            className="hidden"
            onChange={(e) => e.target.files?.[0] && onFile(e.target.files[0])}
          />
          <button
            type="button"
            onClick={() => input.current?.click()}
            className="flex flex-1 flex-col items-center justify-center gap-3 rounded-xl border border-dashed border-line-2 bg-surface-2 p-8 text-center transition hover:border-brand-1"
          >
            <span className="grid size-11 place-items-center rounded-xl bg-brand-soft text-brand">
              <Upload className="size-5" />
            </span>
            <span className="text-sm font-medium">{t.choose}</span>
            <span className="max-w-xs text-xs text-fg-3">{t.uploadHint}</span>
          </button>
          {status && <p className="font-mono text-xs text-fg-3">{status}</p>}
          {url && <p className="font-mono text-xs break-all text-fg-2">{url}</p>}
        </>
      }
      output={
        <>
          <PanelLabel>{t.output}</PanelLabel>
          <div className="grid aspect-square w-full place-items-center overflow-hidden rounded-xl border border-line bg-surface">
            {url ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={url} alt="" className="size-full object-contain" />
            ) : (
              <span className="flex flex-col items-center gap-3 text-sm text-fg-3">
                <Upload className="size-9" />
                {t.outputEmpty}
              </span>
            )}
          </div>
        </>
      }
    />
  );
}
