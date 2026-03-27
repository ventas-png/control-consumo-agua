export interface EditedTagInfo {
  label: string
  tooltip: string
  color: string
  bg: string
}

/**
 * Returns display info for the "last edited" badge shown in table rows.
 * Color coding: green = <1h, yellow = <24h, gray = older.
 */
export function getEditedTagInfo(
  updatedAt: string | null | undefined,
  updatedByName: string | null | undefined,
): EditedTagInfo | null {
  if (!updatedAt) return null

  const date = new Date(updatedAt)
  const now = Date.now()
  const diffMs = now - date.getTime()
  const hours = diffMs / 3_600_000
  const days = hours / 24

  let label: string
  if (hours < 1) {
    const mins = Math.max(1, Math.floor(diffMs / 60_000))
    label = `hace ${mins}min`
  } else if (hours < 24) {
    label = `hace ${Math.floor(hours)}h`
  } else if (days < 7) {
    label = `hace ${Math.floor(days)}d`
  } else {
    label = date.toLocaleDateString('es-GT', { day: 'numeric', month: 'short' })
  }

  const fullDate = date.toLocaleString('es-GT', {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  })
  const byLine = updatedByName ? `por ${updatedByName}` : ''
  const tooltip = `Editado ${byLine} · ${fullDate}`.trim()

  let color: string
  let bg: string
  if (hours < 1) {
    color = '#166534'; bg = '#dcfce7'   // green
  } else if (hours < 24) {
    color = '#92400e'; bg = '#fef3c7'   // amber
  } else {
    color = '#475569'; bg = '#f1f5f9'   // slate
  }

  return { label, tooltip, color, bg }
}
