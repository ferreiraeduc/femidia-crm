/**
 * POST /api/v1/admin/tenants/[id]/reject
 *
 * Rejects a pending tenant. Requires platform admin.
 * Sets status='rejected', rejected_at=now(), rejection_reason.
 * 404 if tenant not found; 409 if not in 'pending' status.
 * Emits audit + event_log domain event.
 */
import { type NextRequest } from "next/server";
import { randomUUID } from "node:crypto";
import { z } from "zod";

import { requirePlatformAdmin } from "@/lib/auth/requirePlatformAdmin";
import { createAdminClient } from "@/lib/supabase/admin";
import { ok, fail } from "@/lib/api/wrappers";
import { audit } from "@/lib/audit";

const bodySchema = z.object({
  reason: z
    .string()
    .min(5, "Motivo deve ter ao menos 5 caracteres")
    .max(500, "Motivo deve ter no máximo 500 caracteres"),
});

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const requestId = randomUUID();
  const { id: tenantId } = await params;

  let adminCtx: Awaited<ReturnType<typeof requirePlatformAdmin>>;
  try {
    adminCtx = await requirePlatformAdmin();
  } catch {
    return fail("forbidden", "Platform admin required", 403, { requestId });
  }

  // Validate body
  let body: z.infer<typeof bodySchema>;
  try {
    const raw = await req.json();
    body = bodySchema.parse(raw);
  } catch {
    return fail("validation_failed", "Motivo é obrigatório (mínimo 5 caracteres)", 400, { requestId });
  }

  const admin = createAdminClient();

  // Load tenant
  const { data: org, error: orgError } = await admin
    .from("organizations")
    .select("id, slug, display_name, status")
    .eq("id", tenantId)
    .maybeSingle();

  if (orgError || !org) {
    return fail("not_found", "Tenant not found", 404, { requestId });
  }

  if (org.status !== "pending") {
    return fail(
      "state_conflict",
      `Tenant is '${org.status}', not 'pending'`,
      409,
      { requestId },
    );
  }

  // Reject
  const now = new Date().toISOString();
  const { error: updateError } = await admin
    .from("organizations")
    .update({
      status: "rejected",
      rejected_at: now,
      rejection_reason: body.reason,
      updated_at: now,
    })
    .eq("id", tenantId);

  if (updateError) {
    return fail("internal_error", "Failed to reject tenant", 500, { requestId });
  }

  // Audit
  void audit({
    action: "tenant.rejected",
    actorUserId: adminCtx.user.id,
    actingAsPlatformAdmin: true,
    bypassedRls: true,
    organizationId: tenantId,
    resourceType: "organization",
    resourceId: tenantId,
    requestId,
    metadata: {
      tenant_id: tenantId,
      tenant_slug: org.slug,
      rejected_by: adminCtx.user.id,
      reason: body.reason,
    },
  });

  // Domain event
  void admin.from("event_log").insert({
    organization_id: tenantId,
    entity_kind: "organization",
    entity_id: tenantId,
    event_type: "tenant.rejected",
    payload: {
      tenant_id: tenantId,
      rejected_by: adminCtx.user.id,
      reason: body.reason,
    },
  });

  return ok({ id: tenantId, status: "rejected", rejected_at: now }, { requestId });
}
