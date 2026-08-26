/**
 * POST /api/v1/bulk-broadcasts — Cria uma campanha de disparo em massa.
 * GET  /api/v1/bulk-broadcasts — Lista campanhas da organização.
 *
 * Role mínimo: manager (envio em lote é operação de impacto).
 * Input: { name, message_text, channel_session_id, contacts: [{phone_number}] }
 */
import { NextRequest } from "next/server";
import { randomUUID } from "node:crypto";
import { z } from "zod";

import { ok, fail } from "@/lib/api/wrappers";
import { audit } from "@/lib/audit";
import { requireRole } from "@/lib/auth/require-role";
import { createClient } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";

// ── Validação ───────────────────────────────────────────────────────────────

const contactSchema = z.object({
  phone_number: z.string().min(8).max(20),
});

const createSchema = z.object({
  name: z.string().min(1).max(200),
  message_text: z.string().min(1).max(4096),
  message_variants: z.array(z.string().min(1).max(4096)).min(1).max(20).optional(),
  channel_session_id: z.string().uuid(),
  channel_session_ids: z.array(z.string().uuid()).min(1).max(10).optional(),
  contacts: z.array(contactSchema).min(1).max(50000),
  daily_limit: z.number().int().min(10).max(5000).optional(),
  throttle_min_ms: z.number().int().min(3000).max(60000).optional(),
  throttle_max_ms: z.number().int().min(5000).max(120000).optional(),
});

// ── POST — Criar broadcast ──────────────────────────────────────────────────

export async function POST(req: NextRequest): Promise<Response> {
  const requestId = randomUUID();

  const authz = await requireRole("manager", { requestId, resource: "bulk_broadcasts" });
  if (!authz.ok) return authz.response;
  const { user, org } = authz;

  let raw: unknown;
  try {
    raw = await req.json();
  } catch {
    return fail("invalid_request", "Body inválido (JSON esperado).", 400, { requestId });
  }

  const parsed = createSchema.safeParse(raw);
  if (!parsed.success) {
    return fail("invalid_request", "Dados inválidos.", 400, {
      requestId,
      details: parsed.error.flatten(),
    });
  }

  const { name, message_text, channel_session_id, contacts, message_variants, channel_session_ids, daily_limit, throttle_min_ms, throttle_max_ms } = parsed.data;

  const supabase = await createClient();

  // Verificar que o channel_session pertence à org
  const { data: session } = await supabase
    .from("channel_sessions")
    .select("id")
    .eq("id", channel_session_id)
    .eq("organization_id", org.orgId)
    .single();

  if (!session) {
    return fail("not_found", "Canal não encontrado nesta organização.", 404, { requestId });
  }

  // Criar o broadcast
  const { data: broadcast, error: insErr } = await supabase
    .from("bulk_broadcasts")
    .insert({
      organization_id: org.orgId,
      name,
      message_text,
      message_variants: message_variants ?? [message_text],
      channel_session_id,
      channel_session_ids: channel_session_ids ?? [channel_session_id],
      total_contacts: contacts.length,
      created_by_user_id: user.id,
      daily_limit: daily_limit ?? 100,
      throttle_min_ms: throttle_min_ms ?? 8000,
      throttle_max_ms: throttle_max_ms ?? 20000,
    })
    .select("*")
    .single();

  if (insErr || !broadcast) {
    return fail("internal_error", insErr?.message ?? "Falha ao criar broadcast.", 500, { requestId });
  }

  // Inserir contatos em batch
  const contactRows = contacts.map((c) => ({
    broadcast_id: broadcast.id,
    organization_id: org.orgId,
    phone_number: c.phone_number.replace(/\D/g, ""),
  }));

  // Inserir em lotes de 500 pra não estourar
  for (let i = 0; i < contactRows.length; i += 500) {
    const batch = contactRows.slice(i, i + 500);
    const { error: batchErr } = await supabase
      .from("bulk_broadcast_contacts")
      .insert(batch);
    if (batchErr) {
      return fail("internal_error", `Falha ao inserir contatos (lote ${i}): ${batchErr.message}`, 500, { requestId });
    }
  }

  void audit({
    action: "bulk_broadcast.created",
    actorUserId: user.id,
    organizationId: org.orgId,
    resourceType: "bulk_broadcast",
    resourceId: broadcast.id,
    requestId,
    metadata: { name, total_contacts: contacts.length },
  });

  return ok(broadcast, { requestId, status: 201 });
}

// ── GET — Listar broadcasts ─────────────────────────────────────────────────

export async function GET(): Promise<Response> {
  const requestId = randomUUID();

  const authz = await requireRole("manager", { requestId, resource: "bulk_broadcasts" });
  if (!authz.ok) return authz.response;
  const { org } = authz;

  const supabase = await createClient();

  const { data: broadcasts, error } = await supabase
    .from("bulk_broadcasts")
    .select("*")
    .eq("organization_id", org.orgId)
    .order("created_at", { ascending: false })
    .limit(50);

  if (error) {
    return fail("internal_error", error.message, 500, { requestId });
  }

  return ok(broadcasts ?? [], { requestId });
}
