// Carga masiva de renglones de una orden de compra EN BORRADOR.
//
// Flujo: bajar plantilla → subir archivo → VISTA PREVIA (el servidor valida cada fila, resuelve
// insumos y cuentas por nombre/código y guarda el lote; todavía NO hay renglones) → confirmar.
// Es todo o nada: con una sola fila en error no se guarda nada. Importar nunca aprueba, emite,
// recibe ni contabiliza, y nunca crea proveedores, cuentas ni insumos. Doble clic o reintento no
// duplican: el servidor devuelve el resultado del lote ya aplicado.
import { useMemo, useRef, useState } from 'react'
import { EditModal } from '../shared'
import { StatusBadge } from '../shared/StatusBadge'
import { confirm, notify } from '../shared/Dialog'
import {
  MAX_FILAS_LINEAS,
  PLANTILLA_LINEAS,
  csvPlantillaLineas,
  leerArchivoLineas,
  useAplicarLineasMutation,
  useDescartarLineasMutation,
  usePrevisualizarLineasMutation,
  xlsxPlantillaLineas,
} from '../../domain/compras/importacionLineas'
import { ArchivoImportacionError, MAX_BYTES_ARCHIVO } from '../../domain/proveedores/importacion'
import { formatCurrency } from '../../lib/format'
import { DESTINO_LINEA_LABELS, type VistaPreviaImportacionLineas } from '../../types/compras'
import { btnLink, btnPrimario, btnSecundario, input } from '../contabilidad/ui'

