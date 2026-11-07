// Small text helpers for the widgets. Pure.

/** 3725 s -> "1h02m05s"; 125 -> "2m05s"; 9 -> "9s"; negative or not a number -> "0s". */
export function duration(seconds) {
  const s = Number.isFinite(seconds) && seconds > 0 ? Math.floor(seconds) : 0;
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const rest = s % 60;
  const two = (n) => String(n).padStart(2, "0");
  if (h) return `${h}h${two(m)}m${two(rest)}s`;
  if (m) return `${m}m${two(rest)}s`;
  return `${rest}s`;
}

/** 1234567 -> "1,234,567"; 45000 -> "45k" when `short`. */
export function money(value, short = false) {
  if (!Number.isFinite(value)) return "?";
  const sign = value < 0 ? "-" : "";
  const n = Math.abs(Math.round(value));
  if (short && n >= 1000) return `${sign}${Math.round(n / 100) / 10}k`.replace(".0k", "k");
  return sign + String(n).replace(/\B(?=(\d{3})+(?!\d))/g, ",");
}

/** ISO text -> milliseconds since epoch, or null. */
export function parseTime(iso) {
  const t = Date.parse(iso);
  return Number.isFinite(t) ? t : null;
}

/** Seconds from `nowMs` to the ISO time (negative when past), or null. */
export function secondsUntil(iso, nowMs) {
  const t = parseTime(iso);
  return t === null ? null : (t - nowMs) / 1000;
}

/** ISO time -> "21:30" in the PC's time zone, or "". */
export function clock(iso, locale) {
  const t = parseTime(iso);
  if (t === null) return "";
  return new Date(t).toLocaleTimeString(locale, { hour: "2-digit", minute: "2-digit", hour12: false });
}

/** The service's local time at a stop -> "14:20 afternoon" or "03:10 night ☾"; "" when unknown. */
export function localLabel(local) {
  if (!local || !local.clock) return "";
  const phase = local.phase ? ` ${String(local.phase).toLowerCase()}` : "";
  return `${local.clock}${phase}${local.day === false ? " ☾" : ""}`;
}

/** How sure a leg's places are: "" sure, "~" guessed, "?" unknown (the service's own marks). */
export function sureLabel(sure) {
  return sure === "~" ? "guessed" : sure === "?" ? "unknown" : "";
}
