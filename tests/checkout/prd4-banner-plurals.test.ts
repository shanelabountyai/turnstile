// PRD-4 (first impression and screen polish): display helpers for the Turnstile screens. Words and display only;
// nothing here decides anything, and the engine is not changed (src/inventory/ is only read by these tests).
import { describe, expect, it } from 'vitest';
import { movedOn } from '@/checkout/buy-view';
import { counted } from '@/checkout/format';

describe('item 17: plurals', () => {
  it('one order, one line; any other count takes the plural, with the thousands comma', () => {
    expect(counted(1, 'order')).toBe('1 order');
    expect(counted(0, 'order')).toBe('0 orders');
    expect(counted(2, 'line')).toBe('2 lines');
    expect(counted(1, 'line')).toBe('1 line');
    expect(counted(1051, 'refund')).toBe('1,051 refunds');
  });
});


describe('item 17: a result banner whose hold has moved on', () => {
  const holds = [{ hold: 'H-1', state: 'CONFIRMED' }, { hold: 'H-2', state: 'PAYING' }, { hold: 'H-3', state: 'EXPIRED' }, { hold: 'H-4', state: 'HELD' }];
  it('PAY_START → PAYING is stale once the hold is CONFIRMED, current while it is still PAYING', () => {
    expect(movedOn({ kind: 'PAY_START', status: 'OK', code: 'PAYING', payload: { ref: 'H-1' } }, holds)).toBe(true);
    expect(movedOn({ kind: 'PAY_START', status: 'OK', code: 'PAYING', payload: { ref: 'H-2' } }, holds)).toBe(false);
  });
  it('HOLD → HELD is stale once the hold expired; still current while held', () => {
    expect(movedOn({ kind: 'HOLD', status: 'OK', code: 'HELD', payload: { ref: 'H-3' } }, holds)).toBe(true);
    expect(movedOn({ kind: 'HOLD', status: 'OK', code: 'HELD', payload: { ref: 'H-4' } }, holds)).toBe(false);
  });
  it('a refusal, another command, an unknown hold or a bad payload stays on screen', () => {
    expect(movedOn({ kind: 'PAY_START', status: 'REJECT', code: 'HOLD_EXPIRED', payload: { ref: 'H-3' } }, holds)).toBe(false);
    expect(movedOn({ kind: 'RELEASE', status: 'OK', code: 'RELEASED', payload: { ref: 'H-1' } }, holds)).toBe(false);
    expect(movedOn({ kind: 'PAY_START', status: 'OK', code: 'PAYING', payload: { ref: 'H-9' } }, holds)).toBe(false);
    expect(movedOn({ kind: 'PAY_START', status: 'OK', code: 'PAYING', payload: null }, holds)).toBe(false);
  });
});

