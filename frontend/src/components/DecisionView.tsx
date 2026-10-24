import { useMemo, useState } from "react";
import {
  Area,
  CartesianGrid,
  ComposedChart,
  Line,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { endpoints, type Decision, type Meta } from "../api";
import { useApi } from "../useApi";
import {
  dateRange,
  fmtDate,
  fmtDateTime,
  fmtGW,
  fmtGWh,
  fmtHours,
  fmtMW,
  fmtSignedGWh,
  fmtSignedMW,
  fmtTime,
  hourLabel,
  ukZoneName,
} from "../format";
import { Card, ErrorBox, Kpi, LegendItem, Spinner, Toggle, TooltipBox } from "./ui";

const C = {
  forecast: "var(--series-forecast)",
  actual: "var(--series-actual)",
  band: "var(--series-band)",
  run: "var(--series-run)",
};

interface Row {
  t: number;
  time: string;
  forecast: number | null;
  p50: number | null;
  actual: number | null;
  band: [number, number] | null;
  [run: `run${number}`]: number | null;
}

export default function DecisionView({ meta, decisionHour }: { meta: Meta; decisionHour: number }) {
  const dates = useMemo(() => dateRange(meta.first_decision_date, meta.last_decision_date), [meta]);
  const [date, setDate] = useState(dates[14] ?? dates[0]);
  const [showActual, setShowActual] = useState(true);
  const [showRuns, setShowRuns] = useState(false);
  const [showTable, setShowTable] = useState(false);
  const { data, error, loading } = useApi<Decision>(endpoints.decision(date, decisionHour));

  const idx = dates.indexOf(date);
  const step = (d: number) => setDate(dates[Math.min(dates.length - 1, Math.max(0, idx + d))]);

  const rows = useMemo<Row[]>(() => {
    if (!data) return [];
    const byTime = new Map<string, Row>();
    for (const p of data.series) {
      byTime.set(p.time, {
        t: Date.parse(p.time),
        time: p.time,
        forecast: p.forecast,
        p50: p.p50,
        actual: p.actual,
        band: p.p10 != null && p.p90 != null ? [p.p10, p.p90] : null,
      });
    }
    data.runs.forEach((run, i) => {
      for (const pt of run.points) {
        const row = byTime.get(pt.time);
        if (row) row[`run${i}`] = pt.value;
      }
    });
    return [...byTime.values()].sort((a, b) => a.t - b.t);
  }, [data]);

  return (
    <div className="stack">
      <div className="date-bar">
        <div className="date-picker">
          <button className="icon-btn" onClick={() => step(-1)} disabled={idx <= 0} aria-label="Previous day">
            ‹
          </button>
          <select value={date} onChange={(e) => setDate(e.target.value)} aria-label="Decision date">
            {dates.map((d) => (
              <option key={d} value={d}>
                Decide on {fmtDate(d)}
              </option>
            ))}
          </select>
          <button
            className="icon-btn"
            onClick={() => step(1)}
            disabled={idx >= dates.length - 1}
            aria-label="Next day"
          >
            ›
          </button>
        </div>
        {data && (
          <p className="date-context">
            Buying at <b>{hourLabel(decisionHour)} {ukZoneName(data.decision_time)}</b> on {fmtDate(data.decision_date)} for
            delivery on <b>{fmtDate(data.delivery_date)}</b>
          </p>
        )}
        {loading && <span className="inline-spinner" aria-hidden="true" />}
      </div>

      {error && <ErrorBox message={error} />}
      {!data && !error && <Spinner />}
      {data && (
        <>
          <RunBanner data={data} />
          <div className="kpi-grid">
            <Kpi
              label="Published forecast"
              value={fmtGWh(data.summary.forecast_mwh)}
              hint={`Average ${fmtGW(data.summary.mean_mw)} across the day`}
            />
            <Kpi
              tone="brand"
              label="Bias-adjusted expectation (P50)"
              value={fmtGWh(data.summary.p50_mwh)}
              hint={
                data.band.err_q50 != null
                  ? `Forecast adjusted by ${fmtSignedMW(-data.band.err_q50)}, the median error of the last ${data.band.lookback_days} days`
                  : "Not enough history yet"
              }
            />
            <Kpi
              label="Firm wind floor (summed P10)"
              value={fmtGWh(data.summary.p10_mwh)}
              hint={
                data.summary.p10_mwh != null
                  ? "Sum of each half-hour's P10: a cautious floor for the day, not a daily 90% guarantee. The accuracy tab shows how often it held."
                  : "Not enough history yet for a band"
              }
            />
            <Kpi
              label="Forecast range"
              value={`${fmtGW(data.summary.min_mw)} – ${fmtGW(data.summary.peak_mw)}`}
              hint="Lowest to highest half-hour"
            />
            <Kpi
              label="Hindsight: actual wind"
              value={fmtGWh(data.summary.actual_mwh)}
              hint={
                <>
                  Published forecast {data.summary.energy_error_mwh != null && data.summary.energy_error_mwh >= 0 ? "over" : "under"} by{" "}
                  {fmtSignedGWh(data.summary.energy_error_mwh).replace(/^[+−]/, "")}
                  <br />
                  MAE {fmtMW(data.summary.mae)} published · {fmtMW(data.summary.mae_adj)} adjusted
                </>
              }
            />
          </div>

          <Card
            title={`Wind generation, ${fmtDate(data.delivery_date)}`}
            subtitle="Half-hourly national wind (GW), UK local time"
            actions={
              <>
                <Toggle checked={showActual} onChange={setShowActual} label="Show actual outturn" />
                <Toggle checked={showRuns} onChange={setShowRuns} label="Show other forecast runs" />
              </>
            }
          >
            <div className="legend">
              <LegendItem color={C.forecast} label="Published forecast at decision time" />
              <LegendItem color={C.forecast} kind="dashed" label="Bias-adjusted (P50)" />
              <LegendItem color={C.band} kind="band" label="P10–P90 band from recent errors" />
              {showActual && <LegendItem color={C.actual} label="Actual (FUELHH)" />}
              {showRuns && <LegendItem color={C.run} label="Earlier runs" />}
              {showRuns && <LegendItem color={C.run} kind="dashed" label="Runs published after decision" />}
            </div>
            <div className="chart-lg">
              <ResponsiveContainer width="100%" height="100%">
                <ComposedChart data={rows} margin={{ top: 8, right: 12, bottom: 0, left: 0 }}>
                  <CartesianGrid stroke="var(--grid)" vertical={false} />
                  <XAxis
                    dataKey="t"
                    type="number"
                    scale="time"
                    domain={["dataMin", "dataMax"]}
                    tickFormatter={(t) => fmtTime(new Date(t).toISOString())}
                    ticks={rows.filter((_, i) => i % 6 === 0).map((r) => r.t)}
                    stroke="var(--axis)"
                    tick={{ fill: "var(--text-muted)", fontSize: 12 }}
                    tickLine={false}
                  />
                  <YAxis
                    tickFormatter={(v) => `${(v / 1000).toFixed(0)}`}
                    stroke="var(--axis)"
                    tick={{ fill: "var(--text-muted)", fontSize: 12 }}
                    tickLine={false}
                    axisLine={false}
                    width={36}
                  />
                  <Tooltip content={<DecisionTooltip showActual={showActual} />} cursor={{ stroke: "var(--axis)" }} />
                  <Area dataKey="band" stroke="none" fill={C.band} fillOpacity={1} isAnimationActive={false} connectNulls />
                  {showRuns &&
                    data.runs.map((run, i) => (
                      <Line
                        key={run.publish_time}
                        dataKey={`run${i}`}
                        stroke={C.run}
                        strokeWidth={1}
                        strokeDasharray={run.before_decision ? undefined : "4 3"}
                        dot={false}
                        isAnimationActive={false}
                        activeDot={false}
                      />
                    ))}
                  <Line dataKey="forecast" stroke={C.forecast} strokeWidth={2.5} dot={false} isAnimationActive={false} />
                  <Line
                    dataKey="p50"
                    stroke={C.forecast}
                    strokeWidth={2}
                    strokeDasharray="6 4"
                    dot={false}
                    isAnimationActive={false}
                  />
                  {showActual && (
                    <Line dataKey="actual" stroke={C.actual} strokeWidth={2} dot={false} isAnimationActive={false} />
                  )}
                </ComposedChart>
              </ResponsiveContainer>
            </div>
            <button className="link-btn" onClick={() => setShowTable((v) => !v)}>
              {showTable ? "Hide" : "Show"} data table
            </button>
            {showTable && <DecisionTable data={data} />}
          </Card>
        </>
      )}
    </div>
  );
}

function RunBanner({ data }: { data: Decision }) {
  const run = data.forecast_run;
  if (!run.publish_time) {
    return <ErrorBox message="No forecast had been published by the decision time for this delivery day." />;
  }
  return (
    <div className="banner">
      <div>
        <span className="banner-label">Latest forecast at decision time</span>
        <b>Published {fmtDateTime(run.publish_time)} {ukZoneName(run.publish_time)}</b>
        <span className="muted"> · {fmtHours(run.age_hours_at_decision)} before the decision</span>
      </div>
      <div>
        <span className="banner-label">Looks ahead</span>
        <b>
          {fmtHours(run.lead_hours_min)} – {fmtHours(run.lead_hours_max)}
        </b>
      </div>
      <div>
        <span className="banner-label">Uncertainty band</span>
        <b>
          {data.band.err_q10 != null
            ? `${fmtSignedMW(-(data.band.err_q90 ?? 0))} / ${fmtSignedMW(-(data.band.err_q10 ?? 0))}`
            : "Building history…"}
        </b>
        <span className="muted"> · from {data.band.samples.toLocaleString("en-GB")} past half-hours ({data.band.lookback_days} days)</span>
      </div>
    </div>
  );
}

interface TooltipProps {
  active?: boolean;
  payload?: { payload: Row }[];
  showActual: boolean;
}

function DecisionTooltip({ active, payload, showActual }: TooltipProps) {
  if (!active || !payload?.length) return null;
  const r = payload[0].payload;
  const rows = [
    { label: "Published forecast", value: fmtMW(r.forecast), color: C.forecast },
    { label: "Bias-adjusted (P50)", value: fmtMW(r.p50), color: C.forecast },
    { label: "P10 – P90", value: r.band ? `${fmtMW(r.band[0])} – ${fmtMW(r.band[1])}` : "–", color: C.band },
  ];
  if (showActual) {
    rows.push({ label: "Actual", value: fmtMW(r.actual), color: C.actual });
    if (r.forecast != null && r.actual != null) rows.push({ label: "Error (fc − actual)", value: fmtSignedMW(r.forecast - r.actual), color: "" });
  }
  return <TooltipBox title={`${fmtTime(r.time)} ${ukZoneName(r.time)}`} rows={rows} />;
}

function DecisionTable({ data }: { data: Decision }) {
  return (
    <div className="table-wrap">
      <table>
        <thead>
          <tr>
            <th>Start ({ukZoneName(data.series[0]?.time ?? data.decision_time)})</th>
            <th>Forecast</th>
            <th>P50 (adjusted)</th>
            <th>P10</th>
            <th>P90</th>
            <th>Actual</th>
            <th>Error</th>
          </tr>
        </thead>
        <tbody>
          {data.series.map((p) => (
            <tr key={p.time}>
              <td>{fmtTime(p.time)}</td>
              <td>{fmtMW(p.forecast)}</td>
              <td>{fmtMW(p.p50)}</td>
              <td>{fmtMW(p.p10)}</td>
              <td>{fmtMW(p.p90)}</td>
              <td>{fmtMW(p.actual)}</td>
              <td>{p.forecast != null && p.actual != null ? fmtSignedMW(p.forecast - p.actual) : "–"}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
