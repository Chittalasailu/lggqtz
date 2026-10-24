import type { CSSProperties, ReactNode } from "react";

export function Card({ title, subtitle, children, actions }: {
  title?: string;
  subtitle?: ReactNode;
  children: ReactNode;
  actions?: ReactNode;
}) {
  return (
    <section className="card">
      {(title || actions) && (
        <div className="card-head">
          <div>
            {title && <h2>{title}</h2>}
            {subtitle && <p className="muted">{subtitle}</p>}
          </div>
          {actions && <div className="card-actions">{actions}</div>}
        </div>
      )}
      {children}
    </section>
  );
}

export function Kpi({ label, value, hint, tone }: {
  label: string;
  value: ReactNode;
  hint?: ReactNode;
  tone?: "brand" | "default";
}) {
  return (
    <div className={`kpi ${tone === "brand" ? "kpi-brand" : ""}`}>
      <div className="kpi-label">{label}</div>
      <div className="kpi-value">{value}</div>
      {hint && <div className="kpi-hint">{hint}</div>}
    </div>
  );
}

export function LegendItem({ color, label, kind = "line" }: { color: string; label: string; kind?: "line" | "band" | "dashed" }) {
  return (
    <span className="legend-item">
      <span className={`swatch swatch-${kind}`} style={{ "--swatch": color } as CSSProperties} />
      {label}
    </span>
  );
}

export function Toggle({ checked, onChange, label }: { checked: boolean; onChange: (v: boolean) => void; label: string }) {
  return (
    <label className="toggle">
      <input type="checkbox" checked={checked} onChange={(e) => onChange(e.target.checked)} />
      <span>{label}</span>
    </label>
  );
}

export const Spinner = () => <div className="spinner" role="status" aria-label="Loading" />;

export const ErrorBox = ({ message }: { message: string }) => (
  <div className="error-box" role="alert">
    {message}
  </div>
);

/** Shared tooltip shell used by every chart. */
export function TooltipBox({ title, rows }: { title: string; rows: { label: string; value: string; color?: string }[] }) {
  return (
    <div className="tooltip">
      <div className="tooltip-title">{title}</div>
      {rows.map((r) => (
        <div className="tooltip-row" key={r.label}>
          <span>
            {r.color && <i className="dot" style={{ background: r.color }} />}
            {r.label}
          </span>
          <b>{r.value}</b>
        </div>
      ))}
    </div>
  );
}
