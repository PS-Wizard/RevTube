/**
 * Deprecated: MUI Theme removed in favor of shadcn and Tailwind CSS.
 */
import { RT_SHELL_CONTENT_MAX_WIDTH_PX } from './rtPalette';

export const appLayout = {
  pageMaxWidth: RT_SHELL_CONTENT_MAX_WIDTH_PX,
  pagePaddingX: { xs: 2, sm: 3, md: 4 },
  sectionGap: { xs: 2, md: 3 },
} as const;

export const getMuiTheme = () => null;
