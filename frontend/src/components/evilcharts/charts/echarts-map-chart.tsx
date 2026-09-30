/**
 * EvilCharts world choropleth for the Audience tab (country watch share).
 *
 * Shapes load once from CDN and register under MAP_NAME; the panel keeps
 * its ranked country list underneath as the offline/error fallback, so this
 * chart never blocks the card. Follows the echarts-pie-chart file pattern
 * (thin wrapper over RtECharts, pure option builder exported for tests).
 */
import { useEffect, useState } from 'react';
import * as echarts from 'echarts/core';
import { MapChart } from 'echarts/charts';
import { GeoComponent, VisualMapComponent, TooltipComponent } from 'echarts/components';
import type { EChartsCoreOption } from 'echarts/core';
import { Minus, Plus, RotateCcw } from 'lucide-react';
import { RtECharts } from '@/components/charts/RtECharts';
import { Button } from '@/components/ui/button';
import { VisuallyHidden } from '@/components/ui';
import {
  evilTokens,
  fmtFull,
  tooltipShellStyle,
  useEvilThemeKey,
  type EvilTokens,
} from '@/components/evilcharts/ui/echarts-chart';
import { loadWorldGeoJSON, MAP_NAME, type MapDatum } from '@/components/dashboard/audienceGeo';

echarts.use([MapChart, GeoComponent, VisualMapComponent, TooltipComponent]);

const registeredMaps = new Set<string>();

export function ensureWorldMapRegistered(geo: unknown): void {
  if (registeredMaps.has(MAP_NAME)) return;
  echarts.registerMap(MAP_NAME, geo as never);
  registeredMaps.add(MAP_NAME);
}

/** Mix two #rrggbb colors; falls back to a blue pair when inputs aren't hex. */
export function mapColorScale(accent: string, card: string): [string, string] {
  const hex = /^#[0-9a-f]{6}$/i;
  if (!hex.test(accent) || !hex.test(card)) return ['#dbeafe', '#1e40af'];
  const mix = (t: number) => {
    const c = [1, 3, 5]
      .map((i) => {
        const a = parseInt(accent.slice(i, i + 2), 16);
        const b = parseInt(card.slice(i, i + 2), 16);
        return Math.round(a + (b - a) * t)
          .toString(16)
          .padStart(2, '0');
      })
      .join('');
    return `#${c}`;
  };
  return [mix(0.82), accent];
}

export interface WorldMapOptionArgs {
  items: MapDatum[];
  tokens: EvilTokens;
  maxValue: number;
  /** A2 code -> display name for tooltips. */
  nameOf: (code: string) => string;
  /** Map zoom level (1 = fit). Driven by the card's +/- controls. */
  zoom?: number;
}

/** Pure option builder (unit-tested, no DOM). */
export function buildWorldMapOption({ items, tokens, maxValue, nameOf, zoom = 1 }: WorldMapOptionArgs): EChartsCoreOption {
  const [light, strong] = mapColorScale(tokens.accent, tokens.card);
  return {
    tooltip: {
      trigger: 'item',
      backgroundColor: 'transparent',
      borderWidth: 0,
      padding: 0,
      formatter: (params: unknown) => {
        const p = params as { name?: string; value?: number | null };
        const code = String(p?.name ?? '');
        const hasValue = typeof p?.value === 'number' && Number.isFinite(p.value);
        const title = `<div style="font-weight:600;margin-bottom:2px;">${nameOf(code)}</div>`;
        const body = hasValue
          ? `<div>${fmtFull(p.value as number)} views</div>`
          : `<div style="opacity:.65;">No watch data</div>`;
        return `<div style="${tooltipShellStyle}">${title}${body}</div>`;
      },
    },
    visualMap: {
      // Hidden control: regions stay color-encoded, no slider chrome.
      show: false,
      min: 0,
      max: Math.max(maxValue, 1),
      inRange: { color: [light, strong] },
    },
    // NOTE: no `geo` block on purpose -- rendering both a geo component and
    // a map series draws every region twice (ghost map behind, visible while
    // roaming). The series below is the single renderer.
    series: [
      {
        type: 'map',
        map: MAP_NAME,
        // Pan-only: wheel zoom would hijack page scroll over the card.
        // Zoom comes from the card's +/- controls via the zoom option below.
        roam: 'move',
        zoom,
        label: { show: false },
        emphasis: { label: { show: true, color: '#fff', fontSize: 10 }, itemStyle: { areaColor: tokens.accent } },
        itemStyle: { areaColor: tokens.border, borderColor: tokens.card, borderWidth: 0.6 },
        data: items,
      },
    ],
  } as EChartsCoreOption;
}

