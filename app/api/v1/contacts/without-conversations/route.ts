/**
 * GET /api/v1/contacts/without-conversations
 *
 * Retorna apenas contatos que NÃO têm conversa ativa no Inbox (WAHA).
 * Útil para listas de disparo em massa — evita enviar mensagem para quem já está sendo atendido.
 */
import { randomUUID } from "node:crypto";
import { type NextRequest } from "next/server";

import { ApiError } from "@/lib/api/types";
import { ok, fail } from "@/lib/api/wrappers";
import { requireRole } from "@/lib/auth/require-role";
import { loadAuthUser, resolveActiveOrg } from "@/lib/auth/server";
import { contactListQuerySchema } from "@/lib/schemas";
import { createClient } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";

const SELECT_COLS =
  "id, organization_id, name, display_name, email, email_normalized, phone_number, cpf_hash, birthdate, is_blocked, blocked_reason, is_anonymized, anonymized_at, is_merged_into, merged_at, consent, tags, source, source_metadata, created_at, updated_at, last_activity_at";

export async function GET(req: NextRequest): Promise<Response> {
  const requestId = randomUUID();
  const supabase = await createClient();
  const {
    data: { user },
    error: authErr,
  } = await supabase.auth.getUser();
  if (authErr || !user) {
    return fail("unauthenticated", "Auth required.", 401, { requestId });
  }

  const url = new URL(req.url);
  const qsParsed = contactListQuerySchema.safeParse({
    search: url.searchParams.get("search") ?? undefined,
    tag: url.searchParams.get("tag") ?? undefined,
    source: url.searchParams.get("source") ?? undefined,
    cursor: url.searchParams.get("cursor") ?? undefined,
    limit: url.searchParams.get("limit") ?? undefined,
    order_by: url.searchParams.get("order_by") ?? undefined,
    order_dir: url.searchParams.get("order_dir") ?? undefined,
  });
  if (!qsParsed.success) {
    return fail("validation_failed", "Query inválida.", 422, {
      details: qsParsed.error.flatten().fieldErrors as Record<string, unknown>,
      requestId,
    });
  }

  const authUser = await loadAuthUser();
  const orgId = authUser ? (await resolveActiveOrg(authUser))?.orgId : undefined;

  // Query principal: contatos SEM conversa no inbox
  let query = supabase
    .from("contacts")
    .select(SELECT_COLS)
    .eq("organization_id", orgId ?? "")
    // EXCLUI contatos que têm conversa (qualquer status exceto closed/archived)
    .not(
      "id",
      "in",
      supabase
        .from("conversations")
        .select("contact_id")
        .eq("organization_id", orgId ?? "")
        .neq("status", "closed")
        .neq("status", "archived")
    )
    .order(qsParsed.data.order_by ?? "last_activity_at", {
      ascending: (qsParsed.data.order_dir ?? "desc") === "asc",
      nullsFirst: false,
    })
    .order("id", {
      ascending: (qsParsed.data.order_dir ?? "desc") === "asc",
    })
    .limit((qsParsed.data.limit ?? 25) + 1);

  if (qsParsed.data.search) {
    const s = qsParsed.data.search.trim().replace(/[%_]/g, (m) => `\\${m}`).replace(/[,()]/g, " ");
    const digits = qsParsed.data.search.replace(/\D/g, "");
    const orParts = [
      `name.ilike.%${s}%`,
      `display_name.ilike.%${s}%`,
      `email.ilike.%${s}%`,
      `phone_number.ilike.%${s}%`,
    ];
    if (digits.length === 11) {
      orParts.push(`cpf_hash.eq.${Buffer.from(digits).toString("base64")}`);
    }
    query = query.or(orParts.join(","));
  }
  if (qsParsed.data.tag) query = query.contains("tags", [qsParsed.data.tag]);
  if (qsParsed.data.source) query = query.eq("source", qsParsed.data.source);

  const { data, error } = await query;
  if (error) {
    throw new ApiError(500, "internal_error", undefined, requestId, error.message);
  }

  const rows = (data ?? []) as Array<{
    id: string;
    organization_id: string;
    name: string | null;
    display_name: string | null;
    email: string | null;
    phone_number: string | null;
    tags: string[];
    source: string | null;
    created_at: string;
    updated_at: string;
    last_activity_at: string | null;
    [key: string]: unknown;
  }>;

  return ok(rows, { requestId });
}