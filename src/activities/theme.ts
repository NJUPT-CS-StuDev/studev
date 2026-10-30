import type { CSSProperties } from 'react';
import tokens from '../../design/tokens.json';
// Actual shared design tokens; CSS chooses the current site theme.
export const activityTokens = Object.fromEntries((['light', 'dark'] as const).flatMap(theme =>
  Object.entries(tokens.color[theme]).map(([key, value]) => [`--activity-${theme}-${key}`, value]),
)) as CSSProperties;
