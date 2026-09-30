import '@tanstack/react-query';

declare module '@tanstack/react-query' {
  interface Register {
    queryMeta: {
      /** When true, skip global toast from QueryCache onError (UI handles errors). */
      suppressGlobalErrorToast?: boolean;
    };
  }
}
