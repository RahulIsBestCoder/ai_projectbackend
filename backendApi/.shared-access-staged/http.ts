import axios, { AxiosError } from 'axios';
import { API_BASE_URL } from './env';

export const http = axios.create({
  baseURL: API_BASE_URL,
  headers: { 'Content-Type': 'application/json' },
});

export class ApiError extends Error {
  constructor(
    public msg: string,
    public dataset?: unknown,
    public status?: number,
  ) {
    super(msg);
    this.name = 'ApiError';
  }
}

const KEY = { access: 'aipi_access', refresh: 'aipi_refresh' };

export const getAccess = (): string | null => {
  if (typeof window === 'undefined') return null;
  return localStorage.getItem(KEY.access);
};

export const getRefresh = (): string | null => {
  if (typeof window === 'undefined') return null;
  return localStorage.getItem(KEY.refresh);
};

export const storeTokens = (accessToken: string, refreshToken: string) => {
  if (typeof window === 'undefined') return;
  localStorage.setItem(KEY.access, accessToken);
  localStorage.setItem(KEY.refresh, refreshToken);
};

export const clearAuth = () => {
  if (typeof window === 'undefined') return;
  localStorage.removeItem(KEY.access);
  localStorage.removeItem(KEY.refresh);
};

let refreshingPromise: Promise<void> | null = null;

async function refreshTokens() {
  const accessToken = getAccess();
  const refreshToken = getRefresh();
  if (!accessToken || !refreshToken) throw new Error('No tokens to refresh');

  const res = await axios.post(`${API_BASE_URL}/user/regenerateToken`, {
    access_token: accessToken,
    refresh_token: refreshToken,
  });

  const env = res.data?.response;
  if (env?.status?.action_status === false) {
    throw new ApiError(env.status.msg || 'Token refresh failed');
  }

  const dataset = env?.dataset || res.data;
  if (dataset?.access_token && dataset?.refresh_token) {
    storeTokens(dataset.access_token, dataset.refresh_token);
  } else {
    throw new Error('Invalid token refresh response');
  }
}

// Request Interceptor to attach Authorization Bearer token
http.interceptors.request.use((config) => {
  const token = getAccess();
  if (token) {
    config.headers.Authorization = `Bearer ${token}`;
  }
  return config;
});

// Response Interceptor to unwrap standard response envelope and handle 401 token refresh
http.interceptors.response.use(
  (res) => {
    const env = res.data?.response;
    if (!env) return res; // Non-enveloped response (e.g. binary file download)
    if (env.status?.action_status === false) {
      throw new ApiError(env.status.msg || 'Request failed', env.dataset, res.status);
    }
    res.data = env.dataset ?? res.data;
    return res;
  },
  async (err: AxiosError<any>) => {
    const config = err.config as any;
    const env = err.response?.data?.response;
    // Some routes reply with a bare { message: "..." } (no envelope) on 400
    const bareMessage =
      typeof err.response?.data?.message === 'string' ? err.response.data.message : undefined;

    // Handle token auto-refresh once on 401
    if (err.response?.status === 401 && config && !config.__retried && getRefresh()) {
      config.__retried = true;
      if (!refreshingPromise) {
        refreshingPromise = refreshTokens().finally(() => {
          refreshingPromise = null;
        });
      }

      try {
        await refreshingPromise;
        const newToken = getAccess();
        if (newToken && config.headers) {
          config.headers.Authorization = `Bearer ${newToken}`;
        }
        return http(config);
      } catch (refreshErr) {
        clearAuth();
        if (typeof window !== 'undefined') {
          window.dispatchEvent(new CustomEvent('auth:unauthorized'));
        }
        throw new ApiError('Session expired. Please log in again.');
      }
    }

    const status = err.response?.status;
    const message = env?.status?.msg || bareMessage || err.message || 'Network error';
    throw new ApiError(message, env?.dataset, status);
  }
);
