import { TABLE_STATUSES } from '@dinesense/shared';
import { describe, expect, it } from 'vitest';
import { formatDuration, initials, slaLevel, slaRemaining, STATUS_STYLE } from './floor-style';

describe('floor style', () => {
  it('styles every table status with a distinct glyph', () => {
    const glyphs = TABLE_STATUSES.map((s) => STATUS_STYLE[s].glyph);
    expect(new Set(glyphs).size).toBe(TABLE_STATUSES.length);
  });

  const seated = '2026-11-05T12:00:00Z';
  const at = (s: number) => Date.parse(seated) + s * 1000;

  it('turns amber at 3 of 5 minutes and red at 5', () => {
    expect(slaLevel('OCCUPIED', seated, null, 300, at(179))).toBe('ok');
    expect(slaLevel('OCCUPIED', seated, null, 300, at(180))).toBe('warn');
    expect(slaLevel('OCCUPIED', seated, null, 300, at(300))).toBe('breach');
  });

  it('has no SLA once greeted or for other states', () => {
    expect(slaLevel('OCCUPIED', seated, seated, 300, at(900))).toBe('none');
    expect(slaLevel('GREETED', seated, null, 300, at(900))).toBe('none');
    expect(slaLevel('VACANT', null, null, 300, at(900))).toBe('none');
  });

  it('formats countdowns', () => {
    expect(slaRemaining(seated, 300, at(225))).toBe(75);
    expect(formatDuration(75)).toBe('1:15');
    expect(formatDuration(-5)).toBe('-0:05');
    expect(formatDuration(3725)).toBe('1:02:05');
  });

  it('clamps clock skew so a fresh seating never shows negative time', () => {
    expect(slaRemaining(seated, 300, at(-2))).toBe(300);
  });

  it('builds initials', () => {
    expect(initials('Anil Sharma')).toBe('AS');
    expect(initials('  neha  ')).toBe('N');
  });
});
