/**
 * PATCH /api/v1/bulk-broadcasts/[id] — Edita uma campanha em draft/paused.
 *
 * Permite editar: name, message_text, message_variants, daily_limit, throttle_min_ms, throttle_max_ms
 * Não permite editar contatos ou canais (criação é uma operação separada).
 *
 * Role mínimo: manager.
 */
import { NextRequest } from "next/server";
import { randomUUID } from "node:crypto";
import { z } from "zod";

import { ok, fail } from "@/lib/api/wrappers";
import { audit } from "@/lib/audit";
import { requireRole } from "@/lib/auth/require-role";
import { createClient } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";

const updateSchema = z.object({
    name: z.string().min(1).max(200).optional(),
    message_text: z.string().min(1).max(4096).optional(),
    message_variants: z.array(z.string().min(1).max(4096)).min(1).max(20).optional(),
    daily_limit: z.number().int().min(10).max(5000).optional(),
    throttle_min_ms: z.number().int().min(3000).max(60000).optional(),
    throttle_max_ms: z.number().int().min(5000).max(120000).optional(),
});

export async function PATCH(
    req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
  ): Promise<Response> {
    const requestId = randomUUID();
    const { id } = await params;

  const authz = await requireRole("manager", { requestId, resource: "bulk_broadcasts" });
    if (!authz.ok) return authz.response;
    const { user, org } = authz;

  let raw: unknown;
    try {
          raw = await req.json();
    } catch {
          return fail("invalid_request", "Body inválido (JSON esperado).", 400, { requestId });
    }

  const parsed = updateSchema.safeParse(raw);
    if (!parsed.success) {
          return fail("invalid_request", "Dados inválidos.", 400, {
                  requestId,
                  details: parsed.error.flatten(),
          });
    }

  const supabase = await createClient();

  // Verificar que campanha existe e não está rodando
  const { data: broadcast } = await supabase
      .from("bulk_broadcasts")
      .select("status, organization_id")
      .eq("id", id)
      .single();

  if (!broadcast) {
        return fail("not_found", "Campanha não encontrada.", 404, { requestId });
  }

  if (broadcast.organization_id !== org.orgId) {
        return fail("forbidden", "Acesso negado.", 403, { requestId });
  }

  if (broadcast.status === "running") {
        return fail("conflict", "Não é possível editar uma campanha em execução. Pause primeiro.", 409, {
                requestId,
        });
  }

  // Preparar dados para atualizar
  const updateData: Record<string, unknown> = {};

  if (parsed.data.name !== undefined) updateData.name = parsed.data.name;
    if (parsed.data.message_text !== undefined) updateData.message_text = parsed.data.message_text;
    if (parsed.data.message_variants !== undefined) updateData.message_variants = parsed.data.message_variants;
    if (parsed.data.daily_limit !== undefined) updateData.daily_limit = parsed.data.daily_limit;
    if (parsed.data.throttle_min_ms !== undefined) updateData.throttle_min_ms = parsed.data.throttle_min_ms;
    if (parsed.data.throttle_max_ms !== undefined) updateData.throttle_max_ms = parsed.data.throttle_max_ms;

  const { data: updated, error } = await supabase
      .from("bulk_broadcasts")
      .update(updateData)
      .eq("id", id)
      .eq("organization_id", org.orgId)
      .select("*")
      .single();

        if (error || !updated) {
              return fail("internal_error", error?.message ?? "Falha ao atualizar.", 500, { requestId });
        }

  void audit({
        action: "bulk_broadcast.updated",
        actorUserId: user.id,
        organizationId: org.orgId,
        resourceType: "bulk_broadcast",
        resourceId: id,
        requestId,
        metadata: { changed_fields: Object.keys(parsed.data).filter(k => parsed.data[k as keyof typeof parsed.data] !== undefined) },
  });

  return ok(updated, { requestId });
}
