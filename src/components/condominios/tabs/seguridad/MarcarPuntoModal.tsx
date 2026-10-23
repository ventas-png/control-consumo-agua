// Cierre de una parada de la ronda cuando hace falta más que un clic:
// la novedad (que siempre necesita describirse) y el punto que EXIGE IMAGEN
// (`puntos_verificacion.requiere_foto`, con override por ruta — 20260921000100).
//
// Por qué un modal y no el prompt de texto que había: marcar un punto pasó de
// ser "sí / no / lo salto" a ser un acta — qué se encontró y con qué se prueba.
// La BD lo respalda: `trg_visitas_control_evidencia` rechaza el cierre sin foto
// donde el punto la pide, así que esta pantalla no es la regla, es lo que evita
// que la persona choque contra ella.
//
// En ventana a pantalla completa en el teléfono (donde se usa, caminando la
// ronda). Mientras guarda no se cierra, y si guardar falla sigue abierta con lo
// escrito y las fotos.
import { MultiImageUploader } from '../../../shared/ImageUploader'
import { EditModal } from '../../../shared/EditModal'
import { Button } from '../../../shared/Button'
import { puntoExigeFoto } from '../../../../types'
import type { SeguridadCtx } from './ctx'

export function MarcarPuntoModal({ ctx }: { ctx: SeguridadCtx }) {
  const {
    marcandoPunto, setMarcandoPunto, notasPunto, setNotasPunto,
    fotosPunto, setFotosPunto, saving, confirmarMarcaPunto, areas,
  } = ctx

  if (!marcandoPunto) return null

  const { punto, estado } = marcandoPunto
  // El área del catálogo si se cargó; si no, lo que trae el punto de su ruta.
  const area = areas.find(a => a.id === punto.area_id)
  const areaIcono = area?.icono ?? punto.area_icono ?? '📍'
  const areaNombre = area?.nombre ?? punto.area_nombre
  const exigeFoto = puntoExigeFoto(punto)
  const esNovedad = estado === 'novedad'
  const faltaTexto = esNovedad && !notasPunto.trim()
  const faltaFoto = exigeFoto && fotosPunto.length === 0
  const cerrar = () => { if (!saving) setMarcandoPunto(null) }

  return (
    <EditModal
      title={`${areaIcono} ${punto.punto_nombre ?? areaNombre ?? 'Punto de control'}`}
      subtitle={`${esNovedad ? 'Registrar novedad' : 'Marcar como verificado'}${punto.punto_nombre && areaNombre ? ` · ${areaNombre}` : ''}`}
      maxWidth="480px"
      fullScreenOnMobile
      onClose={cerrar}
      closeOnBackdropClick={!saving}
      closeOnEscape={!saving}
      footer={
        <>
          <Button variant="secondary" onClick={cerrar} disabled={saving}>Cancelar</Button>
          <Button variant={esNovedad ? 'warning' : 'success'} onClick={() => void confirmarMarcaPunto()} disabled={faltaTexto || faltaFoto}
            loading={saving} loadingText="Guardando…">
            {esNovedad ? 'Registrar novedad' : 'Confirmar punto'}
          </Button>
        </>
      }
    >
      <div style={{ display: 'flex', flexDirection: 'column', gap: '14px' }}>
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
            style={{ width: '100%', boxSizing: 'border-box', padding: '9px 12px', border: '1.5px solid var(--at-line)', borderRadius: '8px', fontSize: '14px', background: 'var(--at-surface-2)', color: 'var(--at-ink)', resize: 'vertical', fontFamily: 'inherit' }} />
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
    </EditModal>
  )
}
