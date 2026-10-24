import { useState } from "react";
import {
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  ComposedChart,
  Line,
  LineChart,
  ReferenceArea,
  ReferenceLine,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { endpoints, type Accuracy, type DailyRow, type HorizonRow } from "../api";
import { useApi } from "../useApi";
import {
  fmtDate,
  fmtGW,
  fmtGWh,
  fmtHours,
  fmtMW,
  fmtPct,
  fmtShortDate,
  fmtSignedGWh,
  fmtSignedMW,
  hourLabel,
} from "../format";
import { Card, ErrorBox, Kpi, LegendItem, Spinner, TooltipBox } from "./ui";

const S1 = "var(--s1)";
const S2 = "var(--s2)";
const POS = "var(--div-pos)"; // over-forecast: wind short, buyer under-procured
const NEG = "var(--div-neg)"; // under-forecast: wind long, buyer over-procured

const axis = {
  stroke: "var(--axis)",
  tick: { fill: "var(--text-muted)", fontSize: 12 },
  tickLine: false,
} as const;

const gwTick = (v: number) => (v / 1000).toFixed(v % 1000 === 0 ? 0 : 1);

/** Whole-GW ticks spanning the histogram's bins. */
function gwTicks(bins: { lo: number; hi: number }[]): number[] {
  if (!bins.length) return [];
  const ticks: number[] = [];
  for (let v = Math.ceil(bins[0].lo / 1000) * 1000; v <= bins[bins.length - 1].hi; v += 1000) ticks.push(v);
  return ticks;
}

export default function AccuracyView({ decisionHour }: { decisionHour: number }) {
  const acc = useApi<Accuracy>(endpoints.accuracy(decisionHour));
  const hor = useApi<{ horizons: HorizonRow[] }>(endpoints.horizon());

  if (acc.error) return <ErrorBox message={acc.error} />;
  if (!acc.data) return <Spinner />;
  const a = acc.data;
  const o = a.overall;
  const adj = a.adjusted;
  const improvement = o.mae && adj.mae ? (100 * (o.mae - adj.mae)) / o.mae : null;

  return (
    <div className="stack">
      <p className="lede">
        How reliable was the forecast a buyer actually had in hand? Every half-hour delivered from{" "}
        <b>{fmtDate(a.first_delivery_date)}</b> to <b>{fmtDate(a.last_delivery_date)}</b>, scored against the
        latest forecast published by <b>{hourLabel(decisionHour)}</b> the day before. Lead times{" "}
        {fmtHours(a.lead_hours.min)}–{fmtHours(a.lead_hours.max)}.
        {acc.loading && <span className="inline-spinner" aria-hidden="true" />}
      </p>

      <div className="kpi-grid kpi-grid-6">
        <Kpi tone="brand" label="Mean absolute error" value={fmtGW(o.mae, 2)} hint={`${fmtPct(o.nmae_pct, 1)} of average wind output`} />
        <Kpi label="Bias (forecast − actual)" value={fmtSignedMW(o.bias)} hint={(o.bias ?? 0) > 0 ? "Forecast typically too high" : "Forecast typically too low"} />
        <Kpi label="RMSE" value={fmtGW(o.rmse, 2)} hint="Penalises large misses" />
        <Kpi label="Bias-adjusted MAE" value={fmtGW(adj.mae, 2)} hint={improvement != null ? `${fmtPct(improvement)} lower, using only past errors` : undefined} />
        <Kpi label="P10–P90 band hit rate" value={fmtPct(o.band_coverage_pct, 1)} hint="Target 80%: the band is well calibrated if close" />
        <Kpi label="Worst half-hour miss" value={fmtGW(o.max_abs, 1)} hint={`80% of errors between ${fmtSignedMW(o.p10)} and ${fmtSignedMW(o.p90)}`} />
      </div>

      <Insight overall={o} adjustedMae={adj.mae} improvement={improvement} />

      <div className="grid-2">
        <Card title="Daily energy error" subtitle="Forecast minus actual wind energy per delivery day (GWh)">
          <div className="legend">
            <LegendItem color={POS} kind="band" label="Forecast too high (short on wind)" />
            <LegendItem color={NEG} kind="band" label="Forecast too low (long on wind)" />
          </div>
          <div className="chart-md">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={a.daily} margin={{ top: 8, right: 8, bottom: 0, left: 0 }} barCategoryGap={2}>
                <CartesianGrid stroke="var(--grid)" vertical={false} />
                <XAxis dataKey="delivery_date" tickFormatter={fmtShortDate} interval={4} {...axis} />
                <YAxis tickFormatter={(v) => (v / 1000).toFixed(0)} width={40} axisLine={false} {...axis} />
                <ReferenceLine y={0} stroke="var(--axis)" />
                <Tooltip content={<DailyTooltip />} cursor={{ fill: "var(--hover)" }} />
                <Bar dataKey="energy_error_mwh" radius={[3, 3, 3, 3]} isAnimationActive={false}>
                  {a.daily.map((d) => (
                    <Cell key={d.delivery_date} fill={(d.energy_error_mwh ?? 0) >= 0 ? POS : NEG} />
                  ))}
                </Bar>
              </BarChart>
            </ResponsiveContainer>
          </div>
        </Card>

        <Card
          title="Accuracy vs. forecast lead time"
          subtitle="Error (GW) of the latest forecast published at least N hours before delivery"
        >
          <div className="legend">
            <LegendItem color={S1} label="Mean absolute error" />
            <LegendItem color={S2} label="Bias" />
            <LegendItem color="var(--highlight)" kind="band" label="Day-ahead decision window" />
          </div>
          <div className="chart-md">
            {hor.data ? (
              <ResponsiveContainer width="100%" height="100%">
                <LineChart data={hor.data.horizons} margin={{ top: 8, right: 12, bottom: 12, left: 0 }}>
                  <CartesianGrid stroke="var(--grid)" vertical={false} />
                  {a.lead_hours.min != null && a.lead_hours.max != null && (
                    <ReferenceArea x1={Math.round(a.lead_hours.min)} x2={Math.min(48, Math.round(a.lead_hours.max))} fill="var(--highlight)" fillOpacity={1} />
                  )}
                  <XAxis dataKey="horizon_h" type="number" domain={[0, 48]} ticks={[0, 6, 12, 18, 24, 30, 36, 42, 48]} {...axis}
                    label={{ value: "Minimum lead time (hours)", position: "insideBottom", dy: 12, fill: "var(--text-muted)", fontSize: 12 }} />
                  <YAxis tickFormatter={gwTick} width={40} axisLine={false} domain={[0, "auto"]} {...axis} />
                  <Tooltip content={<HorizonTooltip />} cursor={{ stroke: "var(--axis)" }} />
                  <Line dataKey="mae" stroke={S1} strokeWidth={2} dot={false} isAnimationActive={false} />
                  <Line dataKey="bias" stroke={S2} strokeWidth={2} dot={false} isAnimationActive={false} />
                </LineChart>
              </ResponsiveContainer>
            ) : hor.error ? (
              <ErrorBox message={hor.error} />
            ) : (
              <Spinner />
            )}
          </div>
        </Card>

        <Card title="Error distribution" subtitle="Number of half-hours by forecast − actual (GW), 500 MW bins">
          <div className="legend">
            <LegendItem color={S1} kind="band" label="Half-hours" />
            <LegendItem color="var(--text-muted)" kind="dashed" label="P10 / P90 error" />
          </div>
          <div className="chart-md">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={a.histogram.map((b) => ({ ...b, mid: (b.lo + b.hi) / 2 }))} margin={{ top: 8, right: 12, bottom: 0, left: 0 }} barCategoryGap={1}>
                <CartesianGrid stroke="var(--grid)" vertical={false} />
                <XAxis dataKey="mid" type="number" domain={["dataMin - 250", "dataMax + 250"]} ticks={gwTicks(a.histogram)} tickFormatter={gwTick} {...axis} />
                <YAxis width={40} axisLine={false} {...axis} />
                <Tooltip content={<HistTooltip />} cursor={{ fill: "var(--hover)" }} />
                <Bar dataKey="count" fill={S1} radius={[3, 3, 0, 0]} isAnimationActive={false} />
                <ReferenceLine x={0} stroke="var(--axis)" />
                {o.p10 != null && <ReferenceLine x={o.p10} stroke="var(--text-muted)" strokeDasharray="4 3" />}
                {o.p90 != null && <ReferenceLine x={o.p90} stroke="var(--text-muted)" strokeDasharray="4 3" />}
              </BarChart>
            </ResponsiveContainer>
          </div>
        </Card>

        <Card title="Error by time of day" subtitle="Error (GW) by UK local hour of delivery">
          <div className="legend">
            <LegendItem color={S1} kind="band" label="Mean absolute error" />
            <LegendItem color={S2} label="Bias" />
          </div>
          <div className="chart-md">
            <ResponsiveContainer width="100%" height="100%">
              <ComposedChart data={a.by_hour} margin={{ top: 8, right: 12, bottom: 0, left: 0 }} barCategoryGap={2}>
                <CartesianGrid stroke="var(--grid)" vertical={false} />
                <XAxis dataKey="hour" tickFormatter={hourLabel} interval={3} {...axis} />
                <YAxis tickFormatter={gwTick} width={40} axisLine={false} domain={[0, "auto"]} {...axis} />
                <Tooltip content={<HourTooltip />} cursor={{ fill: "var(--hover)" }} />
                <Bar dataKey="mae" fill={S1} radius={[3, 3, 0, 0]} isAnimationActive={false} />
                <Line dataKey="bias" stroke={S2} strokeWidth={2} dot={false} isAnimationActive={false} />
              </ComposedChart>
            </ResponsiveContainer>
          </div>
        </Card>
      </div>

      <DailyTable rows={a.daily} />
    </div>
  );
}

function Insight({ overall, adjustedMae, improvement }: { overall: Accuracy["overall"]; adjustedMae?: number | null; improvement: number | null }) {
  if (overall.bias == null || overall.mae == null) return null;
  return (
    <div className="insight">
      <b>Key finding.</b> The published day-ahead wind forecast ran on average{" "}
      <b>{fmtGW(Math.abs(overall.bias), 1)} {overall.bias > 0 ? "above" : "below"}</b> metered wind output. A buyer
      who took it at face value would usually have bought too little from the market. Correcting it each day with the
      median error of the previous two weeks, which is known at decision time, cuts the typical error from{" "}
      <b>{fmtGW(overall.mae, 2)}</b> to <b>{fmtGW(adjustedMae, 2)}</b>
      {improvement != null && ` (${fmtPct(improvement)} lower)`}. The <b>Day-ahead decision</b> tab shows this as the
      bias-adjusted line.
    </div>
  );
}

interface TP<T> {
  active?: boolean;
  payload?: { payload: T }[];
}

function DailyTooltip({ active, payload }: TP<DailyRow>) {
  if (!active || !payload?.length) return null;
  const d = payload[0].payload;
  return (
    <TooltipBox
      title={fmtDate(d.delivery_date)}
      rows={[
        { label: "Energy error", value: fmtSignedGWh(d.energy_error_mwh) },
        { label: "Forecast", value: fmtGWh(d.forecast_mwh) },
        { label: "Actual", value: fmtGWh(d.actual_mwh) },
        { label: "MAE", value: fmtMW(d.mae) },
      ]}
    />
  );
}

function HorizonTooltip({ active, payload }: TP<HorizonRow>) {
  if (!active || !payload?.length) return null;
  const r = payload[0].payload;
  return (
    <TooltipBox
      title={`Published ≥ ${r.horizon_h} h ahead`}
      rows={[
        { label: "MAE", value: fmtMW(r.mae), color: S1 },
        { label: "Bias", value: fmtSignedMW(r.bias), color: S2 },
        { label: "RMSE", value: fmtMW(r.rmse) },
        { label: "Periods covered", value: fmtPct(r.coverage_pct) },
      ]}
    />
  );
}

function HistTooltip({ active, payload }: TP<{ lo: number; hi: number; count: number }>) {
  if (!active || !payload?.length) return null;
  const b = payload[0].payload;
  return (
    <TooltipBox
      title={`${fmtSignedMW(b.lo)} to ${fmtSignedMW(b.hi)}`}
      rows={[{ label: "Half-hours", value: String(b.count), color: S1 }]}
    />
  );
}

function HourTooltip({ active, payload }: TP<Accuracy["by_hour"][number]>) {
  if (!active || !payload?.length) return null;
  const r = payload[0].payload;
  return (
    <TooltipBox
      title={`${hourLabel(r.hour)}–${hourLabel((r.hour + 1) % 24)}`}
      rows={[
        { label: "MAE", value: fmtMW(r.mae), color: S1 },
        { label: "Bias", value: fmtSignedMW(r.bias), color: S2 },
        { label: "P10 / P90 error", value: `${fmtSignedMW(r.p10)} / ${fmtSignedMW(r.p90)}` },
      ]}
    />
  );
}

function DailyTable({ rows }: { rows: DailyRow[] }) {
  const [open, setOpen] = useState(false);
  return (
    <Card
      title="Daily scorecard"
      actions={
        <button className="link-btn" onClick={() => setOpen((v) => !v)}>
          {open ? "Hide" : "Show"} table
        </button>
      }
    >
      {open && (
        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th>Delivery day</th>
                <th>Forecast</th>
                <th>Actual</th>
                <th>Energy error</th>
                <th>MAE</th>
                <th>MAE (adjusted)</th>
                <th>Worst miss</th>
                <th>Band hit rate</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((d) => (
                <tr key={d.delivery_date}>
                  <td>{fmtDate(d.delivery_date)}</td>
                  <td>{fmtGWh(d.forecast_mwh)}</td>
                  <td>{fmtGWh(d.actual_mwh)}</td>
                  <td>{fmtSignedGWh(d.energy_error_mwh)}</td>
                  <td>{fmtMW(d.mae)}</td>
                  <td>{fmtMW(d.mae_adj)}</td>
                  <td>{fmtMW(d.max_abs)}</td>
                  <td>{fmtPct(d.band_coverage_pct)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </Card>
  );
}
