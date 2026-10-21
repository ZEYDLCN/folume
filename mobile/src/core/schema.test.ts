import Ajv from 'ajv';

import { acmGraph, ieeeMl, mlCompanion } from '@/testing/fixtures';

/* eslint-disable @typescript-eslint/no-require-imports */
const schema = require('../../../backend/schema/document.schema.json');

describe('document contract', () => {
  const ajv = new Ajv({ strict: false });
  const validate = ajv.compile(schema);

  it.each([
    ['ieee_ml', ieeeMl],
    ['acm_graph', acmGraph],
    ['ml_companion', mlCompanion],
  ])('backend output %s validates against the published JSON Schema', (_name, doc) => {
    const ok = validate(doc);
    expect(validate.errors ?? []).toEqual([]);
    expect(ok).toBe(true);
  });

  it('rejects documents with unknown fields', () => {
    expect(validate({ ...ieeeMl, surprise: 1 })).toBe(false);
  });
});
