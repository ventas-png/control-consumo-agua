// Formularios de novedad y de inicio de ronda, en ventana (pantalla completa
// en el teléfono). Antes iban encima de la lista, empujándola; ahora no se
// cierran mientras guardan y, si guardar falla, conservan lo escrito.
import type { CSSProperties } from 'react'
import { MultiImageUploader } from '../../../shared/ImageUploader'
import { EditModal } from '../../../shared/EditModal'
import { Button } from '../../../shared/Button'
import type { TipoNovedad, PrioridadNovedad } from '../../../../types'
import type { SeguridadCtx } from './ctx'
import { TIPO_NOVEDAD_CONFIG } from './ui'

const lbl: CSSProperties = { fontSize: '12px', fontWeight: 600, color: 'var(--at-ink-2)', display: 'block', marginBottom: '4px' }
const inp: CSSProperties = { width: '100%', boxSizing: 'border-box', minWidth: 0, padding: '9px 12px', border: '1.5px solid var(--at-line)', borderRadius: '8px', fontSize: '14px', background: 'var(--at-surface-2)', color: 'var(--at-ink)' }

export function NovedadForm({ ctx }: { ctx: SeguridadCtx }) {
  const {
    rondaEnCurso, saving, novedadForm, setNovedadForm,
    fotosNovedadForm, setFotosNovedadForm, setShowNovedadForm, registrarNovedad,
  } = ctx

  const cerrar = () => { if (!saving) { setShowNovedadForm(false); setFotosNovedadForm([]) } }

  return (
    <EditModal
      title="Registrar novedad"
      maxWidth="600px"
      fullScreenOnMobile
      onClose={cerrar}
      closeOnBackdropClick={!saving}
      closeOnEscape={!saving}
      footer={
        <>
          <Button variant="secondary" onClick={cerrar} disabled={saving}>Cancelar</Button>
          <Button type="submit" form="seguridad-novedad-form" loading={saving} loadingText="Guardando…">Registrar</Button>
        </>
      }
    >
      <form
        id="seguridad-novedad-form"
        onSubmit={e => { e.preventDefault(); void registrarNovedad() }}
        style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(min(100%, 180px), 1fr))', gap: '14px', alignItems: 'start' }}
      >
        <div>
          <label htmlFor="novedad-tipo" style={lbl}>Tipo</label>
          <select id="novedad-tipo" value={novedadForm.tipo} onChange={e => setNovedadForm(f => ({ ...f, tipo: e.target.value as TipoNovedad }))} style={inp}>
            {(Object.entries(TIPO_NOVEDAD_CONFIG) as [TipoNovedad, typeof TIPO_NOVEDAD_CONFIG[TipoNovedad]][]).map(([v, c]) => (
              <option key={v} value={v}>{c.icon} {c.label}</option>
            ))}
          </select>
        </div>
        <div>
          <label htmlFor="novedad-prioridad" style={lbl}>Prioridad</label>
          <select id="novedad-prioridad" value={novedadForm.prioridad} onChange={e => setNovedadForm(f => ({ ...f, prioridad: e.target.value as PrioridadNovedad }))} style={inp}>
            <option value="normal">Normal</option>
            <option value="alta">Alta</option>
            <option value="critica">Crítica</option>
          </select>
        </div>
        <div style={{ gridColumn: '1 / -1' }}>
          <label htmlFor="novedad-descripcion" style={lbl}>Descripción *</label>
          <textarea id="novedad-descripcion" value={novedadForm.descripcion} onChange={e => setNovedadForm(f => ({ ...f, descripcion: e.target.value }))}
            placeholder="Detalle la novedad..." rows={3}
            style={{ ...inp, resize: 'vertical', fontFamily: 'inherit' }} />
        </div>
        <div>
          <label htmlFor="novedad-ubicacion" style={lbl}>Ubicación</label>
          <input id="novedad-ubicacion" value={novedadForm.ubicacion} onChange={e => setNovedadForm(f => ({ ...f, ubicacion: e.target.value }))} placeholder="Ej. Entrada principal, Nivel 3..." style={inp} />
        </div>
        {rondaEnCurso && (
          <div>
            <span style={lbl}>Vincular a ronda actual</span>
            <label style={{ display: 'flex', alignItems: 'center', gap: '8px', fontSize: '13.5px', color: 'var(--at-ink-2)', cursor: 'pointer', marginTop: '8px' }}>
              <input type="checkbox" checked={novedadForm.ronda_id === rondaEnCurso.id}
                onChange={e => setNovedadForm(f => ({ ...f, ronda_id: e.target.checked ? rondaEnCurso.id : '' }))} />
              Sí, vincular a esta ronda
            </label>
          </div>
        )}
        <div style={{ gridColumn: '1 / -1' }}>
          <MultiImageUploader
            values={fotosNovedadForm}
            onChange={setFotosNovedadForm}
            folder="novedades"
            label="Fotografías de evidencia (opcional)"
            capture
            maxFiles={10}
          />
        </div>
      </form>
    </EditModal>
  )
}

export function RondaForm({ ctx }: { ctx: SeguridadCtx }) {
  const { saving, rondaForm, setRondaForm, setShowRondaForm, iniciarRonda, rutasActivas, puntosControl } = ctx

  const cerrar = () => { if (!saving) setShowRondaForm(false) }

  return (
    <EditModal
      title="🛡 Iniciar ronda de seguridad"
      maxWidth="520px"
      fullScreenOnMobile
      onClose={cerrar}
      closeOnBackdropClick={!saving}
      closeOnEscape={!saving}
      footer={
        <>
          <Button variant="secondary" onClick={cerrar} disabled={saving}>Cancelar</Button>
          <Button type="submit" form="seguridad-ronda-form" loading={saving} loadingText="Iniciando…">🛡 Iniciar ahora</Button>
        </>
      }
    >
      <form
        id="seguridad-ronda-form"
        onSubmit={e => { e.preventDefault(); void iniciarRonda() }}
        style={{ display: 'grid', gap: '14px' }}
      >
        <div>
          <label htmlFor="ronda-ruta" style={lbl}>Ruta de ronda</label>
          <select id="ronda-ruta" value={rondaForm.ruta_id} onChange={e => setRondaForm(f => ({ ...f, ruta_id: e.target.value }))} style={inp}>
            <option value="">Sin ruta específica</option>
            {rutasActivas.map(r => {
              const cantPuntos = puntosControl.filter(p => p.ruta_id === r.id).length
              return <option key={r.id} value={r.id}>{r.nombre} ({cantPuntos} punto{cantPuntos !== 1 ? 's' : ''}{r.tiempo_estimado_min ? ` · ~${r.tiempo_estimado_min} min` : ''})</option>
            })}
          </select>
          {rondaForm.ruta_id && (
            <p style={{ margin: '6px 0 0', fontSize: '12px', color: 'var(--at-accent)' }}>
              🗺 Se generará automáticamente el checklist de puntos de control.
            </p>
          )}
        </div>
        <div>
          <label htmlFor="ronda-notas" style={lbl}>Notas (opcional)</label>
          <input id="ronda-notas" value={rondaForm.notas} onChange={e => setRondaForm(f => ({ ...f, notas: e.target.value }))} placeholder="Observaciones iniciales..." style={inp} />
        </div>
      </form>
    </EditModal>
  )
}
