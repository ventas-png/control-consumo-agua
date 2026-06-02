// ============================================================================
// scheduleHelpers — F4.5.1c5: utilidades para mostrar "Próxima ejecución"
// ============================================================================
// Los cron jobs corren:
//   - reports-monthly-day1  → 0 9 1 * *  (día 1 de cada mes, 09:00 UTC)
//   - reports-weekly-monday → 0 9 * * 1  (cada lunes, 09:00 UTC)
//
// nextRunFor() calcula la próxima ejecución desde un punto de referencia.
// Considera que el cron retro-disparó hoy (si last_run_at es hoy) o no.

export type ScheduleKind = 'manual' | 'monthly_day1' | 'weekly_monday'

const SCHEDULE_HOUR_UTC = 9

/**
 * Calcula la próxima ejecución del cron según schedule_kind y la última
 * ejecución registrada. Si schedule es 'manual' o no aplica, devuelve null.
 *
 * Si last_run_at es hoy (ya corrió), salta al próximo ciclo. Si no, retorna
 * la siguiente fecha del cron desde "ahora".
 */
export function nextRunFor(schedule: ScheduleKind, lastRunAt: string | null, now: Date = new Date()): Date | null {
  if (schedule === 'manual') return null

  const ranToday = lastRunAt ? isSameUtcDay(new Date(lastRunAt), now) : false
  const baseline = ranToday ? addDaysUtc(now, 1) : now

  if (schedule === 'monthly_day1') {
    return nextMonthlyDay1(baseline)
  }
  if (schedule === 'weekly_monday') {
    return nextWeeklyMonday(baseline)
  }
  return null
}

function nextMonthlyDay1(from: Date): Date {
  const y = from.getUTCFullYear()
  const m = from.getUTCMonth()
  const d = from.getUTCDate()
  const h = from.getUTCHours()
  // Si estamos en día 1 antes de la hora cron → ese mismo día
  if (d === 1 && h < SCHEDULE_HOUR_UTC) {
    return new Date(Date.UTC(y, m, 1, SCHEDULE_HOUR_UTC, 0, 0))
  }
  // Si día > 1 o día 1 después de las 9 → mes siguiente día 1
  return new Date(Date.UTC(y, m + 1, 1, SCHEDULE_HOUR_UTC, 0, 0))
}

function nextWeeklyMonday(from: Date): Date {
  const y = from.getUTCFullYear()
  const m = from.getUTCMonth()
  const d = from.getUTCDate()
  const h = from.getUTCHours()
  const dow = new Date(Date.UTC(y, m, d)).getUTCDay() // 0=Dom, 1=Lun

  // Si es lunes y antes de la hora cron → hoy mismo
  if (dow === 1 && h < SCHEDULE_HOUR_UTC) {
    return new Date(Date.UTC(y, m, d, SCHEDULE_HOUR_UTC, 0, 0))
  }
  // Calcula cuántos días faltan para el próximo lunes (1)
  const daysUntilNextMonday = dow === 1
    ? 7 // lunes pero después de las 9 → próximo lunes
    : ((1 + 7 - dow) % 7) || 7
  return new Date(Date.UTC(y, m, d + daysUntilNextMonday, SCHEDULE_HOUR_UTC, 0, 0))
}

function isSameUtcDay(a: Date, b: Date): boolean {
  return a.getUTCFullYear() === b.getUTCFullYear()
    && a.getUTCMonth() === b.getUTCMonth()
    && a.getUTCDate() === b.getUTCDate()
}

function addDaysUtc(d: Date, n: number): Date {
  return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate() + n, d.getUTCHours()))
}

/**
 * Formatea una Date como "lun 9 jun 09:00 UTC" para humans.
 * Si está dentro de las próximas 24h, devuelve "en X horas".
 */
export function formatNextRun(d: Date, now: Date = new Date()): string {
  const diffMs = d.getTime() - now.getTime()
  if (diffMs < 0) return 'pendiente'
  const hours = diffMs / (60 * 60 * 1000)
  if (hours < 24) {
    const h = Math.round(hours)
    return h <= 1 ? 'en menos de 1h' : `en ${h}h`
  }
  return d.toLocaleString('es-GT', {
    weekday: 'short',
    day: 'numeric',
    month: 'short',
    hour: '2-digit',
    minute: '2-digit',
    timeZone: 'UTC',
    hour12: false,
  }) + ' UTC'
}
