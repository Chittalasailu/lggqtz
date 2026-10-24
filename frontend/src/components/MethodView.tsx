import type { Meta } from "../api";
import { fmtDate, fmtDateTime } from "../format";
import { Card } from "./ui";

export default function MethodView({ meta }: { meta: Meta }) {
  return (
    <div className="stack prose">
      <Card title="What this tool answers">
        <ol>
          <li>
            <b>What did the latest wind forecast say when I had to buy?</b> For every purchase decision made between{" "}
            {fmtDate(meta.first_decision_date)} and {fmtDate(meta.last_decision_date)}, we pick the most recent national
            wind forecast published <i>at or before</i> the decision time on the day before delivery. Nothing published
            later is ever used.
          </li>
          <li>
            <b>How far can I trust it?</b> We score that forecast against metered wind output for every half-hour. Each
            day we also build an uncertainty band from the errors that were already known at decision time.
          </li>
        </ol>
      </Card>

      <div className="grid-2">
        <Card title="Data">
          <ul>
            <li>
              <b>Actuals: Elexon FUELHH</b>, fuel type <code>WIND</code>. Half-hourly metered national wind generation (MW),
              keyed by settlement-period <code>startTime</code>.
            </li>
            <li>
              <b>Forecasts: Elexon WINDFOR</b>. National wind generation forecasts at hourly resolution, published about 8
              times a day, each looking up to ~3 days ahead. <code>publishTime</code> is when the run was issued.
            </li>
            <li>
              {meta.forecast_runs} forecast runs and {meta.actual_records} half-hourly actuals loaded (source:{" "}
              {meta.data_source}). The latest run in the data set was published{" "}
              {fmtDateTime(meta.latest_forecast_publish_time)}.
            </li>
          </ul>
        </Card>

        <Card title="Definitions">
          <ul>
            <li>
              <b>Decision time</b>: the chosen UK local hour on the day before delivery. The default is 11:00, gate closure
              of the GB day-ahead auction. Change it in the header.
            </li>
            <li>
              <b>Delivery day</b>: the UK local calendar day (48 settlement periods, or 46/50 on clock-change days).
            </li>
            <li>
              <b>Error</b> = forecast − actual. Positive means less wind than forecast, so the buyer is short and must top
              up in intraday or balancing markets.
            </li>
            <li>
              <b>MAE / RMSE / bias</b>: mean absolute error, root-mean-square error and mean error over half-hours (MW).
            </li>
            <li>
              <b>Half-hourly forecast</b>: hourly WINDFOR points are linearly interpolated <i>within each run</i> onto the
              30-minute settlement grid.
            </li>
          </ul>
        </Card>

        <Card title="Uncertainty band and bias adjustment">
          <p>
            For delivery day D, we collect the forecast errors from the previous {meta.band_lookback_days} days whose actuals
            had already been published by D's decision time. Their 10th, 50th and 90th percentiles give:
          </p>
          <ul>
            <li>
              <b>P50 (bias-adjusted)</b> = forecast − median recent error
            </li>
            <li>
              <b>P10 / P90</b> = forecast − 90th / 10th percentile error. Wind should come in between them about 80% of
              the time.
            </li>
          </ul>
          <p>
            The accuracy tab checks this: if the band is honest, its hit rate is close to 80%. A warm-up period from late
            December means the first January decisions also have a band, built only from information available then.
          </p>
        </Card>

        <Card title="Lead-time analysis">
          <p>
            For each lead time N from 0 to 48 hours, every delivered half-hour is scored against the latest forecast
            published at least N hours before it. This shows how accuracy changes as delivery gets closer, and where the
            day-ahead decision window (about 14–38 hours ahead at 11:00) sits on that curve.
          </p>
          <p className="muted">
            Note: this pilot uses only the two Elexon datasets above. FUELHH counts transmission-metered wind output, so
            some of the systematic gap may come from curtailment and from differences in what each dataset covers, not
            only from weather-forecast error. A production version should look into this with the forecast provider.
          </p>
        </Card>
      </div>
    </div>
  );
}
