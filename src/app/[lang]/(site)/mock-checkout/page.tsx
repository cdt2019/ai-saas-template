import type { Metadata } from "next";
import { notFound, redirect } from "next/navigation";
import { eq } from "drizzle-orm";
import { getDb, schema } from "@/db";
import { formatPrice } from "@/config/pricing";
import { getDictionary, hasLocale } from "@/i18n";
import { getSession } from "@/lib/auth";
import { localePath } from "@/lib/paths";
import { isMockPayments } from "@/lib/payments";
import { MockPayButton } from "@/components/account/ClientActions";

/** 依赖登录状态 / 查询参数，每次请求实时渲染 */
export const dynamic = "force-dynamic";

export const metadata: Metadata = { title: "Test checkout", robots: { index: false } };

/** 本地模拟收银台（仅开发环境且 PAYMENT_PROVIDER=mock） */
export default async function MockCheckoutPage({ params, searchParams }: PageProps<"/[lang]/mock-checkout">) {
  const { lang } = await params;
  if (!hasLocale(lang) || !isMockPayments()) notFound();
  const session = await getSession();
  if (!session) redirect(localePath(lang, "/login"));

  const { order: orderId, next } = await searchParams;
  const db = await getDb();
  const [ord] =
    typeof orderId === "string" ? await db.select().from(schema.order).where(eq(schema.order.id, orderId)) : [];
  if (!ord || ord.userId !== session.user.id) notFound();

  const dict = await getDictionary(lang);
  const nextUrl = typeof next === "string" ? next : localePath(lang, "/dashboard");
  const planName = dict.pricing.plans[ord.planId]?.name ?? ord.planId;

  return (
    <section className="container-x grid min-h-[70vh] place-items-center py-16">
      <div className="bezel w-full max-w-md">
        <div className="card p-8">
          <p className="flex items-center justify-between">
            <span className="label-mono">{dict.mock.title}</span>
            <span className="badge badge-warning">test mode</span>
          </p>
          <p className="mt-8 text-sm text-fg-2">{planName}</p>
          <p className="mt-1 text-[3.25rem] leading-none font-semibold tracking-[-0.05em] tabular-nums">{formatPrice(ord.amount, ord.currency)}</p>
          <p className="mt-6 rounded-xl border border-line bg-surface-2 px-4 py-3 text-sm leading-relaxed text-fg-2">{dict.mock.lead}</p>
          <div className="mt-6 space-y-3">
            <MockPayButton orderId={ord.id} next={nextUrl} label={dict.mock.pay} />
            <a href={localePath(lang, "/pricing")} className="btn btn-ghost w-full">
              {dict.mock.cancel}
            </a>
          </div>
        </div>
      </div>
    </section>
  );
}
