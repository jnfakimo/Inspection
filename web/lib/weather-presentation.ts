export type TownForecastView<T> = {
  county: string;
  towns: T[];
  selectedTown: T | null;
  error: string;
  busy: boolean;
};

export function emptyTownForecastView<T>(county = ''): TownForecastView<T> {
  return { county, towns: [], selectedTown: null, error: '', busy: Boolean(county) };
}

/** Hide data immediately when the selected county changes, before its effect runs. */
export function visibleTownForecastView<T>(view: TownForecastView<T>, county: string) {
  return view.county === county ? view : emptyTownForecastView<T>(county);
}

export function formatWeatherMetric(value: unknown, unit: string, digits = 0) {
  if (value === null || value === undefined || value === '' || !Number.isFinite(Number(value))) return '未提供';
  return `${Number(value).toFixed(digits)}${unit}`;
}

export function formatWeatherTextMetric(value: unknown, unit: string) {
  return value === null || value === undefined || String(value).trim() === '' ? '未提供' : `${String(value)}${unit}`;
}
