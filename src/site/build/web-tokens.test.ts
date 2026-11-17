import { describe, expect, it } from 'vitest';
import tokens from '../../../design/tokens.json';
import { renderWebTokens } from './web-tokens.mjs';

describe('web design tokens', () => {
  const css = renderWebTokens(tokens);
  it('emits every shared palette token for both themes', () => {
    for (const palette of Object.values(tokens.color)) {
      for (const [name, value] of Object.entries(palette)) {
        const variable = name.replace(/[A-Z]/g, letter => `-${letter.toLowerCase()}`);
        expect(css).toContain(`--${variable}: ${value};`);
      }
    }
    expect(css).toContain(":root[data-theme='dark']");
  });
  it('derives aliases and all course slots from the shared palette', () => {
    expect(css).toContain('--blue: var(--brand)');
    expect(css).toContain('--color-google-blue: var(--brand)');
    for (const palette of Object.values(tokens.course)) {
      Object.values(palette).forEach((tone, index) => {
        for (const [part, value] of Object.entries(tone)) expect(css).toContain(`--course-tone-${index}-${part}: ${value};`);
      });
    }
  });
  it('regenerates aliases when the shared palette changes', () => {
    const changed = structuredClone(tokens);
    changed.color.light.brand = '#123456';
    expect(renderWebTokens(changed)).toContain('--brand: #123456');
    expect(renderWebTokens(changed)).not.toContain(`--brand: ${tokens.color.light.brand}`);
    expect(css).toContain('--motion-standard: 280ms');
    expect(css).toContain('--radius-sheet: 20px');
    expect(css).toContain('--size-search: 36px');
    expect(css).toContain('--size-control: 40px');
    expect(css).toContain('--size-target: 44px');
  });
  it('keeps the native palette without adding another set of course identities', () => {
    const slots = Object.keys(tokens.course.light).length;
    expect(css).not.toContain(`--course-tone-${slots}-bg`);
    for (const palette of Object.values(tokens.course)) expect(new Set(Object.values(palette).map(tone => tone.bg)).size).toBe(slots);
  });
});
