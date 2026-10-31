import { describe, expect, it } from 'vitest';
import { sheetHeight, snapSheet } from './sheetState';

describe('map sheet state', () => {
  it('keeps the three snap heights inside the viewport', () => {
    expect(sheetHeight('collapsed', 844)).toBeLessThan(sheetHeight('half', 844));
    expect(sheetHeight('half', 844)).toBeLessThan(sheetHeight('full', 844));
    expect(sheetHeight('full', 844, 34)).toBeLessThanOrEqual(798);
  });

  it('keeps ordered anchors on compact viewports too', () => {
    expect(sheetHeight('collapsed', 320)).toBeLessThan(sheetHeight('half', 320));
    expect(sheetHeight('half', 320)).toBeLessThan(sheetHeight('full', 320));
    expect(sheetHeight('full', 320)).toBeLessThanOrEqual(320);
  });

  it('uses release direction and velocity while clamping at the ends', () => {
    expect(snapSheet('half', -140, 0)).toBe('full');
    expect(snapSheet('half', 140, 0)).toBe('collapsed');
    expect(snapSheet('half', 0, -900)).toBe('full');
    expect(snapSheet('half', 0, 900)).toBe('collapsed');
    expect(snapSheet('collapsed', 140, 900)).toBe('collapsed');
    expect(snapSheet('full', -140, -900)).toBe('full');
  });
});

