// Tab «Configuración» (Recursos Humanos) — EL lugar donde el condominio define
// sus cargos y sus tipos de turno (rrhh_cargos / rrhh_tipos_turno,
// 20261031000300). Los demás tabs sólo eligen de aquí: Personal (la ficha),
// Actividades (plantillas por cargo), Limpieza (programaciones y ruta del día)
// y la carga masiva de actividades.
//
// El tab no agrega lógica sobre CatalogoRrhhPanel: le pone contexto (quién
// consume cada catálogo, qué significa desactivar) y carga el «en uso» de cada
// código (rrhh_cargo_en_uso / rrhh_turno_en_uso) para que la tarjeta ofrezca
// borrar sólo cuando nadie lo usa.
import { useEffect, useState } from 'react'
import { CatalogoRrhhPanel } from '../CatalogoRrhhPanel'
import { fetchUsoCatalogoRrhh } from '../../../domain/condominios/tabQueries'
import type { CargoCatalogo, TipoTurnoCatalogo, UsoCargo, UsoTurno } from '../../../types'

interface Props {
  cargos: CargoCatalogo[]
  tiposTurno: TipoTurnoCatalogo[]
  proyectoId: string
  companyId: string
  canCreate: boolean
  canEdit: boolean
  canDelete: boolean
  onRefresh: () => void
}

const CONSUMIDORES_CARGO = [
  { icon: '👥', label: 'Personal',    detalle: 'cargo de cada empleado' },
  { icon: '📋', label: 'Actividades', detalle: 'plantillas por cargo y carga masiva' },
  { icon: '🧹', label: 'Limpieza',    detalle: 'a qué cargo le toca cada área' },
  { icon: '⚙️', label: 'Tareas por turno', detalle: 'cargar las actividades del cargo' },
]
const CONSUMIDORES_TURNO = [
  { icon: '👥', label: 'Personal', detalle: 'turno del expediente' },
  { icon: '🧹', label: 'Limpieza', detalle: 'programaciones y ruta del día' },
]

export function RrhhConfiguracionTab({ cargos, tiposTurno, proyectoId, companyId, canCreate, canEdit, canDelete, onRefresh }: Props) {
  const [usoCargos, setUsoCargos] = useState<Map<string, UsoCargo | UsoTurno>>(new Map())
  const [usoTurnos, setUsoTurnos] = useState<Map<string, UsoCargo | UsoTurno>>(new Map())

  const codigosCargo = cargos.map(c => c.codigo).join('|')
  const codigosTurno = tiposTurno.map(t => t.codigo).join('|')
  useEffect(() => {
    let vivo = true
    void fetchUsoCatalogoRrhh('cargo', proyectoId, codigosCargo ? codigosCargo.split('|') : []).then(m => { if (vivo) setUsoCargos(m) })
    return () => { vivo = false }
  }, [proyectoId, codigosCargo])
  useEffect(() => {
    let vivo = true
    void fetchUsoCatalogoRrhh('turno', proyectoId, codigosTurno ? codigosTurno.split('|') : []).then(m => { if (vivo) setUsoTurnos(m) })
    return () => { vivo = false }
  }, [proyectoId, codigosTurno])

  const activosC = cargos.filter(c => c.activo).length
  const activosT = tiposTurno.filter(t => t.activo).length

  return (
    <div style={{ padding: '24px', maxWidth: '1100px' }}>
      <div style={{ marginBottom: '18px' }}>
        <h2 style={{ margin: 0, fontSize: '20px', fontWeight: 700, color: 'var(--at-ink)' }}>Configuración de Recursos Humanos</h2>
        <p style={{ margin: '4px 0 0', color: 'var(--at-ink-3)', fontSize: '13.5px' }}>
          {cargos.length} cargos ({activosC} activos) · {tiposTurno.length} tipos de turno ({activosT} activos) · se configuran una vez y el resto del área los usa
        </p>
      </div>

      <Seccion titulo="Cargos" subtitulo="Lo que se asigna a cada empleado y agrupa las actividades." consumidores={CONSUMIDORES_CARGO}>
        <CatalogoRrhhPanel tipo="cargo" items={cargos} uso={usoCargos} proyectoId={proyectoId} companyId={companyId}
          canCreate={canCreate} canEdit={canEdit} canDelete={canDelete} onRefresh={onRefresh} />
      </Seccion>

      <Seccion titulo="Tipos de turno" subtitulo="El turno del expediente del empleado (diurno, nocturno…). Las jornadas con horario se arman en Asignación de turnos." consumidores={CONSUMIDORES_TURNO}>
        <CatalogoRrhhPanel tipo="turno" items={tiposTurno} uso={usoTurnos} proyectoId={proyectoId} companyId={companyId}
          canCreate={canCreate} canEdit={canEdit} canDelete={canDelete} onRefresh={onRefresh} />
      </Seccion>
    </div>
  )
}

function Seccion({ titulo, subtitulo, consumidores, children }: {
  titulo: string; subtitulo: string
  consumidores: { icon: string; label: string; detalle: string }[]
  children: React.ReactNode
}) {
  return (
    <section style={{ marginBottom: '28px' }}>
      <h3 style={{ margin: '0 0 2px', fontSize: '16px', fontWeight: 700, color: 'var(--at-ink)' }}>{titulo}</h3>
      <p style={{ margin: '0 0 10px', color: 'var(--at-ink-3)', fontSize: '13px' }}>{subtitulo}</p>
      <div style={{ background: 'var(--at-accent-tint-2)', border: '1px solid var(--at-line)', borderRadius: '14px', padding: '12px 16px', marginBottom: '14px' }}>
        <div style={{ fontSize: '12.5px', fontWeight: 700, color: 'var(--at-ink-2)', marginBottom: '8px' }}>Aquí se definen. Los demás tabs los eligen de esta lista:</div>
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: '8px' }}>
          {consumidores.map(c => (
            <span key={c.label} style={{ display: 'inline-flex', alignItems: 'center', gap: '6px', background: 'var(--at-surface)', border: '1px solid var(--at-line)', borderRadius: '999px', padding: '5px 12px', fontSize: '12px', color: 'var(--at-ink-2)' }}>
              <span>{c.icon}</span>
              <strong style={{ fontWeight: 700 }}>{c.label}</strong>
              <span style={{ color: 'var(--at-ink-3)' }}>· {c.detalle}</span>
            </span>
          ))}
        </div>
        <div style={{ fontSize: '11.5px', color: 'var(--at-ink-3)', marginTop: '10px' }}>
          Uno en uso no se puede eliminar: se desactiva. Deja de ofrecerse al capturar y las fichas que ya lo tienen lo siguen mostrando. El código no se cambia una vez creado.
        </div>
      </div>
      {children}
    </section>
  )
}
