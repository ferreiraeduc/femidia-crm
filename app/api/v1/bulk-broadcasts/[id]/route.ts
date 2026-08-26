/**
 * GET    /api/v1/bulk-broadcasts/[id] — Detalhe de uma campanha + progresso.
 * DELETE /api/v1/bulk-broadcasts/[id] — Remove uma campanha (só se draft/completed).
 *
 * Role mínimo: manager.
 */
import { NextRequest } from "next/server";
import { randomUUID } from "node:crypto";

import { ok, fail, noContent } from "@/lib/api/wrappers";
import { requireRole } from "@/lib/auth/require-role";
import { createClient } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";

export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
): Promise<Response> {
  const requestId = randomUUID();
  const { id } = await params;

  const authz = await requireRole("manager", { requestId, resource: "bulk_broadcasts" });
  if (!authz.ok) return authz.response;
  const { org } = authz;

  const supabase = await createClient();

  const { data: broadcast, error } = await supabase
    .from("bulk_broadcasts")
    .select("*")
    .eq("id", id)
    .eq("organization_id", org.orgId)
    .single();

  if (error || !broadcast) {
    return fail("not_found", "Campanha não encontrada.", 404, { requestId });
  }

  return ok(broadcast, { requestId });
}

export async function DELETE(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
): Promise<Response> {
  const requestId = randomUUID();
  const { id } = await params;

  const authz = await requireRole("manager", { requestId, resource: "bulk_broadcasts" });
  if (!authz.ok) return authz.response;
  const { org } = authz;

  const supabase = await createClient();

  // Só permite deletar se não está rodando
  const { data: broadcast } = await supabase
    .from("bulk_broadcasts")
    .select("status")
    .eq("id", id)
    .eq("organization_id", org.orgId)
    .single();

  if (!broadcast) {
    return fail("not_found", "Campanha não encontrada.", 404, { requestId });
  }

  if (broadcast.status === "running") {
    return fail("conflict", "Não é possível remover uma campanha em execução. Pause primeiro.", 409, {
      requestId,
    });
  }

  const { error } = await supabase
    .from("bulk_broadcasts")
    .delete()
    .eq("id", id)
    .eq("organization_id", org.orgId);

  if (error) {
    return fail("internal_error", error.message, 500, { requestId });
  }

  return noContent(requestId);
}
