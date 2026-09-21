// Cierre de una parada de la ronda cuando hace falta más que un clic:
// la novedad (que siempre necesita describirse) y el punto que EXIGE IMAGEN
// (`puntos_verificacion.requiere_foto`, con override por ruta — 20260921000100).
//
// Por qué un modal y no el prompt de texto que había: marcar un punto pasó de
// ser "sí / no / lo salto" a ser un acta — qué se encontró y con qué se prueba.
// La BD lo respalda: `trg_visitas_control_evidencia` rechaza el cierre sin foto
// donde el punto la pide, así que esta pantalla no es la regla, es lo que evita
// que la persona choque contra ella.
import { MultiImageUploader } from '../../../shared/ImageUploader'
import { ModalPortal } from '../../../shared/ModalPortal'
import { puntoExigeFoto } from '../../../../types'
import type { SeguridadCtx } from './ctx'

export function MarcarPuntoModal({ ctx }: { ctx: SeguridadCtx }) {
  const {
    marcandoPunto, setMarcandoPunto, notasPunto, setNotasPunto,
    fotosPunto, setFotosPunto, saving, confirmarMarcaPunto, areas,
  } = ctx

  if (!marcandoPunto) return null

  const { punto, estado } = marcandoPunto
  const area = areas.find(a => a.id === punto.area_id)
  const exigeFoto = puntoExigeFoto(punto)
  const esNovedad = estado === 'novedad'
  const faltaTexto = esNovedad && !notasPunto.trim()
  const faltaFoto = exigeFoto && fotosPunto.length === 0
  const acento = esNovedad ? 'var(--at-warning)' : 'var(--at-success)'

  return (
    <ModalPortal>
      <div onClick={() => setMarcandoPunto(null)}
        style={{ position: 'fixed', inset: 0, background: 'rgba(15,23,42,0.6)', backdropFilter: 'blur(3px)', zIndex: 1000, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '16px' }}>
        <div onClick={e => e.stopPropagation()} role="dialog" aria-modal="true" aria-label={esNovedad ? 'Registrar novedad en el punto' : 'Cerrar punto de la ronda'}
          style={{ background: 'var(--at-surface)', borderRadius: '16px', width: '100%', maxWidth: '480px', boxShadow: '0 20px 60px rgba(0,0,0,0.3)', overflow: 'hidden', maxHeight: '90vh', display: 'flex', flexDirection: 'column' }}>
          <div style={{ height: '6px', background: acento }} />

          <div style={{ padding: '18px 22px', borderBottom: '1px solid var(--at-chip)', display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: '12px' }}>
            <div style={{ display: 'flex', gap: '11px', alignItems: 'center', minWidth: 0 }}>
              <span style={{ fontSize: '26px', lineHeight: 1 }}>{area?.icono ?? '📍'}</span>
              <div style={{ minWidth: 0 }}>
                <div style={{ fontSize: '16px', fontWeight: 800, color: 'var(--at-ink)' }}>
                  {punto.punto_nombre ?? area?.nombre ?? 'Punto de control'}
                </div>
                <div style={{ fontSize: '12px', color: 'var(--at-ink-3)', marginTop: '2px' }}>
                  {esNovedad ? 'Registrar novedad' : 'Marcar como verificado'}
                  {punto.punto_nombre && area ? ` · ${area.nombre}` : ''}
                </div>
              </div>
            </div>
            <button onClick={() => setMarcandoPunto(null)} aria-label="Cerrar"
              style={{ background: 'var(--at-chip)', border: 'none', borderRadius: '8px', color: 'var(--at-ink-3)', cursor: 'pointer', fontSize: '18px', lineHeight: 1, padding: '6px 10px', flexShrink: 0 }}>
              ✕
            </button>
          </div>

          <div style={{ padding: '18px 22px', display: 'flex', flexDirection: 'column', gap: '14px', overflowY: 'auto' }}>
            {punto.instrucciones && (
              <div style={{ padding: '10px 12px', background: 'var(--at-surface-2)', border: '1px solid var(--at-line)', borderRadius: '9px', fontSize: '12.5px', color: 'var(--at-ink-2)' }}>
                <strong style={{ display: 'block', fontSize: '11px', textTransform: 'uppercase', letterSpacing: '0.06em', color: 'var(--at-ink-3)', marginBottom: '3px' }}>Instrucciones</strong>
                {punto.instrucciones}
              </div>
            )}

            <div>
              <label htmlFor="mp-notas" style={{ fontSize: '12px', fontWeight: 600, color: 'var(--at-ink-2)', display: 'block', marginBottom: '4px' }}>
                {esNovedad ? 'Novedad *' : 'Observaciones'}
              </label>
              <textarea id="mp-notas" value={notasPunto} onChange={e => setNotasPunto(e.target.value)} rows={esNovedad ? 4 : 2}
                autoFocus={esNovedad}
                placeholder={esNovedad ? 'Describe la novedad encontrada...' : 'Opcional: algo que valga la pena dejar anotado.'}
                style={{ width: '100%', boxSizing: 'border-box', padding: '9px 12px', border: '1.5px solid var(--at-line)', borderRadius: '8px', fontSize: '14px', background: 'var(--at-surface-2)', resize: 'vertical', fontFamily: 'inherit' }} />
            </div>

            <div>
              <MultiImageUploader
                values={fotosPunto}
                onChange={setFotosPunto}
                folder="rondas"
                label={exigeFoto ? 'Evidencia fotográfica *' : 'Evidencia fotográfica'}
                maxFiles={4}
                capture
              />
              {exigeFoto && (
                <p style={{ margin: '6px 0 0', fontSize: '12px', color: faltaFoto ? 'var(--at-danger)' : 'var(--at-ink-3)' }}>
                  📷 Este punto exige al menos una imagen para cerrarse.
                </p>
              )}
            </div>
          </div>

          <div style={{ padding: '14px 22px', borderTop: '1px solid var(--at-chip)', display: 'flex', gap: '10px' }}>
            <button onClick={confirmarMarcaPunto} disabled={saving || faltaTexto || faltaFoto}
              style={{ padding: '10px 22px', background: (faltaTexto || faltaFoto) ? 'var(--at-chip)' : acento, color: (faltaTexto || faltaFoto) ? 'var(--at-ink-3)' : 'white', border: 'none', borderRadius: '8px', fontWeight: 700, cursor: (faltaTexto || faltaFoto) ? 'default' : 'pointer', fontSize: '13.5px' }}>
              {saving ? 'Guardando...' : esNovedad ? 'Registrar novedad' : 'Confirmar punto'}
            </button>
            <button onClick={() => setMarcandoPunto(null)}
              style={{ padding: '10px 18px', background: 'var(--at-surface-2)', color: 'var(--at-ink-2)', border: '1px solid var(--at-line)', borderRadius: '8px', cursor: 'pointer', fontSize: '13.5px' }}>
              Cancelar
            </button>
          </div>
        </div>
      </div>
    </ModalPortal>
  )
}
