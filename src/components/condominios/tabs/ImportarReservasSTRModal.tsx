// Carga masiva de reservas STR de un proyecto desde una plantilla propia (CSV / XLSX).
//
// Flujo: bajar plantilla → subir archivo → VISTA PREVIA (el servidor valida cada fila, resuelve
// la unidad por nombre, detecta códigos repetidos y solapes, y guarda el lote; todavía NO hay
// reservas) → confirmar. Es todo o nada: con una sola fila en error no se guarda nada. Importar
// nunca cancela, modifica ni elimina reservas, y nunca crea unidades. Doble clic o reintento no
// duplican: el servidor devuelve el resultado del lote ya aplicado.
import { useMemo, useRef, useState } from 'react'
import { EditModal } from '../../shared'
import { StatusBadge } from '../../shared/StatusBadge'
import { confirm, notify } from '../../shared/Dialog'
import {
  MAX_FILAS_STR,
  PLANTILLA_RESERVAS_STR,
  aplicarReservasSTR,
  csvPlantillaSTR,
  descartarReservasSTR,
  leerArchivoReservasSTR,
  previsualizarReservasSTR,
  totalVistaPrevia,
  xlsxPlantillaSTR,
} from '../../../domain/condominios/strImportacion'
import { ArchivoImportacionError, MAX_BYTES_ARCHIVO } from '../../../domain/proveedores/importacion'
import type { VistaPreviaImportacionSTR } from '../../../types'
import { btnLink, btnPrimario, btnSecundario, input } from '../../contabilidad/ui'

interface Props {
  proyectoId: string
  proyectoNombre?: string
  moneda: string
  onClose: () => void
  /** Se llama tras guardar (para recargar la pestaña). */
  onImportado: () => void
}

function descargar(contenido: BlobPart, nombre: string, tipo: string) {
  const url = URL.createObjectURL(new Blob([contenido], { type: tipo }))
  const a = document.createElement('a')
  a.href = url
  a.download = nombre
  document.body.appendChild(a)
  a.click()
  a.remove()
  URL.revokeObjectURL(url)
}

const fmtMonto = (moneda: string, n: number | null | undefined) =>
  n === null || n === undefined ? '' : `${moneda} ${n.toFixed(2)}`

