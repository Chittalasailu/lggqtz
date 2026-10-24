// Typed client for the WindSight API. All timestamps are ISO-8601 UTC strings; all power in MW.

const API_BASE = import.meta.env.VITE_API_BASE ?? "";

export interface Meta {
  first_decision_date: string;
  last_decision_date: string;
  first_delivery_date: string;
  last_delivery_date: string;
  default_decision_hour: number;
  timezone: string;
  band_lookback_days: number;
  data_source: string;
  actual_records: number;
  forecast_runs: number;
  latest_forecast_publish_time: string;
}

export interface SeriesPoint {
  time: string;
  actual: number | null;
  forecast: number | null;
  p10: number | null;
  p50: number | null;
  p90: number | null;
}

export interface ForecastRun {
  publish_time: string;
  before_decision: boolean;
  points: { time: string; value: number | null }[];
}

export interface Decision {
  decision_date: string;
  delivery_date: string;
  decision_hour: number;
  decision_time: string;
  forecast_run: {
    publish_time: string | null;
    age_hours_at_decision: number | null;
    lead_hours_min: number | null;
    lead_hours_max: number | null;
  };
  band: { lookback_days: number; samples: number; err_q10: number | null; err_q50: number | null; err_q90: number | null };
  summary: {
    forecast_mwh: number | null;
    p10_mwh: number | null;
    p50_mwh: number | null;
    p90_mwh: number | null;
    peak_mw: number | null;
    min_mw: number | null;
    mean_mw: number | null;
    actual_mwh: number | null;
    energy_error_mwh: number | null;
    mae: number | null;
    mae_adj: number | null;
    coverage_pct: number | null;
  };
  series: SeriesPoint[];
  runs: ForecastRun[];
}

export interface Metrics {
  n: number;
  mae?: number | null;
  rmse?: number | null;
  bias?: number | null;
  nmae_pct?: number | null;
  p10?: number | null;
  p50?: number | null;
  p90?: number | null;
  max_abs?: number | null;
  mean_actual?: number | null;
  band_coverage_pct?: number | null;
}

export interface DailyRow {
  delivery_date: string;
  mae: number | null;
  mae_adj: number | null;
  bias: number | null;
  rmse: number | null;
  max_abs: number | null;
  band_coverage_pct: number | null;
  forecast_mwh: number | null;
  actual_mwh: number | null;
  energy_error_mwh: number | null;
}

export interface Accuracy {
  decision_hour: number;
  first_delivery_date: string;
  last_delivery_date: string;
  overall: Metrics;
  adjusted: Metrics;
  baseline: Metrics;
  daily_floor_hit_pct: number | null;
  lead_hours: { min: number | null; max: number | null };
  daily: DailyRow[];
  by_hour: { hour: number; mae: number | null; bias: number | null; p10: number | null; p90: number | null }[];
  histogram: { lo: number; hi: number; count: number }[];
}

export interface HorizonRow extends Metrics {
  horizon_h: number;
  coverage_pct: number | null;
}

export const endpoints = {
  meta: () => `${API_BASE}/api/meta`,
  decision: (date: string, hour: number) =>
    `${API_BASE}/api/decision?decision_date=${date}&decision_hour=${hour}`,
  accuracy: (hour: number) => `${API_BASE}/api/accuracy?decision_hour=${hour}`,
  horizon: () => `${API_BASE}/api/horizon`,
};
