import fs from "node:fs/promises";
import path from "node:path";
import { isR2Configured } from "@/lib/storage";

const MIME: Record<string, string> = { png: "image/png", jpg: "image/jpeg", webp: "image/webp", gif: "image/gif" };

/** 本地开发时读取 .data/uploads 里的文件（线上文件由 R2 公开域名直接提供） */
export async function GET(_: Request, { params }: RouteContext<"/api/files/[...key]">) {
  if (process.env.NODE_ENV === "production" || isR2Configured()) return new Response("Not found", { status: 404 });
  const { key } = await params;
  const rel = key.join("/");
  if (!rel.startsWith("uploads/") || rel.includes("..")) return new Response("Not found", { status: 404 });
  try {
    const data = await fs.readFile(path.join(process.cwd(), ".data", rel));
    const ext = rel.split(".").pop() ?? "";
    return new Response(data, { headers: { "Content-Type": MIME[ext] ?? "application/octet-stream" } });
  } catch {
    return new Response("Not found", { status: 404 });
  }
}
