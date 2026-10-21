import { useQuery } from "@tanstack/react-query";
import { api, ApiError, client } from "./api.ts";

export const meKey = ["me"] as const;

/** Текущий пользователь или `null`, если сессии нет. */
export function useMe() {
  return useQuery({
    queryKey: meKey,
    queryFn: async () => {
      try {
        return (await api(client.api.auth.me.$get())).user;
      } catch (error) {
        if (error instanceof ApiError && error.status === 401) return null;
        throw error;
      }
    },
    staleTime: Infinity,
  });
}

export const homeFor = (role: "organizer" | "support") => (role === "support" ? "/support" : "/organizer");
