import { useQuery } from '@tanstack/react-query';
import type { MeResponse } from '@contentflow/shared';
import { api, ApiRequestError, type ServerConfig } from './api';

export function useMe() {
  return useQuery({
    queryKey: ['me'],
    retry: false,
    queryFn: async (): Promise<MeResponse | null> => {
      try {
        return await api<MeResponse>('/api/auth/me');
      } catch (e) {
        if (e instanceof ApiRequestError && e.status === 401) return null;
        throw e;
      }
    },
  });
}

export const useServerConfig = () =>
  useQuery({ queryKey: ['config'], queryFn: () => api<ServerConfig>('/api/config'), retry: 1 });
