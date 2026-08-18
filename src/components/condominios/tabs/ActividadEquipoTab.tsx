import { useMemo, useState } from 'react'
import { DataTable, type DataTableColumn } from '../../shared/DataTable'
import { StatTile } from '../../shared/StatTile'
import { UsuarioChip } from '../../shared/UsuarioChip'
import { useActividadEquipo, type ActividadUsuario } from '../../../domain/condominios/actividad'
import { dateLocalISO } from '../../../lib/format'
import { useHoyLocalISO } from '../../../hooks/useHoy'

// ============================================================================
// ActividadEquipoTab — qué hizo cada persona del equipo en el período.
// ============================================================================
// Lee el RPC `actividad_equipo`, que agrega sobre las columnas de trazabilidad
// selladas por la BD. Responde las preguntas que hoy no tienen respuesta:
// cuántas lecturas capturó cada lecturista, quién completó las tareas de
// limpieza, quién está registrando las visitas — y quién dejó de reportar.

interface Props {
  proyectoId: string
  companyId: string
}

/** Días hacia atrás de los rangos rápidos. */
const RANGOS = [
  { label: '7 días', dias: 7 },
  { label: '30 días', dias: 30 },
  { label: '90 días', dias: 90 },
] as const

// dateLocalISO y no toISOString(): en husos negativos (todo LATAM) el ISO
// devuelve la fecha UTC y después de las 18:00 locales el rango se corre un día.
function isoHaceDias(dias: number): string {
  const d = new Date()
  d.setDate(d.getDate() - dias)
  return dateLocalISO(d)
}

