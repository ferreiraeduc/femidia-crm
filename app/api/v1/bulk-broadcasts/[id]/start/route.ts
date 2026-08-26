/**
 * POST /api/v1/bulk-broadcasts/[id]/start — Inicia o disparo de uma campanha.
 *
 * Marca status = 'running', started_at = agora.
 * O cron broadcast-dispatcher se encarrega de enviar em lotes respeitando o throttle.
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

  // Buscar o broadcast
  const { data: broadcast } = await supabase
    .from("bulk_broadcasts")
    .select("id, status, total_contacts")
    .eq("id", id)
    .eq("organization_id", org.orgId)
    .single();

  if (!broadcast) {
    return fail("not_found", "Campanha não encontrada.", 404, { requestId });
  }

  if (broadcast.status === "running") {
    return fail("conflict", "A campanha já está em execução.", 409, { requestId });
  }

  if (broadcast.status === "completed") {
    return fail("conflict", "A campanha já foi concluída.", 409, { requestId });
  }

  // Marcar como running
  const { data: updated, error } = await supabase
    .from("bulk_broadcasts")
    .update({ status: "running", started_at: new Date().toISOString() })
    .eq("id", id)
    .eq("organization_id", org.orgId)
    .select("*")
    .single();

  if (error || !updated) {
    return fail("internal_error", error?.message ?? "Falha ao iniciar campanha.", 500, { requestId });
  }

  void audit({
    action: "bulk_broadcast.started",
    actorUserId: user.id,
    organizationId: org.orgId,
    resourceType: "bulk_broadcast",
    resourceId: id,
    requestId,
    metadata: { total_contacts: broadcast.total_contacts },
  });

  return ok(updated, { requestId });
}
