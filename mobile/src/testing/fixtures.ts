import type { Document } from '@/core/types';

/* eslint-disable @typescript-eslint/no-require-imports */
export const ieeeMl = require('../__fixtures__/ieee_ml.document.json') as Document;
export const acmGraph = require('../__fixtures__/acm_graph.document.json') as Document;
export const mlCompanion = require('../__fixtures__/ml_companion.document.json') as Document;

export function clone<T>(v: T): T {
  return JSON.parse(JSON.stringify(v)) as T;
}
