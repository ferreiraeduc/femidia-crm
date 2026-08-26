"use client";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { apiClient } from "@/lib/api/client";

export interface ApproveTenantPayload {
  id: string;
}

export function useApproveTenant() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: ({ id }: ApproveTenantPayload) =>
      apiClient.post(`/api/v1/admin/tenants/${id}/approve`, {}),
    onSuccess: (_data, variables) => {
      void queryClient.invalidateQueries({ queryKey: ["admin", "tenant", variables.id] });
      void queryClient.invalidateQueries({ queryKey: ["admin", "tenants"] });
      toast.success("Tenant aprovado com sucesso");
    },
    onError: (err: Error) => {
      toast.error("Erro ao aprovar tenant", { description: err.message });
    },
  });
}
