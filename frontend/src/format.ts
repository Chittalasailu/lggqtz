// Display helpers. Market times are always shown in UK local time, whatever the viewer's timezone.

export const UK_TZ = "Europe/London";

const timeFmt = new Intl.DateTimeFormat("en-GB", { timeZone: UK_TZ, hour: "2-digit", minute: "2-digit" });
const dateTimeFmt = new Intl.DateTimeFormat("en-GB", {
  timeZone: UK_TZ,
  weekday: "short",
  day: "numeric",
  month: "short",
  hour: "2-digit",
  minute: "2-digit",
});
const dateFmt = new Intl.DateTimeFormat("en-GB", {
  timeZone: "UTC", // calendar dates are timezone-free; format them as-is
  weekday: "short",
  day: "numeric",
  month: "short",
  year: "numeric",
});
const shortDateFmt = new Intl.DateTimeFormat("en-GB", { timeZone: "UTC", day: "numeric", month: "short" });

export const fmtTime = (iso: string) => timeFmt.format(new Date(iso));
export const fmtDateTime = (iso: string) => dateTimeFmt.format(new Date(iso));
export const fmtDate = (isoDate: string) => dateFmt.format(new Date(`${isoDate}T00:00:00Z`));
export const fmtShortDate = (isoDate: string) => shortDateFmt.format(new Date(`${isoDate}T00:00:00Z`));
export const hourLabel = (h: number) => `${String(h).padStart(2, "0")}:00`;

/** UK abbreviation (GMT/BST) for an instant. */
export function ukZoneName(iso: string): string {
  const part = new Intl.DateTimeFormat("en-GB", { timeZone: UK_TZ, timeZoneName: "short" })
    .formatToParts(new Date(iso))
    .find((p) => p.type === "timeZoneName");
  // Engines differ: some print "GMT"/"BST", others "GMT+0"/"GMT+1".
  const name = part?.value ?? "";
  if (name === "GMT+1") return "BST";
  if (name === "GMT+0" || name === "UTC") return "GMT";
  return name;
}

const nf = (digits: number) =>
  new Intl.NumberFormat("en-GB", { minimumFractionDigits: digits, maximumFractionDigits: digits });

export const fmtNum = (v: number | null | undefined, digits = 0) => (v == null ? "–" : nf(digits).format(v));
/** MW -> "12.3 GW" */
export const fmtGW = (mw: number | null | undefined, digits = 1) => (mw == null ? "–" : `${nf(digits).format(mw / 1000)} GW`);
/** MWh -> "123.4 GWh" */
export const fmtGWh = (mwh: number | null | undefined, digits = 1) =>
  mwh == null ? "–" : `${nf(digits).format(mwh / 1000)} GWh`;
export const fmtMW = (mw: number | null | undefined) => (mw == null ? "–" : `${nf(0).format(mw)} MW`);
export const fmtSignedMW = (mw: number | null | undefined) =>
  mw == null ? "–" : `${mw > 0 ? "+" : mw < 0 ? "−" : ""}${nf(0).format(Math.abs(mw))} MW`;
export const fmtSignedGWh = (mwh: number | null | undefined) =>
  mwh == null ? "–" : `${mwh > 0 ? "+" : mwh < 0 ? "−" : ""}${nf(1).format(Math.abs(mwh) / 1000)} GWh`;
export const fmtPct = (v: number | null | undefined, digits = 0) => (v == null ? "–" : `${nf(digits).format(v)}%`);
export const fmtHours = (h: number | null | undefined) => (h == null ? "–" : `${nf(h % 1 ? 1 : 0).format(h)} h`);

/** ISO date `days` after `isoDate`. */
export function addDays(isoDate: string, days: number): string {
  const d = new Date(`${isoDate}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

/** Inclusive list of ISO dates from `start` to `end`. */
export function dateRange(start: string, end: string): string[] {
  const out: string[] = [];
  for (let d = new Date(`${start}T00:00:00Z`); d <= new Date(`${end}T00:00:00Z`); d.setUTCDate(d.getUTCDate() + 1)) {
    out.push(d.toISOString().slice(0, 10));
  }
  return out;
}
