import { describe, it, expect } from 'vitest';
import {
  greetingCategory,
  isGreeting,
  pickGreetingReply,
} from '../netlify/functions/utils/greetings.js';

describe('greetingCategory', () => {
  it('classifies greetings', () => {
    expect(greetingCategory('hola')).toBe('greeting');
    expect(greetingCategory('Hola!')).toBe('greeting');
    expect(greetingCategory('buenas tardes')).toBe('greeting');
    expect(greetingCategory('buenos días')).toBe('greeting');
  });

  it('classifies thanks', () => {
    expect(greetingCategory('gracias')).toBe('thanks');
    expect(greetingCategory('muchas gracias')).toBe('thanks');
  });

  it('classifies farewell', () => {
    expect(greetingCategory('chau')).toBe('farewell');
    expect(greetingCategory('Chau')).toBe('farewell');
  });

  it('returns null for non-greetings', () => {
    expect(greetingCategory('xyz')).toBeNull();
    expect(greetingCategory('cuántos eventos este mes')).toBeNull();
    expect(greetingCategory('')).toBeNull();
  });
});

describe('isGreeting', () => {
  it('is true for standalone greetings', () => {
    expect(isGreeting('hola')).toBe(true);
    expect(isGreeting('Hola!')).toBe(true);
    expect(isGreeting('buenas tardes')).toBe(true);
    expect(isGreeting('gracias')).toBe(true);
    expect(isGreeting('Chau')).toBe(true);
  });

  it('is false for queries, empty, and long sentences containing a greeting token', () => {
    expect(isGreeting('cuántos eventos este mes')).toBe(false);
    expect(isGreeting('')).toBe(false);
    // >30 chars, starts with a greeting token → must NOT intercept the command.
    expect(isGreeting('hola agregá el evento amcham hoy de 6 a 19')).toBe(false);
  });

  it('respects the <30-char boundary', () => {
    // 29-char string that normalizes to a known greeting → true.
    const s = 'buenas'.padEnd(29, ' ').slice(0, 29); // "buenas" + spaces, length 29
    expect(s.length).toBe(29);
    expect(isGreeting(s)).toBe(true);
  });
});

describe('pickGreetingReply', () => {
  const rng0 = () => 0; // always first element of the pool

  it('returns a greeting-pool member for a greeting', () => {
    const reply = pickGreetingReply('hola', rng0);
    expect(typeof reply).toBe('string');
    expect(reply.length).toBeGreaterThan(0);
    // plain text, no HTML/Markdown markers
    expect(reply).not.toMatch(/[<>*_`]/);
  });

  it('returns a distinct acknowledgement for thanks', () => {
    const reply = pickGreetingReply('gracias', rng0);
    expect(typeof reply).toBe('string');
    expect(reply.length).toBeGreaterThan(0);
    expect(reply).not.toMatch(/[<>*_`]/);
  });

  it('returns a farewell for farewell', () => {
    const reply = pickGreetingReply('chau', rng0);
    expect(typeof reply).toBe('string');
    expect(reply.length).toBeGreaterThan(0);
  });
});
