"use client";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { apiClient } from "@/lib/api/client";

export interface RejectTenantPayload {
  id: string;
  reason: string;
}

export function useRejectTenant() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: ({ id, reason }: RejectTenantPayload) =>
      apiClient.post(`/api/v1/admin/tenants/${id}/reject`, { reason }),
    onSuccess: (_data, variables) => {
      void queryClient.invalidateQueries({ queryKey: ["admin", "tenant", variables.id] });
      void queryClient.invalidateQueries({ queryKey: ["admin", "tenants"] });
      toast.success("Tenant rejeitado");
    },
    onError: (err: Error) => {
      toast.error("Erro ao rejeitar tenant", { description: err.message });
    },
  });
}
