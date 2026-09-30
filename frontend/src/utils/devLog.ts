/** Logs only in development -- keeps production consoles clean. */

export function devLog(...args: unknown[]): void {
  if (import.meta.env.DEV) console.log(...args);
}

export function devDebug(...args: unknown[]): void {
  if (import.meta.env.DEV) console.debug(...args);
}

export function devInfo(...args: unknown[]): void {
  if (import.meta.env.DEV) console.info(...args);
}
