'use strict';
// Every read and write keys a day by the FAMILY's local date, never the server's or UTC.

function parts(tz, now) {
  const fmt = new Intl.DateTimeFormat('en-CA', {
    timeZone: tz, year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', hourCycle: 'h23',
  });
  const p = {};
  for (const { type, value } of fmt.formatToParts(now)) p[type] = value;
  return p;
}

function todayInTz(tz, now = new Date()) {
  const p = parts(tz, now);
  return `${p.year}-${p.month}-${p.day}`;
}

function minutesInTz(tz, now = new Date()) {
  const p = parts(tz, now);
  return Number(p.hour) * 60 + Number(p.minute);
}

// Calendar arithmetic on YYYY-MM-DD strings (no time zone involved).
function addDays(date, n) {
  const d = new Date(date + 'T12:00:00Z');
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}

function validTz(tz) {
  try { new Intl.DateTimeFormat('en', { timeZone: tz }); return true; } catch { return false; }
}

const hhmmToMinutes = (s) => { const [h, m] = String(s).split(':').map(Number); return h * 60 + m; };

module.exports = { todayInTz, minutesInTz, addDays, validTz, hhmmToMinutes };
