/**
 * StatCardsCustomizer — show/hide, reorder and detail-toggle the stat cards of
 * the active dashboard tab.
 *
 * One trigger + panel for every customizable surface: the card list, its
 * default order and the panel title all come from `config/statCardRegistry.ts`,
 * and the layout is persisted through `stores/cardLayoutStore.ts` (localStorage
 * mirror + debounced backend save).
 *
 * Layout/styling: composed from shared primitives (`Flex` / `Stack` /
 * `Typography` / `Button` / `IconButton` / `Toggle` / shadcn `Popover`) plus the
 * existing `.rt-dropdown-trigger` token class — no Tailwind utilities, no new
 * CSS file (ui-boundary + design rules).
 */

import React from 'react';
import { ChevronDown, ChevronUp, RotateCcw, Rows3, Settings2 } from 'lucide-react';
import {
  Button,
  Flex,
  IconButton,
  PopoverContent,
  PopoverTrigger,
  ShadcnPopover,
  Stack,
  Toggle,
  Typography,
} from '../ui';
import {
  getStatCardDefinitions,
  isStatCardSurface,
  STAT_CARD_SURFACE_LABELS,
  type StatCardSurface,
} from '../../config/statCardRegistry';
import { hasDetails, isSurfaceCustomized, normalizeLayout } from '../../utils/cardLayout';
import { useCardLayoutStore } from '../../stores/cardLayoutStore';

export interface StatCardsCustomizerProps {
  surface: StatCardSurface;
}

export const StatCardsCustomizer: React.FC<StatCardsCustomizerProps> = ({ surface }) => {
  const [open, setOpen] = React.useState(false);
  const layout = useCardLayoutStore((state) => state.layouts[surface]);
  const toggleHidden = useCardLayoutStore((state) => state.setCardHidden);
  const toggleCompact = useCardLayoutStore((state) => state.setCardCompact);
  const moveCard = useCardLayoutStore((state) => state.moveCard);
  const resetSurface = useCardLayoutStore((state) => state.resetSurface);

  if (!isStatCardSurface(surface)) return null;

  const definitions = getStatCardDefinitions(surface);
  const normalized = normalizeLayout(surface, layout);
  const visibleCount = normalized.order.filter((id) => !normalized.hidden.includes(id)).length;
  const lastIndex = normalized.order.length - 1;
  const surfaceLabel = STAT_CARD_SURFACE_LABELS[surface];
  const customized = isSurfaceCustomized(surface, layout);

  return (
    <ShadcnPopover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <IconButton
          size="sm"
          variant="ghost"
          title={`Show, hide and reorder ${surfaceLabel} cards`}
          aria-label={`Customize ${surfaceLabel} cards`}
        >
          <Settings2 size={16} />
        </IconButton>
      </PopoverTrigger>

      <PopoverContent align="end" style={{ width: 'min(22rem, calc(100vw - 2rem))' }}>
        <Stack gap={1}>
          <Flex gap={1} alignItems="center" justifyContent="space-between">
            <Typography variant="subtitle2" component="span">
              {`Customize ${surfaceLabel} cards`}
            </Typography>
            <Button
              variant="ghost"
              size="sm"
              disabled={!customized}
              onClick={() => resetSurface(surface)}
              title={`Reset ${surfaceLabel} cards to defaults`}
              aria-label={`Reset ${surfaceLabel} cards to defaults`}
            >
              <RotateCcw size={12} />
              <span>Reset</span>
            </Button>
          </Flex>

          <Typography variant="caption" component="span">
            {`${visibleCount} of ${definitions.length} shown · arrows change position · the row icon hides details`}
          </Typography>

          <Stack gap={0} sx={{ maxHeight: 'min(55vh, 22rem)', overflowY: 'auto' }}>
            {normalized.order.map((id, index) => {
              const label = definitions.find((d) => d.id === id)?.label ?? id;
              const visible = !normalized.hidden.includes(id);
              const detailsOn = hasDetails(surface, normalized, id);
              const isLastVisible = visible && visibleCount <= 1;

              return (
                <Flex
                  key={id}
                  gap={0.5}
                  alignItems="center"
                  role="group"
                  aria-label={label}
                  sx={{ minWidth: 0, padding: '4px 0' }}
                >
                  <Typography
                    variant="caption"
                    component="span"
                    sx={{ width: 18, textAlign: 'right', opacity: visible ? 1 : 0.45 }}
                  >
                    {index + 1}
                  </Typography>

                  <Typography
                    variant="body2"
                    component="span"
                    noWrap
                    title={label}
                    sx={{ flex: 1, minWidth: 0, opacity: visible ? 1 : 0.45 }}
                  >
                    {label}
                  </Typography>

                  <IconButton
                    size="xs"
                    variant="ghost"
                    disabled={index === 0}
                    onClick={() => moveCard(surface, id, -1)}
                    aria-label={`Move ${label} up`}
                    title={`Move ${label} up`}
                  >
                    <ChevronUp size={12} />
                  </IconButton>

                  <IconButton
                    size="xs"
                    variant="ghost"
                    disabled={index === lastIndex}
                    onClick={() => moveCard(surface, id, 1)}
                    aria-label={`Move ${label} down`}
                    title={`Move ${label} down`}
                  >
                    <ChevronDown size={12} />
                  </IconButton>

                  <IconButton
                    size="xs"
                    variant={detailsOn ? 'subtle' : 'ghost'}
                    disabled={!visible}
                    aria-pressed={detailsOn}
                    onClick={() => toggleCompact(surface, id, detailsOn)}
                    aria-label={`${detailsOn ? 'Hide' : 'Show'} details on ${label}`}
                    title={`${detailsOn ? 'Hide' : 'Show'} details on ${label}`}
                  >
                    <Rows3 size={12} />
                  </IconButton>

                  <Toggle
                    checked={visible}
                    disabled={isLastVisible}
                    onChange={(checked) => toggleHidden(surface, id, !checked)}
                    ariaLabel={`Show ${label} card`}
                  />
                </Flex>
              );
            })}
          </Stack>

          <Typography variant="caption" component="span">
            {'At least one card always stays visible. Your layout follows you to other devices.'}
          </Typography>
        </Stack>
      </PopoverContent>
    </ShadcnPopover>
  );
};

export default StatCardsCustomizer;