type GeoStatus = 'loading' | 'ready' | 'error';

export interface EChartsMapChartProps {
  /** Country rows (A2 key + views). */
  rows: { key: string; views: number }[];
  nameOf: (code: string) => string;
  loading?: boolean;
  height?: number;
  emptyMessage?: string;
  title?: string;
}

export function EChartsMapChart({
  rows,
  nameOf,
  loading = false,
  height = 300,
  emptyMessage = 'No country data for this period.',
  title = 'Watch share by country',
}: EChartsMapChartProps) {
  useEvilThemeKey();
  const [status, setStatus] = useState<GeoStatus>('loading');
  const [zoom, setZoom] = useState(1);

  useEffect(() => {
    let cancelled = false;
    loadWorldGeoJSON()
      .then((geo) => {
        if (cancelled) return;
        ensureWorldMapRegistered(geo);
        setStatus('ready');
      })
      .catch(() => {
        if (!cancelled) setStatus('error');
      });
    return () => {
      cancelled = true;
    };
  }, []);

  if (status === 'error') {
    return (
      <div className="aud-map-note" role="note">
        Map shapes couldn't load (offline?) — ranked list below has the same data.
      </div>
    );
  }
  if (status !== 'ready' || loading) {
    return <div className="aud-map-loading" aria-busy="true" aria-label="Loading world map" />;
  }

  const tokens = evilTokens();
  const items: MapDatum[] = (rows || []).map((r) => ({
    name: String(r.key).toUpperCase(),
    value: Number(r.views) || 0,
  }));
  const maxValue = items.reduce((m, d) => Math.max(m, d.value), 0);
  const option = buildWorldMapOption({ items, tokens, maxValue, nameOf, zoom });
  const zoomLabel = `${Math.round(zoom * 100)}%`;

  return (
    <div className="aud-map">
      <div className="aud-map-zoom" role="group" aria-label="Map zoom controls">
        <Button
          variant="ghost"
          size="icon-xs"
          onClick={() => setZoom((z) => Math.max(1, +(z / 1.4).toFixed(2)))}
          disabled={zoom <= 1}
          title="Zoom out"
        >
          <Minus size={13} aria-hidden />
          <VisuallyHidden>Zoom out</VisuallyHidden>
        </Button>
        <span className="aud-map-zoom-label" aria-live="polite">{zoomLabel}</span>
        <Button
          variant="ghost"
          size="icon-xs"
          onClick={() => setZoom((z) => Math.min(6, +(z * 1.4).toFixed(2)))}
          disabled={zoom >= 6}
          title="Zoom in"
        >
          <Plus size={13} aria-hidden />
          <VisuallyHidden>Zoom in</VisuallyHidden>
        </Button>
        <Button
          variant="ghost"
          size="icon-xs"
          onClick={() => setZoom(1)}
          disabled={zoom === 1}
          title="Reset zoom"
        >
          <RotateCcw size={13} aria-hidden />
          <VisuallyHidden>Reset zoom</VisuallyHidden>
        </Button>
      </div>
      <RtECharts
        option={option}
        height={height}
        empty={items.length === 0}
        emptyMessage={emptyMessage}
        title={title}
        syncGroup={false}
      />
    </div>
  );
}