interface Props {
  orden: { id: string; numero: string | null; concepto: string; moneda?: string | null }
  monedaBase: string
  onClose: () => void
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

export function ImportarLineasOrdenModal({ orden, monedaBase, onClose }: Props) {
  const previsualizar = usePrevisualizarLineasMutation()
  const aplicar = useAplicarLineasMutation()
  const descartar = useDescartarLineasMutation()
  const [vista, setVista] = useState<VistaPreviaImportacionLineas | null>(null)
  const [avisos, setAvisos] = useState<string[]>([])
  const [errorArchivo, setErrorArchivo] = useState<string | null>(null)
  const [soloErrores, setSoloErrores] = useState(false)
  const [nombre, setNombre] = useState('')
  const inputRef = useRef<HTMLInputElement>(null)
  // Guarda contra el doble clic: el servidor es idempotente, pero la pantalla tampoco debe mandarlo dos veces.
  const enCurso = useRef(false)
  const moneda = orden.moneda ?? monedaBase

  const filasVisibles = useMemo(
    () => (vista?.filas ?? []).filter((f) => !soloErrores || f.errores.length > 0),
    [vista, soloErrores],
  )
  const total = useMemo(
    () => (vista?.filas ?? []).reduce((s, f) => s + (f.datos ? f.datos.cantidad * f.datos.precio_unitario + f.datos.iva_monto : 0), 0),
    [vista],
  )

  async function elegirArchivo(file: File | undefined) {
    setVista(null)
    setAvisos([])
    setErrorArchivo(null)
    if (!file) return
    setNombre(file.name)
    try {
      const leido = await leerArchivoLineas(file.name, await file.arrayBuffer())
      setAvisos(leido.advertencias)
      const v = await previsualizar.mutateAsync({ ordenId: orden.id, filas: leido.filas, archivo: file.name })
      setVista(v)
    } catch (e) {
      setErrorArchivo(e instanceof ArchivoImportacionError || e instanceof Error ? e.message : 'No se pudo leer el archivo.')
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

  async function guardar(vista: VistaPreviaImportacionLineas) {
    // confirm() devuelve { isConfirmed }: un objeto siempre es «verdadero», así que `if (!ok)` nunca frenaba «Cancelar».
    const { isConfirmed } = await confirm({
      title: 'Guardar renglones',
      text: `Se agregarán ${vista.resumen.validas} renglones a ${orden.numero ?? 'la orden'} (total ${formatCurrency(total, moneda)}). La orden sigue en borrador: no se aprueba, emite, recibe ni contabiliza nada.`,
      confirmText: 'Guardar',
    })
    if (!isConfirmed) return
    try {
      const r = await aplicar.mutateAsync(vista.lote_id)
      notify({
        variant: 'success', title: 'Listo',
        text: r.reutilizada ? 'Este archivo ya se había guardado: no se duplicó nada.' : `${r.renglones_creados} renglones agregados a la orden en borrador.`,
      })
      onClose()
    } catch (e) {
      notify({ variant: 'error', title: 'No se guardó nada', text: e instanceof Error ? e.message : 'Error inesperado.' })
    }
  }

  async function cerrar() {
    if (vista && !aplicar.isSuccess) {
      try { await descartar.mutateAsync(vista.lote_id) } catch { /* el lote sin aplicar no estorba */ }
    }
    onClose()
  }

  const conError = vista?.resumen.con_error ?? 0
  const duplicado = vista?.resumen.duplicado_de_lote_aplicado ?? false
  const puedeGuardar = !!vista && conError === 0 && !duplicado && vista.resumen.validas > 0 && !aplicar.isPending

  return (
    <EditModal
      title={`Importar renglones a ${orden.numero ?? orden.concepto}`}
      onClose={() => void cerrar()}
      size="lg"
      footer={
        <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end', alignItems: 'center', flexWrap: 'wrap' }}>
          {vista && <span style={{ fontSize: 12, color: 'var(--at-ink-soft)', marginRight: 'auto' }}>
            {vista.resumen.validas} válidas · {conError} con error · total {formatCurrency(total, moneda)}
          </span>}
          <button onClick={() => void cerrar()} style={btnSecundario}>Cancelar</button>
          <button onClick={() => void confirmar()} disabled={!puedeGuardar} style={btnPrimario}>
            {aplicar.isPending ? 'Guardando…' : `Confirmar y guardar${vista ? ` ${vista.resumen.validas}` : ''} renglones`}
          </button>
        </div>
      }
    >
      <p style={{ margin: '0 0 10px', fontSize: 12, color: 'var(--at-ink-soft)' }}>
        {PLANTILLA_LINEAS.descripcion} Hasta {MAX_FILAS_LINEAS} filas y {MAX_BYTES_ARCHIVO / 1024 / 1024} MB; CSV o XLSX sin fórmulas.
      </p>
      <ul style={{ margin: '0 0 10px', paddingLeft: 18, fontSize: 12, color: 'var(--at-ink-soft)' }}>
        {PLANTILLA_LINEAS.notas.map((n) => <li key={n}>{n}</li>)}
      </ul>

      <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap', alignItems: 'center', marginBottom: 10 }}>
        <strong style={{ fontSize: 12 }}>1. Plantilla</strong>
        <button style={btnLink} onClick={() => descargar(csvPlantillaLineas(), `${PLANTILLA_LINEAS.nombreArchivo}.csv`, 'text/csv;charset=utf-8')}>Descargar CSV</button>
        <button style={btnLink} onClick={async () => descargar(await xlsxPlantillaLineas(), `${PLANTILLA_LINEAS.nombreArchivo}.xlsx`, 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet')}>Descargar XLSX</button>
      </div>
      <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap', alignItems: 'center', marginBottom: 10 }}>
        <strong style={{ fontSize: 12 }}>2. Archivo</strong>
        <input ref={inputRef} type="file" accept=".csv,.xlsx,.txt" aria-label="Archivo de renglones" style={input}
               onChange={(e) => void elegirArchivo(e.target.files?.[0])} disabled={previsualizar.isPending} />
        {previsualizar.isPending && <span role="status" style={{ fontSize: 12 }}>Validando {nombre}…</span>}
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
              Este mismo contenido ya se importó a esta orden y sus renglones siguen ahí: no se importa dos veces.
            </p>
          )}
          {conError > 0 && (
            <p style={{ margin: '0 0 8px', fontSize: 12, color: 'var(--at-ink-soft)' }}>
              La carga es todo o nada: corrige las filas marcadas en el archivo y vuelve a subirlo. No se guardó ningún renglón.
            </p>
          )}
          <div style={{ overflowX: 'auto' }}>
            <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12, minWidth: 720 }} aria-label="Vista previa de la importación">
              <thead>
                <tr style={{ textAlign: 'left', color: 'var(--at-ink-soft)' }}>
                  <th style={{ padding: 4, width: 44 }}>Fila</th>
                  <th style={{ padding: 4 }}>Descripción</th>
                  <th style={{ padding: 4, width: 96 }}>Destino</th>
                  <th style={{ padding: 4 }}>Insumo</th>
                  <th style={{ padding: 4, width: 70, textAlign: 'right' }}>Cant.</th>
                  <th style={{ padding: 4, width: 70 }}>Unidad</th>
                  <th style={{ padding: 4, width: 90, textAlign: 'right' }}>Precio</th>
                  <th style={{ padding: 4, width: 80, textAlign: 'right' }}>IVA</th>
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
                      <td style={{ padding: 4 }}>
                        {f.datos?.descripcion ?? o.descripcion ?? ''}
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
                      <td style={{ padding: 4 }}>{f.datos ? DESTINO_LINEA_LABELS[f.datos.destino_tipo] : o.destino ?? ''}</td>
                      <td style={{ padding: 4 }}>{o.insumo ?? ''}</td>
                      <td style={{ padding: 4, textAlign: 'right' }}>{f.datos?.cantidad ?? o.cantidad ?? ''}</td>
                      <td style={{ padding: 4 }}>{f.datos?.unidad ?? o.unidad ?? ''}</td>
                      <td style={{ padding: 4, textAlign: 'right' }}>{f.datos ? formatCurrency(f.datos.precio_unitario, moneda) : o.precio_unitario ?? ''}</td>
                      <td style={{ padding: 4, textAlign: 'right' }}>{f.datos ? formatCurrency(f.datos.iva_monto, moneda) : o.iva ?? ''}</td>
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
