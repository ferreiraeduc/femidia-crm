/**
 * POST /api/v1/admin/tenants/[id]/approve
 *
 * Approves a pending tenant. Requires platform admin.
 * Sets status='active', approved_at=now(), approved_by.
 * 404 if tenant not found; 409 if not in 'pending' status.
 * Emits audit + event_log domain event.
 */
import { type NextRequest } from "next/server";
import { randomUUID } from "node:crypto";

import { requirePlatformAdmin } from "@/lib/auth/requirePlatformAdmin";
import { createAdminClient } from "@/lib/supabase/admin";
import { ok, fail } from "@/lib/api/wrappers";
import { audit } from "@/lib/audit";

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

  if (org.status !== "pending" && org.status !== "rejected") {
    return fail(
      "state_conflict",
      `Tenant is '${org.status}', must be 'pending' or 'rejected' to approve`,
      409,
      { requestId },
    );
  }

  // Approve
  const now = new Date().toISOString();
  const { error: updateError } = await admin
    .from("organizations")
    .update({
      status: "active",
      approved_at: now,
      approved_by: adminCtx.user.id,
      updated_at: now,
    })
    .eq("id", tenantId);

  if (updateError) {
    return fail("internal_error", "Failed to approve tenant", 500, { requestId });
  }

  // Audit
  void audit({
    action: "tenant.approved",
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
      approved_by: adminCtx.user.id,
    },
  });

  // Domain event
  void admin.from("event_log").insert({
    organization_id: tenantId,
    entity_kind: "organization",
    entity_id: tenantId,
    event_type: "tenant.approved",
    payload: {
      tenant_id: tenantId,
      approved_by: adminCtx.user.id,
    },
  });

  return ok({ id: tenantId, status: "active", approved_at: now }, { requestId });
}
