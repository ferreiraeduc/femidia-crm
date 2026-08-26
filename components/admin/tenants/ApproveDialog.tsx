"use client";
import { useState } from "react";
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
import { useApproveTenant } from "@/hooks/useApproveTenant";

// ---------------------------------------------------------------------------
// Props
// ---------------------------------------------------------------------------

interface ApproveDialogProps {
  open: boolean;
  onClose: () => void;
  organizationId: string;
  displayName: string;
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export function ApproveDialog({ open, onClose, organizationId, displayName }: ApproveDialogProps) {
  const approve = useApproveTenant();

  function handleConfirm() {
    approve.mutate(
      { id: organizationId },
      {
        onSuccess: () => {
          onClose();
        },
      },
    );
  }

  return (
    <AlertDialog open={open} onOpenChange={(open) => { if (!open) onClose(); }}>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>Aprovar tenant</AlertDialogTitle>
          <AlertDialogDescription>
            Confirma a aprovação de <strong>{displayName}</strong>? O tenant terá
            acesso completo à plataforma imediatamente.
          </AlertDialogDescription>
        </AlertDialogHeader>

        <AlertDialogFooter>
          <AlertDialogCancel onClick={onClose}>Cancelar</AlertDialogCancel>
          <Button
            variant="default"
            onClick={handleConfirm}
            disabled={approve.isPending}
          >
            {approve.isPending ? "Aprovando..." : "✓ Aprovar"}
          </Button>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
