"use client";
import { useState } from "react";
import { z } from "zod";
import {
  AlertDialog,
  AlertDialogContent,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogCancel,
} from "@/components/ui/alert-dialog";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { useRejectTenant } from "@/hooks/useRejectTenant";

// ---------------------------------------------------------------------------
// Schema
// ---------------------------------------------------------------------------

const reasonSchema = z.string().min(5, "Mínimo 5 caracteres").max(500, "Máximo 500 caracteres");

// ---------------------------------------------------------------------------
// Props
// ---------------------------------------------------------------------------

interface RejectDialogProps {
  open: boolean;
  onClose: () => void;
  organizationId: string;
  displayName: string;
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export function RejectDialog({ open, onClose, organizationId, displayName }: RejectDialogProps) {
  const [reason, setReason] = useState("");
  const [error, setError] = useState<string | null>(null);

  const reject = useRejectTenant();
  const validation = reasonSchema.safeParse(reason);
  const isValid = validation.success;

  function handleConfirm() {
    const parsed = reasonSchema.safeParse(reason);
    if (!parsed.success) {
      setError(parsed.error.issues[0]?.message ?? "Motivo inválido");
      return;
    }
    reject.mutate(
      { id: organizationId, reason: parsed.data },
      {
        onSuccess: () => {
          setReason("");
          setError(null);
          onClose();
        },
      },
    );
  }

  function handleClose() {
    setReason("");
    setError(null);
    onClose();
  }

  return (
    <AlertDialog open={open} onOpenChange={(open) => { if (!open) handleClose(); }}>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>Rejeitar tenant</AlertDialogTitle>
          <AlertDialogDescription>
            Confirma a rejeição de <strong>{displayName}</strong>? O usuário será
            notificado e não terá acesso à plataforma.
          </AlertDialogDescription>
        </AlertDialogHeader>

        <div className="space-y-2 py-2">
          <Label htmlFor="reject-reason">
            Motivo da rejeição{" "}
            <span className="text-muted-foreground text-xs font-normal">
              ({reason.length}/500)
            </span>
          </Label>
          <Textarea
            id="reject-reason"
            placeholder="Descreva o motivo da rejeição (mínimo 5 caracteres)..."
            value={reason}
            onChange={(e) => {
              setReason(e.target.value);
              setError(null);
            }}
            rows={3}
            maxLength={500}
            aria-describedby={error ? "reject-reason-error" : undefined}
          />
          {error && (
            <p id="reject-reason-error" className="text-xs text-destructive" role="alert">
              {error}
            </p>
          )}
        </div>

        <AlertDialogFooter>
          <AlertDialogCancel onClick={handleClose}>Cancelar</AlertDialogCancel>
          <Button
            variant="destructive"
            onClick={handleConfirm}
            disabled={!isValid || reject.isPending}
          >
            {reject.isPending ? "Rejeitando..." : "Confirmar rejeição"}
          </Button>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
