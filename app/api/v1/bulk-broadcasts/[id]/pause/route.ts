/**
 * POST /api/v1/bulk-broadcasts/[id]/pause — Pausa uma campanha em execução.
 * POST /api/v1/bulk-broadcasts/[id]/resume — Retoma uma campanha pausada.
 *
 * Role mínimo: manager.
 */
import { NextRequest } from "next/server";
import { randomUUID } from "node:crypto";

import { ok, fail } from "@/lib/api/wrappers";
import { audit } from "@/lib/audit";
import { requireRole } from "@/lib/auth/require-role";
import { createClient } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";

export async function POST(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
): Promise<Response> {
  const requestId = randomUUID();
  const { id } = await params;

  const authz = await requireRole("manager", { requestId, resource: "bulk_broadcasts" });
  if (!authz.ok) return authz.response;
  const { user, org } = authz;

  const supabase = await createClient();

  const { data: broadcast } = await supabase
    .from("bulk_broadcasts")
    .select("id, status")
    .eq("id", id)
    .eq("organization_id", org.orgId)
    .single();

  if (!broadcast) {
    return fail("not_found", "Campanha não encontrada.", 404, { requestId });
  }

  if (broadcast.status !== "running") {
    return fail("conflict", "Só é possível pausar campanhas em execução.", 409, { requestId });
  }

  const { error } = await supabase
    .from("bulk_broadcasts")
    .update({ status: "paused" })
    .eq("id", id)
    .eq("organization_id", org.orgId);

  if (error) {
    return fail("internal_error", error.message, 500, { requestId });
  }

  void audit({
    action: "bulk_broadcast.paused",
    actorUserId: user.id,
    organizationId: org.orgId,
    resourceType: "bulk_broadcast",
    resourceId: id,
    requestId,
  });

  return ok({ status: "paused" }, { requestId });
}
