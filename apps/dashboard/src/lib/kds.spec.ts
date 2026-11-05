import { describe, expect, it } from 'vitest';
import { nextKitchenStatus, ticketAge } from './kds';

describe('kds', () => {
  const fired = '2026-11-05T12:00:00Z';
  const at = (min: number) => Date.parse(fired) + min * 60_000;

  it('ages tickets at 8 and 15 minutes', () => {
    expect(ticketAge(fired, at(7.9))).toBe('fresh');
    expect(ticketAge(fired, at(8))).toBe('aging');
    expect(ticketAge(fired, at(15))).toBe('late');
    expect(ticketAge(fired, at(-1))).toBe('fresh');
  });

  it('advances items through the kitchen only', () => {
    expect(nextKitchenStatus('QUEUED')).toBe('COOKING');
    expect(nextKitchenStatus('COOKING')).toBe('READY');
    expect(nextKitchenStatus('READY')).toBeNull();
  });
});
