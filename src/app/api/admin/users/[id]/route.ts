import { getAdminSession } from "@/lib/admin";
import { banUser, deleteUser, revokeUserSessions, setUserRole, unbanUser } from "@/lib/admin-users";

/**
 * 后台对单个用户的操作：POST { action, ... }
 * - set_role { role: "admin" | "user" }
 * - ban { reason, days?: number }（不传 days 为永久）· unban
 * - revoke_sessions：踢下线
 * - delete { confirmEmail }：只能删没付过款的账号
 * 不能对自己操作；不能封禁 / 删除管理员。每次操作写进 admin_log
 */
const STATUS: Record<string, number> = { not_found: 404, self: 409, target_admin: 409, has_payments: 409, invalid_input: 400 };

export async function POST(request: Request, { params }: RouteContext<"/api/admin/users/[id]">) {
  const session = await getAdminSession();
  if (!session) return Response.json({ error: "forbidden" }, { status: 403 });
  const { id } = await params;
  const body = (await request.json().catch(() => ({}))) as {
    action?: string;
    role?: string;
    reason?: string;
    days?: number | null;
    confirmEmail?: string;
  };
  const admin = { id: session.user.id, email: session.user.email };

  const result =
    body.action === "set_role"
      ? await setUserRole(admin, id, String(body.role ?? ""))
      : body.action === "ban"
        ? await banUser(admin, id, String(body.reason ?? ""), body.days == null ? null : Number(body.days))
        : body.action === "unban"
          ? await unbanUser(admin, id)
          : body.action === "revoke_sessions"
            ? await revokeUserSessions(admin, id)
            : body.action === "delete"
              ? await deleteUser(admin, id, String(body.confirmEmail ?? ""))
              : { error: "invalid_input" as const };
  if ("error" in result) return Response.json(result, { status: STATUS[result.error] ?? 400 });
  return Response.json(result);
}
