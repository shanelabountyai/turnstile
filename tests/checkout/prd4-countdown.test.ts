// PRD-4 (first impression and screen polish): display helpers for the Turnstile screens. Words and display only;
// nothing here decides anything, and the engine is not changed (src/inventory/ is only read by these tests).
import { describe, expect, it } from 'vitest';
import { countdownWords } from '@/components/countdown-words';

describe('item 16: the countdown speaks the hold id once, not "time left on" twice', () => {
  it('two minutes, zero, and nothing in between', () => {
    expect(countdownWords(120, 600, 'H-2AF305D1')).toBe('Two minutes or less left on H-2AF305D1.');
    expect(countdownWords(0, 600, 'H-2AF305D1')).toBe('Time is up on H-2AF305D1.');
    expect(countdownWords(121, 600, 'H-2AF305D1')).toBe('');
    expect(countdownWords(90, 100, 'H-2AF305D1')).toBe(''); // loaded with two minutes or less: no warning (D-39, unchanged)
    expect(countdownWords(120, 600, 'H-2AF305D1')).not.toMatch(/time left on/);
  });
});

