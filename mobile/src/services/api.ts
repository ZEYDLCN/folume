import type { Document } from '@/core/types';

export interface ApiConfig {
  baseUrl: string;
  apiKey?: string | null;
}

export interface JobStatus {
  id: string;
  status: 'queued' | 'processing' | 'done' | 'failed';
  stage: string;
  progress: number;
  error: { code: string; message: string } | null;
  expires_at: number;
}

export interface Capabilities {
  version: string;
  parser: { name: string; scanned_pdf_ocr: boolean };
  limits: { max_upload_mb: number; max_pages: number };
  retention_seconds: number;
  uploads_persisted: boolean;
  ai: { enabled: boolean; vision: boolean };
  sync: { enabled: boolean };
}

export class ApiError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message: string,
  ) {
    super(message);
    this.name = 'ApiError';
  }
}

type FetchFn = typeof fetch;

export class FolumeApi {
  constructor(
    private readonly config: ApiConfig,
    private readonly fetchFn: FetchFn = (...args) => fetch(...args),
  ) {}

  get baseUrl(): string {
    return this.config.baseUrl.replace(/\/+$/, '');
  }

  private headers(extra?: Record<string, string>): Record<string, string> {
    return { ...(this.config.apiKey ? { 'X-API-Key': this.config.apiKey } : {}), ...extra };
  }

  async request(path: string, init: RequestInit = {}): Promise<Response> {
    let res: Response;
    try {
      res = await this.fetchFn(`${this.baseUrl}${path}`, {
        ...init,
        headers: this.headers(init.headers as Record<string, string> | undefined),
      });
    } catch {
      throw new ApiError(0, 'network', 'The server could not be reached');
    }
    if (!res.ok) {
      let code = 'error';
      let message = `Request failed (${res.status})`;
      try {
        const body = await res.json();
        code = body?.error?.code ?? code;
        message = body?.error?.message ?? message;
      } catch {
        /* non-JSON error body */
      }
      throw new ApiError(res.status, code, message);
    }
    return res;
  }

  async json<T>(path: string, init?: RequestInit): Promise<T> {
    return (await this.request(path, init)).json() as Promise<T>;
  }

  health(): Promise<{ status: string; version: string }> {
    return this.json('/v1/health');
  }

  capabilities(): Promise<Capabilities> {
    return this.json('/v1/capabilities');
  }

  upload(form: FormData): Promise<JobStatus> {
    return this.json('/v1/documents', { method: 'POST', body: form });
  }

  job(id: string): Promise<JobStatus> {
    return this.json(`/v1/jobs/${id}`);
  }

  document(id: string): Promise<Document> {
    return this.json(`/v1/jobs/${id}/document`);
  }

  async asset(id: string, path: string): Promise<Uint8Array> {
    const res = await this.request(`/v1/jobs/${id}/assets/${path}`);
    return new Uint8Array(await res.arrayBuffer());
  }

  async deleteJob(id: string): Promise<void> {
    await this.request(`/v1/jobs/${id}`, { method: 'DELETE' });
  }
}
