import {useCallback, useEffect, useState} from 'react';
import {createHttpClient, HiveHttpError} from '@hive-platform/http-client';
import type {HiveContext} from '@hive-platform/contracts';

/** The console is a plain administrative API client: same-origin session, CSRF, PlatformError. */
export const http = createHttpClient();
export const admin = {
  get: <T,>(path: string) => http.get<T>(`/api/admin${path}`),
  post: <T,>(path: string, body?: unknown) => http.post<T>(`/api/admin${path}`, body),
  put: <T,>(path: string, body?: unknown) => http.put<T>(`/api/admin${path}`, body),
  delete: <T,>(path: string) => http.delete<T>(`/api/admin${path}`),
};

export function errorText(error: unknown): string {
  if (error instanceof HiveHttpError) return `${error.code}: ${error.error.message}`;
  return error instanceof Error ? error.message : String(error);
}

export async function loadContext(): Promise<HiveContext | null> {
  try {
    return await http.get<HiveContext>('/api/me/context');
  } catch (error) {
    if (error instanceof HiveHttpError && error.status === 401) return null;
    throw error;
  }
}

export function useList<T>(path: string | null) {
  const [data, setData] = useState<T[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const reload = useCallback(async () => {
    if (!path) return;
    setLoading(true);
    try {
      setData(await admin.get<T[]>(path));
      setError(null);
    } catch (e) {
      setError(errorText(e));
    } finally {
      setLoading(false);
    }
  }, [path]);
  useEffect(() => { void reload(); }, [reload]);
  return {data, loading, error, reload};
}
