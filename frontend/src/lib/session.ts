import { useQuery, useQueryClient } from "@tanstack/react-query";
import { apiGet, apiPost } from "@/lib/api";
import type { User } from "@/lib/types";

export const meKey = ["auth", "me"] as const;

export function useMe() {
  return useQuery({
    queryKey: meKey,
    queryFn: () => apiGet<User | null>("/auth/me"),
    retry: false,
    staleTime: 10_000,
  });
}

export function useSession() {
  const qc = useQueryClient();
  return {
    beginSession: async (user: User) => {
      qc.setQueryData(meKey, user);
      await qc.invalidateQueries();
    },
    endSession: async () => {
      await apiPost("/auth/logout");
      qc.clear();
      qc.setQueryData(meKey, null);
    },
  };
}
