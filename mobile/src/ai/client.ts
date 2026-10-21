import type { FolumeApi } from '@/services/api';

import type {
  AiStatus,
  CompareRequest,
  CompareResponse,
  ExplainRequest,
  ExplainResponse,
  QuizRequest,
  QuizResponse,
} from './requests';

const post = (body: unknown): RequestInit => ({
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify(body),
});

/** Thin typed wrapper over the gateway; the caller decides what to send (see the preview step in the UI). */
export class AiClient {
  constructor(private readonly api: FolumeApi) {}

  status(): Promise<AiStatus> {
    return this.api.json('/v1/ai/status');
  }

  explain(req: ExplainRequest): Promise<ExplainResponse> {
    return this.api.json('/v1/ai/explain', post(req));
  }

  quiz(req: QuizRequest): Promise<QuizResponse> {
    return this.api.json('/v1/ai/quiz', post(req));
  }

  compare(req: CompareRequest): Promise<CompareResponse> {
    return this.api.json('/v1/ai/compare', post(req));
  }
}
