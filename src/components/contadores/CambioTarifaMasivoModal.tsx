// Cambio masivo de tarifa: reasigna de una vez la tarifa de todos los
// contadores que cumplen un criterio (proyecto, tipología y tarifa actual),
// en vez de editarlos uno por uno.
import { useMemo, useState } from 'react'
import { EditModal } from '../shared/EditModal'
import { notify } from '../shared/Dialog'
import { useSession } from '../shared/SessionContext'
import type { Contador, Proyecto, Tarifa, TipoAgua } from '../../types'
import { asignarTarifaMasiva } from '../../domain/contadores/mutations'
import { contadoresParaCambioTarifa, SIN_TARIFA, tarifasParaTipo } from '../../lib/contadoresReglas'
import { inputStyle, labelStyle, TIPOS_AGUA } from './ui'

interface Props {
  contadores: Contador[]
  tarifas: Tarifa[]
  proyectos: Proyecto[]
  moneda: string
  tipoInicial: TipoAgua | ''
  onClose: () => void
  onAplicado: (ids: string[], tarifaId: string) => void
}

export function CambioTarifaMasivoModal({ contadores, tarifas, proyectos, moneda, tipoInicial, onClose, onAplicado }: Props) {
  const currentUser = useSession()
  // Solo las tipologías y proyectos que de verdad tienen contadores.
  const tipos = TIPOS_AGUA.filter(t => contadores.some(c => c.tipo_agua === t.value))
  const proyectosConContadores = proyectos.filter(p => contadores.some(c => c.project_id === p.id))

  const [projectId, setProjectId] = useState('')
  const [tipoAgua, setTipoAgua] = useState<TipoAgua>(tipoInicial || tipos[0]?.value || 'potable')
  const [tarifaActual, setTarifaActual] = useState('')
  const [nuevaTarifaId, setNuevaTarifaId] = useState('')
  const [guardando, setGuardando] = useState(false)

  const enAlcance = contadores.filter(c => c.tipo_agua === tipoAgua && (!projectId || c.project_id === projectId))
  // "Tarifa actual" ofrece las que hoy usan esos contadores, aunque estén inactivas o vencidas.
  const tarifasEnUso = tarifas.filter(t => enAlcance.some(c => c.tarifa_id === t.id))
  const sinTarifa = enAlcance.filter(c => !c.tarifa_id).length
  const tarifasNuevas = tarifasParaTipo(tarifas, tipoAgua)
  const nuevaTarifa = tarifasNuevas.find(t => t.id === nuevaTarifaId)

  const afectados = useMemo(
    () => (nuevaTarifaId ? contadoresParaCambioTarifa(contadores, { projectId, tipoAgua, tarifaActual, nuevaTarifaId }) : []),
    [contadores, projectId, tipoAgua, tarifaActual, nuevaTarifaId],
  )

  const describeTarifa = (t: Tarifa) =>
    `${t.nombre} — ${t.precio_m3} ${moneda}/m³${t.canon_fijo > 0 ? ` + ${t.canon_fijo} ${moneda} canon` : ''}`

  async function aplicar() {
    if (!nuevaTarifa || afectados.length === 0) return
    setGuardando(true)
    const { actualizados, error } = await asignarTarifaMasiva(afectados.map(c => c.id), nuevaTarifa.id, {
      updated_by: currentUser.user_id ?? null,
      updated_by_name: currentUser.name || currentUser.email || null,
    })
    setGuardando(false)
    if (actualizados.length > 0) onAplicado(actualizados, nuevaTarifa.id)

    if (error) {
      notify({
        variant: 'error',
        title: 'El cambio quedó incompleto',
        text: `Se actualizaron ${actualizados.length} de ${afectados.length} contadores. ${error}`,
      })
      return
    }
    if (actualizados.length < afectados.length) {
      notify({
        variant: 'warning',
        title: 'Cambio parcial',
        text: `Se actualizaron ${actualizados.length} de ${afectados.length} contadores; no tienes permiso para modificar el resto.`,
      })
    } else {
      notify({
        variant: 'success',
        title: 'Tarifa actualizada',
        text: `${actualizados.length} contador${actualizados.length !== 1 ? 'es' : ''} ahora usa${actualizados.length !== 1 ? 'n' : ''} "${nuevaTarifa.nombre}".`,
      })
    }
    onClose()
  }

  const puedeAplicar = !!nuevaTarifa && afectados.length > 0 && !guardando

  return (
    <EditModal
      title="Cambiar tarifa a varios contadores"
      onClose={onClose}
      maxWidth="640px"
      fullScreenOnMobile
      closeOnBackdropClick={!guardando}
      closeOnEscape={!guardando}
    >
      <p style={{ margin: '0 0 16px', fontSize: '13px', color: 'var(--at-ink-3)' }}>
        Elige a qué contadores aplica y la tarifa nueva. El cambio rige para las lecturas que se
        registren a partir de ahora; los cobros ya generados no se modifican.
      </p>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(240px, 1fr))', gap: '16px', marginBottom: '16px' }}>
        {proyectosConContadores.length > 1 && (
          <div>
            <label htmlFor="cmt-proyecto" style={labelStyle}>Proyecto</label>
            <select
              id="cmt-proyecto"
              style={inputStyle}
              value={projectId}
              onChange={e => { setProjectId(e.target.value); setTarifaActual('') }}
            >
              <option value="">Todos los proyectos</option>
              {proyectosConContadores.map(p => <option key={p.id} value={p.id}>{p.nombre}</option>)}
            </select>
          </div>
        )}
        <div>
          <label htmlFor="cmt-tipo" style={labelStyle}>Tipología / Tipo de Agua</label>
          <select
            id="cmt-tipo"
            style={inputStyle}
            value={tipoAgua}
            onChange={e => { setTipoAgua(e.target.value as TipoAgua); setTarifaActual(''); setNuevaTarifaId('') }}
          >
            {tipos.map(t => <option key={t.value} value={t.value}>{t.label}</option>)}
          </select>
        </div>
        <div>
          <label htmlFor="cmt-actual" style={labelStyle}>Tarifa actual</label>
          <select id="cmt-actual" style={inputStyle} value={tarifaActual} onChange={e => setTarifaActual(e.target.value)}>
            <option value="">Cualquiera ({enAlcance.length})</option>
            {sinTarifa > 0 && <option value={SIN_TARIFA}>Sin tarifa asignada ({sinTarifa})</option>}
            {tarifasEnUso.map(t => (
              <option key={t.id} value={t.id}>
                {t.nombre} ({enAlcance.filter(c => c.tarifa_id === t.id).length})
              </option>
            ))}
          </select>
        </div>
        <div>
          <label htmlFor="cmt-nueva" style={labelStyle}>Nueva tarifa *</label>
          <select id="cmt-nueva" style={inputStyle} value={nuevaTarifaId} onChange={e => setNuevaTarifaId(e.target.value)}>
            <option value="">— Seleccionar —</option>
            {tarifasNuevas.map(t => <option key={t.id} value={t.id}>{describeTarifa(t)}</option>)}
            {tarifasNuevas.length === 0 && <option disabled value="">No hay tarifas activas para este tipo</option>}
          </select>
        </div>
      </div>

      <div
        role="status"
        style={{
          padding: '12px 14px', borderRadius: '8px', marginBottom: '20px', fontSize: '14px',
          background: 'var(--at-chip)', color: 'var(--at-ink-2)',
        }}
      >
        {!nuevaTarifa
          ? 'Selecciona la nueva tarifa para ver cuántos contadores cambiarían.'
          : afectados.length === 0
            ? 'Ningún contador cambiaría con este criterio.'
            : (
              <>
                <strong>{afectados.length} contador{afectados.length !== 1 ? 'es' : ''}</strong> pasará{afectados.length !== 1 ? 'n' : ''} a
                “{nuevaTarifa.nombre}”.
                <div style={{ marginTop: 4, fontSize: '12px', color: 'var(--at-ink-3)' }}>
                  {afectados.slice(0, 6).map(c => c.numero_serie).join(', ')}
                  {afectados.length > 6 ? ` y ${afectados.length - 6} más` : ''}
                </div>
              </>
            )}
      </div>

      <div style={{ display: 'flex', gap: '10px', flexWrap: 'wrap' }}>
        <button
          onClick={aplicar}
          disabled={!puedeAplicar}
          style={{
            padding: '10px 24px',
            background: puedeAplicar ? 'linear-gradient(135deg, var(--at-cta), var(--at-cta-2))' : 'var(--at-ink-3)',
            color: 'white', border: 'none', borderRadius: '8px', fontWeight: 600, fontSize: '14px',
            cursor: puedeAplicar ? 'pointer' : 'not-allowed',
          }}
        >
          {guardando ? 'Aplicando...' : afectados.length > 0 ? `Cambiar tarifa a ${afectados.length}` : 'Cambiar tarifa'}
        </button>
        <button
          onClick={onClose}
          disabled={guardando}
          style={{
            padding: '10px 24px', background: 'var(--at-chip)', color: 'var(--at-ink-2)',
            border: 'none', borderRadius: '8px', fontWeight: 600, cursor: 'pointer', fontSize: '14px',
          }}
        >
          Cancelar
        </button>
      </div>
    </EditModal>
  )
}
