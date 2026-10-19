// Dates in ledgers use the local calendar day of the machine (set TZ to change it), never the UTC day:
// a decision made at 00:30 local time must not be dated the day before.
const pad = (n) => String(n).padStart(2, '0');

export function localDate(now = new Date()) {
  return `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`;
}

export function localStamp(now = new Date()) {
  return `${localDate(now)} ${pad(now.getHours())}:${pad(now.getMinutes())}`;
}
