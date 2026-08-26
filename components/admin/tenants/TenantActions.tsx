"use client";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import { SuspendDialog } from "./SuspendDialog";
import { ReactivateDialog } from "./ReactivateDialog";
import { ApproveDialog } from "./ApproveDialog";
import { RejectDialog } from "./RejectDialog";
import { ImpersonateButton } from "@/components/admin/ImpersonateButton";

// ---------------------------------------------------------------------------
// Props
// ---------------------------------------------------------------------------

interface TenantActionsProps {
  organizationId: string;
  status: "active" | "suspended" | "redacted" | "pending" | "rejected";
  displayName: string;
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export function TenantActions({
  organizationId,
  status,
  displayName,
}: TenantActionsProps) {
  const [suspendOpen, setSuspendOpen] = useState(false);
  const [reactivateOpen, setReactivateOpen] = useState(false);
  const [approveOpen, setApproveOpen] = useState(false);
  const [rejectOpen, setRejectOpen] = useState(false);

  const canSuspend = status === "active";
  const isSuspended = status === "suspended";
  const isPending = status === "pending";
  const isRejected = status === "rejected";
  const isRedacted = status === "redacted";

  return (
    <>
      <div className="rounded-lg border bg-card p-5 space-y-4">
        <h2 className="text-sm font-semibold text-muted-foreground uppercase tracking-wider">
          Ações
        </h2>

        {/* Pending: Approve / Reject */}
        {isPending && (
          <>
            <Button
              className="w-full"
              variant="default"
              onClick={() => setApproveOpen(true)}
              aria-label="Aprovar tenant"
            >
              ✓ Aprovar tenant
            </Button>
            <Button
              className="w-full"
              variant="destructive"
              onClick={() => setRejectOpen(true)}
              aria-label="Rejeitar tenant"
            >
              Rejeitar
            </Button>
          </>
        )}

        {/* Rejected: Allow re-approval */}
        {isRejected && (
          <Button
            className="w-full"
            variant="default"
            onClick={() => setApproveOpen(true)}
            aria-label="Aprovar tenant rejeitado"
          >
            ✓ Aprovar (reverter rejeição)
          </Button>
        )}

        {/* Impersonate (S-11.07) */}
        <ImpersonateButton
          organizationId={organizationId}
          displayName={displayName}
          disabled={isRedacted || isPending || isRejected}
          disabledReason={
            isRedacted
              ? "Tenant redigido — ação não disponível"
              : isPending
                ? "Tenant pendente — aprove antes de impersonar"
                : isRejected
                  ? "Tenant rejeitado"
                  : undefined
          }
        />

        {/* Suspend */}
        {canSuspend && (
          <Button
            className="w-full"
            variant="destructive"
            onClick={() => setSuspendOpen(true)}
            aria-label="Suspender tenant"
          >
            Suspender tenant
          </Button>
        )}

        {/* Reactivate */}
        {isSuspended && (
          <Button
            className="w-full"
            variant="outline"
            onClick={() => setReactivateOpen(true)}
            aria-label="Reativar tenant"
          >
            Reativar tenant
          </Button>
        )}

        {isRedacted && (
          <p className="text-xs text-muted-foreground text-center py-2">
            Tenant redigido — ações de gestão não disponíveis.
          </p>
        )}
      </div>

      <SuspendDialog
        open={suspendOpen}
        onClose={() => setSuspendOpen(false)}
        organizationId={organizationId}
      />

      <ReactivateDialog
        open={reactivateOpen}
        onClose={() => setReactivateOpen(false)}
        organizationId={organizationId}
      />

      <ApproveDialog
        open={approveOpen}
        onClose={() => setApproveOpen(false)}
        organizationId={organizationId}
        displayName={displayName}
      />

      <RejectDialog
        open={rejectOpen}
        onClose={() => setRejectOpen(false)}
        organizationId={organizationId}
        displayName={displayName}
      />
    </>
  );
}
