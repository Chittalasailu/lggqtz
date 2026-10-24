import { useEffect, useState, type KeyboardEvent } from "react";
import { endpoints, type Meta } from "./api";
import { useApi } from "./useApi";
import { hourLabel } from "./format";
import DecisionView from "./components/DecisionView";
import AccuracyView from "./components/AccuracyView";
import MethodView from "./components/MethodView";
import { ErrorBox, Spinner } from "./components/ui";

type Tab = "decision" | "accuracy" | "method";

const TABS: { id: Tab; label: string }[] = [
  { id: "decision", label: "Day-ahead decision" },
  { id: "accuracy", label: "Forecast accuracy" },
  { id: "method", label: "Method & data" },
];

function initialTab(): Tab {
  const hash = window.location.hash.slice(1) as Tab;
  return TABS.some((t) => t.id === hash) ? hash : "decision";
}

export default function App() {
  const meta = useApi<Meta>(endpoints.meta());
  const [tab, setTab] = useState<Tab>(initialTab);
  const [decisionHour, setDecisionHour] = useState<number | null>(null);

  useEffect(() => {
    if (meta.data && decisionHour === null) setDecisionHour(meta.data.default_decision_hour);
  }, [meta.data, decisionHour]);

  useEffect(() => {
    window.history.replaceState(null, "", `#${tab}`);
  }, [tab]);

  const onTabKey = (e: KeyboardEvent<HTMLElement>) => {
    const step = { ArrowRight: 1, ArrowLeft: -1 }[e.key];
    if (!step) return;
    const next = TABS[(TABS.findIndex((t) => t.id === tab) + step + TABS.length) % TABS.length].id;
    setTab(next);
    document.getElementById(`tab-${next}`)?.focus();
  };

  return (
    <div className="app">
      <header className="topbar">
        <div className="brand">
          <svg viewBox="0 0 32 32" width="30" height="30" aria-hidden="true">
            <circle cx="16" cy="16" r="15" fill="var(--brand)" />
            <path d="M16 16 L16 5 M16 16 L25.5 21.5 M16 16 L6.5 21.5" stroke="#fff" strokeWidth="3" strokeLinecap="round" />
          </svg>
          <div>
            <div className="brand-name">WindSight</div>
            <div className="brand-sub">GB day-ahead wind forecast monitor · Pilot, January 2026</div>
          </div>
        </div>
        {decisionHour !== null && (
          <label className="control">
            <span>Decision time (day before delivery)</span>
            <select value={decisionHour} onChange={(e) => setDecisionHour(Number(e.target.value))}>
              {Array.from({ length: 24 }, (_, h) => (
                <option key={h} value={h}>
                  {hourLabel(h)} UK{h === meta.data?.default_decision_hour ? " · before auction gate closure" : ""}
                </option>
              ))}
            </select>
          </label>
        )}
      </header>

      <nav className="tabs" role="tablist" aria-label="Views" onKeyDown={onTabKey}>
        {TABS.map((t) => (
          <button
            key={t.id}
            id={`tab-${t.id}`}
            role="tab"
            aria-selected={tab === t.id}
            aria-controls="tabpanel"
            tabIndex={tab === t.id ? 0 : -1}
            className={tab === t.id ? "tab active" : "tab"}
            onClick={() => setTab(t.id)}
          >
            {t.label}
          </button>
        ))}
      </nav>

      <main id="tabpanel" role="tabpanel" aria-labelledby={`tab-${tab}`}>
        {meta.error && <ErrorBox message={`Could not reach the API: ${meta.error}`} />}
        {!meta.data && !meta.error && <Spinner />}
        {meta.data && decisionHour !== null && (
          <>
            {tab === "decision" && <DecisionView meta={meta.data} decisionHour={decisionHour} />}
            {tab === "accuracy" && <AccuracyView decisionHour={decisionHour} />}
            {tab === "method" && <MethodView meta={meta.data} />}
          </>
        )}
      </main>

      <footer className="footer">
        Data: Elexon BMRS — FUELHH (wind outturn) and WINDFOR (national wind forecast).
        {meta.data && ` ${meta.data.forecast_runs} forecast runs · ${meta.data.actual_records} half-hourly actuals.`}
      </footer>
    </div>
  );
}