export function ImportarReservasSTRModal({ proyectoId, proyectoNombre, moneda, onClose, onImportado }: Props) {
  const [vista, setVista] = useState<VistaPreviaImportacionSTR | null>(null)
  const [avisos, setAvisos] = useState<string[]>([])
  const [errorArchivo, setErrorArchivo] = useState<string | null>(null)
  const [soloErrores, setSoloErrores] = useState(false)
  const [nombre, setNombre] = useState('')
  const [validando, setValidando] = useState(false)
  const [guardando, setGuardando] = useState(false)
  const [guardado, setGuardado] = useState(false)
  const inputRef = useRef<HTMLInputElement>(null)
  // Guarda contra el doble clic: el servidor es idempotente, pero la pantalla tampoco debe mandarlo dos veces.
  const enCurso = useRef(false)

  const filasVisibles = useMemo(
    () => (vista?.filas ?? []).filter((f) => !soloErrores || f.errores.length > 0),
    [vista, soloErrores],
  )
  const total = useMemo(() => totalVistaPrevia(vista), [vista])

  async function elegirArchivo(file: File | undefined) {
    setVista(null)
    setAvisos([])
    setErrorArchivo(null)
    if (!file) return
    setNombre(file.name)
    setValidando(true)
    try {
      const leido = await leerArchivoReservasSTR(file.name, await file.arrayBuffer())
      setAvisos(leido.advertencias)
      const v = await previsualizarReservasSTR(proyectoId, leido.filas, file.name)
      setVista(v)
    } catch (e) {
      setErrorArchivo(e instanceof ArchivoImportacionError || e instanceof Error ? e.message : 'No se pudo leer el archivo.')
    } finally {
      setValidando(false)
    }
  }

  async function confirmar() {
    if (!vista || enCurso.current) return
    enCurso.current = true
    try {
      await guardar(vista)
    } finally {
      enCurso.current = false
    }
  }

  async function guardar(vista: VistaPreviaImportacionSTR) {
    const { isConfirmed } = await confirm({
      title: 'Guardar reservas',
      text: `Se crearán ${vista.resumen.validas} reservas confirmadas en ${proyectoNombre ?? 'este proyecto'}${total > 0 ? ` (total ${fmtMonto(moneda, total)})` : ''}. No se cancela, modifica ni elimina ninguna reserva existente.`,
      confirmText: 'Guardar',
    })
    if (!isConfirmed) return
    setGuardando(true)
    try {
      const r = await aplicarReservasSTR(vista.lote_id)
      setGuardado(true)
      notify({
        variant: 'success', title: 'Listo',
        text: r.reutilizada ? 'Este archivo ya se había guardado: no se duplicó nada.' : `${r.reservas_creadas} reservas creadas en el proyecto.`,
      })
      onImportado()
      onClose()
    } catch (e) {
      notify({ variant: 'error', title: 'No se guardó nada', text: e instanceof Error ? e.message : 'Error inesperado.' })
    } finally {
      setGuardando(false)
    }
  }

  async function cerrar() {
    if (vista && !guardado) {
      try { await descartarReservasSTR(vista.lote_id) } catch { /* el lote sin aplicar no estorba */ }
    }
    onClose()
  }

  const conError = vista?.resumen.con_error ?? 0
  const duplicado = vista?.resumen.duplicado_de_lote_aplicado ?? false
  const puedeGuardar = !!vista && conError === 0 && !duplicado && vista.resumen.validas > 0 && !guardando

  return (
    <EditModal
      title={`Carga masiva de reservas STR${proyectoNombre ? ` · ${proyectoNombre}` : ''}`}
      onClose={() => void cerrar()}
      size="lg"
      footer={
        <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end', alignItems: 'center', flexWrap: 'wrap' }}>
          {vista && <span style={{ fontSize: 12, color: 'var(--at-ink-soft)', marginRight: 'auto' }}>
            {vista.resumen.validas} válidas · {conError} con error{total > 0 ? ` · total ${fmtMonto(moneda, total)}` : ''}
          </span>}
          <button onClick={() => void cerrar()} style={btnSecundario}>Cancelar</button>
          <button onClick={() => void confirmar()} disabled={!puedeGuardar} style={btnPrimario}>
            {guardando ? 'Guardando…' : `Confirmar y guardar${vista ? ` ${vista.resumen.validas}` : ''} reservas`}
          </button>
        </div>
      }
    >
      <p style={{ margin: '0 0 10px', fontSize: 12, color: 'var(--at-ink-soft)' }}>
        {PLANTILLA_RESERVAS_STR.descripcion} Hasta {MAX_FILAS_STR} filas y {MAX_BYTES_ARCHIVO / 1024 / 1024} MB; CSV o XLSX sin fórmulas.
      </p>
      <ul style={{ margin: '0 0 10px', paddingLeft: 18, fontSize: 12, color: 'var(--at-ink-soft)' }}>
        {PLANTILLA_RESERVAS_STR.notas.map((n) => <li key={n}>{n}</li>)}
      </ul>

      <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap', alignItems: 'center', marginBottom: 10 }}>
        <strong style={{ fontSize: 12 }}>1. Plantilla</strong>
        <button style={btnLink} onClick={() => descargar(csvPlantillaSTR(), `${PLANTILLA_RESERVAS_STR.nombreArchivo}.csv`, 'text/csv;charset=utf-8')}>Descargar CSV</button>
        <button style={btnLink} onClick={async () => descargar(await xlsxPlantillaSTR(), `${PLANTILLA_RESERVAS_STR.nombreArchivo}.xlsx`, 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet')}>Descargar XLSX</button>
      </div>
      <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap', alignItems: 'center', marginBottom: 10 }}>
        <strong style={{ fontSize: 12 }}>2. Archivo</strong>
        <input ref={inputRef} type="file" accept=".csv,.xlsx,.txt" aria-label="Archivo de reservas" style={input}
               onChange={(e) => void elegirArchivo(e.target.files?.[0])} disabled={validando} />
        {validando && <span role="status" style={{ fontSize: 12 }}>Validando {nombre}…</span>}
      </div>

      {errorArchivo && <p role="alert" style={{ margin: '0 0 10px', fontSize: 12, color: 'var(--at-danger)' }}>{errorArchivo}</p>}
      {avisos.length > 0 && (
        <ul aria-label="Avisos del archivo" style={{ margin: '0 0 10px', paddingLeft: 18, fontSize: 12, color: 'var(--at-warning)' }}>
          {avisos.map((a) => <li key={a}>{a}</li>)}
        </ul>
      )}

      {vista && (
        <div>
          <div style={{ display: 'flex', gap: 10, alignItems: 'center', flexWrap: 'wrap', marginBottom: 6 }}>
            <strong style={{ fontSize: 12 }}>3. Vista previa</strong>
            <StatusBadge tone={conError === 0 ? 'success' : 'danger'}>
              {conError === 0 ? 'Sin errores' : `${conError} fila(s) con error`}
            </StatusBadge>
            <label style={{ fontSize: 12, display: 'flex', gap: 4, alignItems: 'center' }}>
              <input type="checkbox" checked={soloErrores} onChange={(e) => setSoloErrores(e.target.checked)} /> Solo filas con error
            </label>
          </div>
          {duplicado && (
            <p role="alert" style={{ margin: '0 0 8px', fontSize: 12, color: 'var(--at-danger)' }}>
              Este mismo contenido ya se importó a este proyecto y sus reservas siguen ahí: no se importa dos veces.
            </p>
          )}
          {conError > 0 && (
            <p style={{ margin: '0 0 8px', fontSize: 12, color: 'var(--at-ink-soft)' }}>
              La carga es todo o nada: corrige las filas marcadas en el archivo y vuelve a subirlo. No se guardó ninguna reserva.
            </p>
          )}
          <div style={{ overflowX: 'auto' }}>
            <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12, minWidth: 760 }} aria-label="Vista previa de la importación">
              <thead>
                <tr style={{ textAlign: 'left', color: 'var(--at-ink-soft)' }}>
                  <th style={{ padding: 4, width: 44 }}>Fila</th>
                  <th style={{ padding: 4, width: 110 }}>Unidad</th>
                  <th style={{ padding: 4 }}>Huésped</th>
                  <th style={{ padding: 4, width: 170 }}>Entrada → salida</th>
                  <th style={{ padding: 4, width: 60, textAlign: 'right' }}>Noches</th>
                  <th style={{ padding: 4, width: 80 }}>Plataforma</th>
                  <th style={{ padding: 4, width: 100 }}>Código</th>
                  <th style={{ padding: 4, width: 100, textAlign: 'right' }}>Total</th>
                  <th style={{ padding: 4, width: 110 }}>Resultado</th>
                </tr>
              </thead>
              <tbody>
                {filasVisibles.map((f) => {
                  const o = f.origen
                  return (
                    <tr key={f.fila} data-testid={`fila-${f.fila}`} data-estado={f.errores.length ? 'error' : 'ok'}
                        style={{ background: f.errores.length ? 'var(--at-danger-tint, rgba(220,38,38,0.07))' : undefined, verticalAlign: 'top' }}>
                      <td style={{ padding: 4 }}>{f.fila}</td>
                      <td style={{ padding: 4 }}>{f.datos?.unidad ?? o.unidad ?? ''}</td>
                      <td style={{ padding: 4 }}>
                        {f.datos?.huesped_nombre ?? o.huesped_nombre ?? ''}
                        {f.errores.length > 0 && (
                          <ul style={{ margin: '4px 0 0', paddingLeft: 16, color: 'var(--at-danger)' }}>
                            {f.errores.map((e, i) => <li key={i}><strong>{e.campo}:</strong> {e.mensaje}</li>)}
                          </ul>
                        )}
                        {f.advertencias.length > 0 && (
                          <ul style={{ margin: '4px 0 0', paddingLeft: 16, color: 'var(--at-warning)' }}>
                            {f.advertencias.map((e, i) => <li key={i}>{e.mensaje}</li>)}
                          </ul>
                        )}
                      </td>
                      <td style={{ padding: 4 }}>{(f.datos?.fecha_entrada ?? o.fecha_entrada ?? '')} → {(f.datos?.fecha_salida ?? o.fecha_salida ?? '')}</td>
                      <td style={{ padding: 4, textAlign: 'right' }}>{f.datos?.noches ?? ''}</td>
                      <td style={{ padding: 4 }}>{f.datos?.plataforma ?? o.plataforma ?? ''}</td>
                      <td style={{ padding: 4 }}>{f.datos?.codigo_confirmacion ?? o.codigo_confirmacion ?? ''}</td>
                      <td style={{ padding: 4, textAlign: 'right' }}>{f.datos ? fmtMonto(moneda, f.datos.monto_total) : o.monto_total ?? ''}</td>
                      <td style={{ padding: 4 }}>
                        <StatusBadge tone={f.errores.length ? 'danger' : f.advertencias.length ? 'warning' : 'success'}>
                          {f.errores.length ? 'Con error' : f.advertencias.length ? 'Con aviso' : 'Válida'}
                        </StatusBadge>
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </EditModal>
  )
}
