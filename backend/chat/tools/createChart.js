/**
 * Tool: createChart
 * Create a chart/graph visualization from data the agent has retrieved.
 * The chart is rendered inline in the chat UI and can be downloaded by the
 * user as PNG or CSV.
 *
 * The tool validates the chart spec and returns it wrapped in a `chart`
 * property. The AgentExecutor detects this tool and emits the spec to the
 * frontend via an SSE `chart` event so it can be rendered in the message.
 */
const CHART_TYPES = ['line', 'bar', 'pie', 'area'];
const MAX_DATA_POINTS = 100;
const MAX_SERIES = 5;

// Default color palette matching the RevTube design system chart tokens.
const DEFAULT_COLORS = [
  '#3b82f6', // accent / views
  '#059669', // success / subscribers gained
  '#ef4444', // danger / views
  '#4f46e5', // watch time
  '#db2777', // likes
  '#0891b2', // comments
  '#ca8a04', // uploads
  '#8b5cf6', // avg view duration
];

module.exports = {
  name: 'createChart',
  description:
    'Create a chart or graph visualization from data you have retrieved. Use this whenever the user asks for a chart, graph, plot, visualization, or visual representation of data. Supported types: line (trend over time), bar (comparison), pie (proportions), area (trend with filled area). Provide clear titles and axis labels.',
  parameters: {
    type: 'object',
    properties: {
      type: {
        type: 'string',
        enum: CHART_TYPES,
        description:
          'Chart type: line (trend over time), bar (comparison), pie (proportions), area (trend with filled area)',
      },
      title: {
        type: 'string',
        description: 'Chart title shown above the visualization',
      },
      data: {
        type: 'array',
        items: { type: 'object' },
        description:
          'Array of data points. For line/bar/area: each item has a label key (e.g. date) and one or more value keys. For pie: each item has name and value.',
      },
      xKey: {
        type: 'string',
        description:
          'Key in each data item used for the x-axis / category labels (e.g. "date", "day", "videoTitle")',
      },
      series: {
        type: 'array',
        items: {
          type: 'object',
          properties: {
            name: { type: 'string', description: 'Display name for the series (e.g. "Views")' },
            dataKey: {
              type: 'string',
              description: 'Key in each data item holding this series value (e.g. "views")',
            },
            color: {
              type: 'string',
              description: 'Optional hex color. Omit to use the default palette.',
            },
          },
          required: ['name', 'dataKey'],
        },
        description:
          'One or more series to plot. For pie charts, use a single series with dataKey "value".',
      },
      xAxisLabel: { type: 'string', description: 'Optional label for the x-axis' },
      yAxisLabel: { type: 'string', description: 'Optional label for the y-axis' },
    },
    required: ['type', 'title', 'data', 'series'],
  },

  execute: async (args) => {
    const { type, title, data, series, xKey, xAxisLabel, yAxisLabel } = args;

    // Validate type
    if (!CHART_TYPES.includes(type)) {
      return { error: `Invalid chart type "${type}". Must be one of: ${CHART_TYPES.join(', ')}` };
    }

    // Validate title
    if (typeof title !== 'string' || title.trim().length === 0) {
      return { error: 'Chart title is required.' };
    }

    // Validate data
    if (!Array.isArray(data) || data.length === 0) {
      return { error: 'Chart data must be a non-empty array.' };
    }
    if (data.length > MAX_DATA_POINTS) {
      return {
        error: `Chart data exceeds ${MAX_DATA_POINTS} points. Please summarize or aggregate the data.`,
      };
    }

    // Validate series
    if (!Array.isArray(series) || series.length === 0) {
      return { error: 'Chart must have at least one series.' };
    }
    if (series.length > MAX_SERIES) {
      return { error: `Chart exceeds ${MAX_SERIES} series. Please combine or reduce series.` };
    }

    // Validate each series
    for (const s of series) {
      if (!s.name || typeof s.name !== 'string') {
        return { error: 'Each series must have a string name.' };
      }
      if (!s.dataKey || typeof s.dataKey !== 'string') {
        return { error: `Series "${s.name}" must have a dataKey.` };
      }
    }

    // Validate data items are plain objects
    for (const item of data) {
      if (typeof item !== 'object' || item === null || Array.isArray(item)) {
        return { error: 'Each data point must be an object.' };
      }
    }

    // For pie charts, ensure name/value keys exist
    if (type === 'pie') {
      for (const item of data) {
        if (item.name === undefined || item.value === undefined) {
          return { error: 'Pie chart data items must have "name" and "value" keys.' };
        }
      }
    }

    // Assign default colors to series without one
    const coloredSeries = series.map((s, i) => ({
      ...s,
      color: s.color || DEFAULT_COLORS[i % DEFAULT_COLORS.length],
    }));

    return {
      chart: {
        type,
        title: title.trim(),
        data,
        xKey: xKey || (type === 'pie' ? 'name' : undefined),
        series: coloredSeries,
        xAxisLabel,
        yAxisLabel,
      },
    };
  },
};