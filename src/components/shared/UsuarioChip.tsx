import { useUsuariosMap } from '../../domain/usuarios/queries'

// ============================================================================
// UsuarioChip — resuelve una columna de trazabilidad a un nombre legible.
// ============================================================================
// Las columnas selladas por la BD (`creado_por`, `completado_por`,
// `registrado_por`, `visitado_por`…) guardan un uuid. Mostrarlo crudo no le
// dice nada a nadie, y hacer que cada una de las ~15 pestañas resuelva
// uuid → nombre por su cuenta terminaría en 15 implementaciones distintas.
//
// Los tres casos que hay que distinguir, y por qué NO son lo mismo:
//
//   null            → "Sistema". La fila la escribió un proceso automático
//                     (edge function con service-role, pg_cron). Es un dato
//                     correcto, no un hueco.
//   id desconocido  → primeros 8 chars. El usuario existió pero ya no está en
//                     app_users. Mostramos algo estable en vez de mentir con
//                     "Sistema".
//   sinDato         → "—". La fila es ANTERIOR a la trazabilidad
//                     (20260731000000) y nunca se selló. Distinguirlo de
//                     "Sistema" importa: uno es una escritura automática y el
//                     otro es simplemente historia sin registrar.

interface Props {
  /** uuid del usuario, o null si la escritura fue de sistema. */
  userId: string | null | undefined
  /**
   * Texto para filas anteriores a la trazabilidad. Si es `true`, un `userId`
   * nulo se muestra como "—" en vez de "Sistema". Úsalo en vistas de datos
   * históricos donde la mayoría de filas no tiene sello.
   */
  historico?: boolean
  /** Muestra el rol junto al nombre (útil en tablas de supervisión). */
  mostrarRol?: boolean
  companyId?: string
}

export function UsuarioChip({ userId, historico = false, mostrarRol = false, companyId }: Props) {
  const { mapa } = useUsuariosMap(companyId)

  if (!userId) {
    return (
      <span style={{ color: 'var(--at-ink-3)', fontSize: 12 }}>
        {historico ? '—' : 'Sistema'}
      </span>
    )
  }

  const usuario = mapa.get(userId)
  const nombre = usuario?.full_name?.trim() || `Usuario ${userId.slice(0, 8)}`

  return (
    <span
      title={usuario ? `${nombre}${usuario.activo ? '' : ' (inactivo)'}` : `ID ${userId}`}
      style={{ display: 'inline-flex', alignItems: 'center', gap: 6, fontSize: 12 }}
    >
      <span
        aria-hidden
        style={{
          width: 20, height: 20, borderRadius: '50%', flexShrink: 0,
          background: 'var(--at-primary-tint)', color: 'var(--at-primary)',
          display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
          fontSize: 9, fontWeight: 700,
        }}
      >
        {iniciales(nombre)}
      </span>
      <span
        style={{
          fontWeight: 600,
          color: usuario?.activo === false ? 'var(--at-ink-3)' : 'var(--at-ink-1)',
        }}
      >
        {nombre}
      </span>
      {mostrarRol && usuario?.role && (
        <span style={{ color: 'var(--at-ink-3)', fontSize: 11 }}>· {usuario.role}</span>
      )}
    </span>
  )
}

/** Iniciales para el avatar: "Ana María López" → "AL". */
function iniciales(nombre: string): string {
  const partes = nombre.trim().split(/\s+/).filter(Boolean)
  if (partes.length === 0) return '?'
  if (partes.length === 1) return partes[0].slice(0, 2).toUpperCase()
  return (partes[0][0] + partes[partes.length - 1][0]).toUpperCase()
}
