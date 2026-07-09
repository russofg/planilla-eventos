import { describe, it, expect, vi } from 'vitest';
import { requiredNumbers, phraseQueryResult } from '../netlify/functions/utils/phrasing.js';

const scalarMoney = { kind: 'scalar', unit: 'money', value: 1234567, metric: 'totalFinal', period: { type: 'month', year: 2024, month: 7 } };
const scalarCount = { kind: 'scalar', unit: 'count', value: 11, metric: 'countEventos', period: { type: 'month', year: 2024, month: 7 } };
const scalarHours = { kind: 'scalar', unit: 'hours', value: 12, metric: 'horasExtra', period: { type: 'month', year: 2024, month: 7 } };
const compareResult = {
  kind: 'compare',
  unit: 'money',
  metric: 'totalEventos',
  results: [
    { value: 80000, label: 'junio' },
    { value: 110000, label: 'julio' },
  ],
  delta: 30000,
  period: { type: 'compare' },
};
const listResult = { kind: 'list', metric: 'listEventosConOperacion', items: ['AMCHAM', 'Cámara'], period: { type: 'month', year: 2024, month: 7 } };

describe('requiredNumbers', () => {
  it('scalar money → formatted money token', () => {
    expect(requiredNumbers(scalarMoney)).toEqual(['$ 1.234.567']);
  });
  it('scalar count → integer string', () => {
    expect(requiredNumbers(scalarCount)).toEqual(['11']);
  });
  it('scalar hours → "N h" token', () => {
    expect(requiredNumbers(scalarHours)).toEqual(['12 h']);
  });
  it('compare → both endpoint formatted values', () => {
    expect(requiredNumbers(compareResult)).toEqual(['$ 80.000', '$ 110.000']);
  });
  it('list → null (phrasing skipped)', () => {
    expect(requiredNumbers(listResult)).toBeNull();
  });
});

describe('phraseQueryResult', () => {
  const fallback = () => 'FALLBACK_TEMPLATE';

  it('returns LLM text when it contains all required numbers', async () => {
    const chat = vi.fn().mockResolvedValue('Este mes tuviste 11 eventos, todo bien.');
    const out = await phraseQueryResult(scalarCount, fallback, { chat });
    expect(out).toBe('Este mes tuviste 11 eventos, todo bien.');
    expect(chat).toHaveBeenCalledOnce();
  });

  it('falls back when the LLM drops a required number', async () => {
    const chat = vi.fn().mockResolvedValue('Tuviste varios eventos este mes.');
    const out = await phraseQueryResult(scalarCount, fallback, { chat });
    expect(out).toBe('FALLBACK_TEMPLATE');
  });

  it('falls back when the LLM throws', async () => {
    const chat = vi.fn().mockRejectedValue(new Error('network'));
    const out = await phraseQueryResult(scalarCount, fallback, { chat });
    expect(out).toBe('FALLBACK_TEMPLATE');
  });

  it('falls back when the LLM returns empty text', async () => {
    const chat = vi.fn().mockResolvedValue('   ');
    const out = await phraseQueryResult(scalarCount, fallback, { chat });
    expect(out).toBe('FALLBACK_TEMPLATE');
  });

  it('validates both values for compare results', async () => {
    const chat = vi.fn().mockResolvedValue('Pasaste de $ 80.000 a $ 110.000, subiste.');
    const out = await phraseQueryResult(compareResult, fallback, { chat });
    expect(out).toBe('Pasaste de $ 80.000 a $ 110.000, subiste.');
  });

  it('falls back when compare misses one value', async () => {
    const chat = vi.fn().mockResolvedValue('Subiste bastante, de $ 80.000 en adelante.');
    const out = await phraseQueryResult(compareResult, fallback, { chat });
    expect(out).toBe('FALLBACK_TEMPLATE');
  });

  it('skips the LLM for list results and returns fallback', async () => {
    const chat = vi.fn();
    const out = await phraseQueryResult(listResult, fallback, { chat });
    expect(out).toBe('FALLBACK_TEMPLATE');
    expect(chat).not.toHaveBeenCalled();
  });
});
