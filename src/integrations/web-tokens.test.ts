import { describe, expect, it } from 'vitest';
import tokens from '../../design/tokens.json';
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
  it('derives legacy aliases and all course slots from the shared palette', () => {
    expect(css).toContain('--blue: var(--brand)');
    expect(css).toContain('--color-google-blue: var(--brand)');
    for (let index = 0; index < 24; index++) {
      for (const part of ['bg', 'border', 'fg']) expect(css).toContain(`--course-tone-${index}-${part}: color-mix(`);
    }
  });
  it('regenerates aliases when the shared palette changes', () => {
    const changed = structuredClone(tokens);
    changed.color.light.brand = '#123456';
    expect(renderWebTokens(changed)).toContain('--brand: #123456');
    expect(renderWebTokens(changed)).not.toContain(`--brand: ${tokens.color.light.brand}`);
    expect(css).toContain('--motion-standard: 220ms');
    expect(css).toContain('--radius-sheet: 24px');
  });
});
