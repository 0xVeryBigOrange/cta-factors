export function normalizeYahooBars(
  rows: ReadonlyArray<ReadonlyArray<number | null | undefined>> | null | undefined,
  interval?: string | null,
  regularMarketPrice?: number | null,
): number[][];