export default function ActividadEquipoTab({ proyectoId, companyId }: Props) {
  const [dias, setDias] = useState<number>(30)
  // `useMemo(() => hoyLocalISO(), [])` congelaba el extremo del rango: una
  // pantalla abierta de madrugada seguía consultando hasta ayer. useHoyLocalISO
  // mantiene la identidad estable dentro del día y la refresca a medianoche.
  const hasta = useHoyLocalISO()
  const desde = useMemo(() => isoHaceDias(dias), [dias])

  const { data, isLoading, isError, error } = useActividadEquipo(proyectoId, desde, hasta)
  // `data ?? []` creaba un array nuevo en cada render, así que los dos memos de
  // abajo se recalculaban siempre (memoización inútil). Estabilizado aquí.
  const filas = useMemo(() => data ?? [], [data])

  const totales = useMemo(() => filas.reduce(
    (acc, f) => ({
      lecturas: acc.lecturas + f.lecturas,
      limpiezas: acc.limpiezas + f.limpiezas + f.checklists,
      rondas: acc.rondas + f.rondas_iniciadas + f.puntos_marcados,
      visitas: acc.visitas + f.visitas_registradas + f.paquetes,
      acciones: acc.acciones + f.total,
    }),
    { lecturas: 0, limpiezas: 0, rondas: 0, visitas: 0, acciones: 0 },
  ), [filas])

  // "Sin reportar" = alguien que registró algo en el período pero lleva más de
  // 7 días sin hacerlo. Es la señal que un administrador quiere ver de un
  // vistazo; el resto de la tabla es el detalle.
  const inactivos = useMemo(() => {
    const corte = Date.now() - 7 * 24 * 3600 * 1000
    return filas.filter(f => f.ultima_actividad && new Date(f.ultima_actividad).getTime() < corte).length
  }, [filas])

  if (isError) {
    // El RPC exige rol de plataforma admin / company_owner (es información sobre
    // el desempeño de personas). Un usuario con rol de condominio suficiente
    // para ver la pestaña pero sin ese rol de plataforma cae aquí: merece un
    // mensaje que explique qué le falta, no el error crudo de Postgres.
    const mensaje = error instanceof Error ? error.message : 'error desconocido'
    const sinPermiso = /no autorizado|permission denied|42501/i.test(mensaje)
    return (
      <div style={{ padding: 24, textAlign: 'center', color: 'var(--at-ink-2)' }}>
        <div style={{ fontSize: 28, marginBottom: 8 }}>{sinPermiso ? '🔒' : '⚠️'}</div>
        {sinPermiso
          ? 'La actividad del equipo solo es visible para administradores de la empresa.'
          : `No se pudo cargar la actividad: ${mensaje}`}
      </div>
    )
  }

  return (
    <div style={{ padding: 16 }}>
      {/* Rango */}
      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginBottom: 14, alignItems: 'center' }}>
        {RANGOS.map(r => (
          <button
            key={r.dias}
            onClick={() => setDias(r.dias)}
            style={{
              padding: '6px 14px', borderRadius: 8, cursor: 'pointer', fontSize: 13,
              border: `1.5px solid ${dias === r.dias ? 'var(--at-primary)' : 'var(--at-line)'}`,
              background: dias === r.dias ? 'var(--at-primary-tint)' : 'var(--at-surface)',
              color: dias === r.dias ? 'var(--at-primary)' : 'var(--at-ink-2)',
              fontWeight: dias === r.dias ? 700 : 500,
            }}
          >
            Últimos {r.label}
          </button>
        ))}
        <span style={{ fontSize: 12, color: 'var(--at-ink-3)', marginLeft: 'auto' }}>
          {desde} → {hasta}
        </span>
      </div>

      {/* Totales del período */}
      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginBottom: 16 }}>
        <StatTile label="Personas activas" value={filas.length} icon="👥" />
        <StatTile label="Lecturas" value={totales.lecturas} icon="💧" />
        <StatTile label="Limpieza y checklists" value={totales.limpiezas} icon="🧹" />
        <StatTile label="Rondas y puntos" value={totales.rondas} icon="🛡" />
        <StatTile label="Visitas y paquetes" value={totales.visitas} icon="🚪" />
        <StatTile
          label="Sin reportar +7 días"
          value={inactivos}
          icon="⏳"
          tone={inactivos > 0 ? 'warning' : undefined}
        />
      </div>

      <DataTable<ActividadUsuario>
        data={filas}
        rowKey="usuario_id"
        pageSize={50}
        isLoading={isLoading}
        defaultSort={{ key: 'total', direction: 'desc' }}
        searchableKeys={['usuario_nombre']}
        searchPlaceholder="Buscar persona…"
        emptyState={{ icon: '📭', title: 'Sin actividad registrada en el período' }}
        columns={[
          {
            key: 'usuario_nombre', header: 'Persona', sortable: true,
            render: (f) => <UsuarioChip userId={f.usuario_id} mostrarRol companyId={companyId} />,
          },
          { key: 'lecturas', header: 'Lecturas', sortable: true, numeric: true },
          {
            key: 'lecturas_m3', header: 'm³ leídos', sortable: true, numeric: true, hideOnMobile: true,
            render: (f) => (f.lecturas_m3 ? Number(f.lecturas_m3).toFixed(1) : '—'),
          },
          { key: 'limpiezas', header: 'Limpieza', sortable: true, numeric: true },
          { key: 'checklists', header: 'Checklists', sortable: true, numeric: true, hideOnMobile: true },
          { key: 'rondas_iniciadas', header: 'Rondas', sortable: true, numeric: true },
          { key: 'puntos_marcados', header: 'Puntos', sortable: true, numeric: true, hideOnMobile: true },
          { key: 'visitas_registradas', header: 'Visitas', sortable: true, numeric: true },
          { key: 'paquetes', header: 'Paquetes', sortable: true, numeric: true, hideOnMobile: true },
          { key: 'solicitudes_creadas', header: 'Solicitudes', sortable: true, numeric: true, hideOnMobile: true },
          { key: 'tareas_cerradas', header: 'Tareas', sortable: true, numeric: true, hideOnMobile: true },
          {
            key: 'total', header: 'Total', sortable: true, numeric: true,
            render: (f) => <strong>{f.total}</strong>,
          },
          {
            key: 'ultima_actividad', header: 'Última actividad', sortable: true,
            render: (f) => {
              if (!f.ultima_actividad) return <span style={{ color: 'var(--at-ink-3)' }}>—</span>
              const d = new Date(f.ultima_actividad)
              const dias = Math.floor((Date.now() - d.getTime()) / (24 * 3600 * 1000))
              const alerta = dias >= 7
              return (
                <span style={{ color: alerta ? 'var(--at-warning)' : 'var(--at-ink-2)', whiteSpace: 'nowrap' }}>
                  {d.toLocaleDateString('es', { day: '2-digit', month: 'short' })}
                  {dias > 0 && <span style={{ fontSize: 11 }}> · hace {dias}d</span>}
                </span>
              )
            },
          },
        ] satisfies DataTableColumn<ActividadUsuario>[]}
      />
    </div>
  )
}
