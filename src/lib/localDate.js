// Local-calendar-day helpers. Plain JS (not .ts) so this imports identically
// from client pages/components, src/engine (server-side, service role), and
// api/ routes — same reasoning as src/packs/loader.js and src/lib/claude.js.
//
// The bug this exists to fix: `date.toISOString().slice(0, 10)` always
// returns the UTC calendar day, never the browser's actual local day.
// Vercel functions also run in UTC, so server code has no idea what day it
// is for the person making the request unless the client tells it. For
// anyone in a timezone behind UTC (all of the US), evening activity crosses
// into the next UTC day before local midnight — an 8pm session reads as
// "tomorrow." The fix: the client always computes and sends its own local
// day (or timezone); nothing server-side ever guesses via its own clock.

/**
 * A Date's calendar day (YYYY-MM-DD) in the *caller's own* local timezone.
 * Only meaningful when called client-side, in the browser — on a server,
 * "local" is the runtime's zone (UTC on Vercel), not the requesting user's.
 * Use localDateStrInTimeZone server-side instead, with a timezone the
 * client supplied explicitly.
 * @param {Date} date
 */
export function localDateStr(date = new Date()) {
  const y = date.getFullYear()
  const m = String(date.getMonth() + 1).padStart(2, '0')
  const d = String(date.getDate()).padStart(2, '0')
  return `${y}-${m}-${d}`
}

/**
 * The IANA timezone identifier of whoever is running this code (e.g.
 * "America/New_York"). Call this client-side and send the result to the
 * server so it can compute the request's actual local calendar day instead
 * of guessing from its own (UTC) runtime clock.
 */
export function clientTimeZone() {
  return Intl.DateTimeFormat().resolvedOptions().timeZone
}

/**
 * A Date's calendar day (YYYY-MM-DD) in an explicit IANA timezone — for
 * server code that received `tz` from the client. Falls back to UTC if
 * `timeZone` is missing or invalid (an old cached client, a non-browser
 * caller, or a malformed value), so a request never fails outright over
 * this — it just degrades to the pre-fix behavior for that one call.
 * @param {Date} date
 * @param {string} [timeZone]
 */
export function localDateStrInTimeZone(date, timeZone) {
  try {
    if (!timeZone) throw new Error('no timezone supplied')
    return new Intl.DateTimeFormat('en-CA', { timeZone, year: 'numeric', month: '2-digit', day: '2-digit' }).format(date)
  } catch {
    return date.toISOString().slice(0, 10)
  }
}

/**
 * Shift a YYYY-MM-DD calendar date string by a number of days (negative to
 * go back). Pure calendar-date arithmetic on the string itself, not a
 * real-instant conversion — avoids reintroducing timezone/DST edge cases
 * when all that's needed is "the day before this one."
 * @param {string} dateStr
 * @param {number} deltaDays
 */
export function shiftDateStr(dateStr, deltaDays) {
  const d = new Date(`${dateStr}T00:00:00.000Z`)
  d.setUTCDate(d.getUTCDate() + deltaDays)
  return d.toISOString().slice(0, 10)
}
