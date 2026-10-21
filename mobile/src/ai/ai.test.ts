import Ajv from 'ajv';

import { indexDocument } from '@/core/docModel';
import { buildContext } from '@/core/retrieval/context';
import { MemoryBlobStore } from '@/data/blobs';
import { ApiError, FolumeApi } from '@/services/api';
import { ieeeMl, mlCompanion } from '@/testing/fixtures';

import { AiClient } from './client';
import { buildCompareRequest, buildExplainRequest, buildQuizRequest } from './requests';

/* eslint-disable @typescript-eslint/no-require-imports */
const schema = require('../../../backend/schema/ai.schema.json');
const ajv = new Ajv({ strict: false });
ajv.addSchema(schema, 'ai');
const validator = (name: string) => {
  const v = ajv.getSchema(`ai#/$defs/${name}`);
  if (!v) throw new Error(`no schema ${name}`);
  return v;
};

const idx = indexDocument(ieeeMl);
const para = ieeeMl.blocks.find((b) => b.type === 'paragraph' && b.text.includes('We optimize the objective'))!;

describe('AI request contracts (client output validates against the published backend schema)', () => {
  it('explain requests for every task', () => {
    const passages = buildContext(idx, { blockId: para.id, text: 'soft constraint' });
    const validate = validator('ExplainRequest');
    for (const task of ['explain', 'why_matters', 'define_term', 'explain_formula', 'explain_figure', 'simplify', 'translate', 'ask'] as const) {
      const req = buildExplainRequest({ task, passages, language: 'tr', level: 'intermediate', title: 'T', abstract: 'A', question: task === 'ask' ? 'why?' : undefined, targetLanguage: 'en' });
      expect(validate(req)).toBe(true);
      expect(validate.errors).toBeNull();
      expect(req.selection_id).toBe('p1');
    }
  });

  it('only translations carry a target language, and images are mapped to the wire format', () => {
    const passages = buildContext(idx, { blockId: para.id });
    const t = buildExplainRequest({ task: 'translate', passages, language: 'tr', targetLanguage: 'en', level: 'beginner', title: 'T' });
    expect(t.target_language).toBe('en');
    const e = buildExplainRequest({
      task: 'explain_formula', passages, language: 'en', level: 'expert', title: 'T',
      images: [{ passageId: 'p1', mime: 'image/png', dataB64: 'AAAA', role: 'equation' }],
    });
    expect(e.target_language).toBeNull();
    expect(e.images).toEqual([{ passage_id: 'p1', mime: 'image/png', data_b64: 'AAAA', role: 'equation' }]);
    expect(validator('ExplainRequest')(e)).toBe(true);
  });

  it('the schema enforces the gateway limits the UI has to respect', () => {
    const validate = validator('ExplainRequest');
    const passages = buildContext(idx, { blockId: para.id });
    const ok = buildExplainRequest({ task: 'explain', passages, language: 'tr', level: 'intermediate', title: 'T' });
    expect(validate({ ...ok, passages: Array.from({ length: 15 }, (_, i) => ({ id: `p${i + 1}`, text: 'x', kind: 'context' })) })).toBe(false);
    expect(validate({ ...ok, language: 'turkish' })).toBe(false);
    expect(validate({ ...ok, task: 'hack' })).toBe(false);
    expect(validate({ ...ok, passages: [{ id: 'p1', text: 'x'.repeat(4001), kind: 'context' }] })).toBe(false);
  });

  it('quiz and compare requests validate; compare renumbers the second paper', () => {
    const passages = buildContext(idx, { blockId: para.id });
    const q = buildQuizRequest({ sectionTitle: 'Method', passages, count: 4, language: 'tr', level: 'intermediate', title: 'T' });
    expect(validator('QuizRequest')(q)).toBe(true);
    const idx2 = indexDocument(mlCompanion);
    const other = buildContext(idx2, { blockId: mlCompanion.blocks.find((b) => b.type === 'paragraph')!.id }, { maxPassages: 3 });
    const c = buildCompareRequest({ concept: 'routing', a: passages.slice(0, 3), b: other, titleA: 'A', titleB: 'B', language: 'en' });
    expect(validator('CompareRequest')(c)).toBe(true);
    const ids = [...c.a, ...c.b].map((p) => p.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it('accepts a gateway response as documented', () => {
    const ok = {
      answer: [{ text: 'x', cites: ['p1'], quote: null, grounded: true, quote_verified: null }],
      mode: 'llm', provider: 'openai-compatible', model: 'm', ungrounded_ratio: 0, needs_more_context: false, notices: [],
    };
    expect(validator('ExplainResponse')(ok)).toBe(true);
    expect(validator('ExplainResponse')({ ...ok, mode: 'magic' })).toBe(false);
  });
});

describe('AiClient', () => {
  it('posts JSON with the API key and surfaces structured errors', async () => {
    const seen: { url: string; init: RequestInit }[] = [];
    const fetchFn = (async (url: RequestInfo | URL, init?: RequestInit) => {
      seen.push({ url: String(url), init: init ?? {} });
      if (String(url).endsWith('/status')) return new Response(JSON.stringify({ enabled: false, mode: 'extractive' }), { status: 200 });
      return new Response(JSON.stringify({ error: { code: 'ai_not_available', message: 'needs a model' } }), { status: 501 });
    }) as typeof fetch;
    const client = new AiClient(new FolumeApi({ baseUrl: 'http://srv', apiKey: 'k' }, fetchFn));
    expect((await client.status()).mode).toBe('extractive');
    const passages = buildContext(idx, { blockId: para.id });
    const req = buildExplainRequest({ task: 'translate', passages, language: 'tr', targetLanguage: 'en', level: 'intermediate', title: 'T' });
    await expect(client.explain(req)).rejects.toMatchObject({ status: 501, code: 'ai_not_available' });
    await expect(client.explain(req)).rejects.toBeInstanceOf(ApiError);
    const call = seen.find((s) => s.url.endsWith('/explain'))!;
    expect(call.init.method).toBe('POST');
    expect((call.init.headers as Record<string, string>)['X-API-Key']).toBe('k');
    expect(JSON.parse(call.init.body as string).task).toBe('translate');
    void MemoryBlobStore;
  });
});
