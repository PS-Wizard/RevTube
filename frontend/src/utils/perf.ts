import { devInfo } from './devLog';

export const markInteractionStart = (name: string) => {
  if (typeof performance === 'undefined') return;
  performance.mark(`${name}:start`);
};

export const markInteractionEnd = (name: string) => {
  if (typeof performance === 'undefined') return;
  const start = `${name}:start`;
  const end = `${name}:end`;
  performance.mark(end);
  performance.measure(name, start, end);
  const entries = performance.getEntriesByName(name);
  const last = entries[entries.length - 1];
  if (last) {
    // Logged for local profiling and regression tracking during rollout.
    devInfo(`[perf] ${name}: ${Math.round(last.duration)}ms`);
  }
  performance.clearMarks(start);
  performance.clearMarks(end);
};

