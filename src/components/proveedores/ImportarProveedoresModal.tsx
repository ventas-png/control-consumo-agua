// Carga masiva de proveedores, asignaciones a proyecto y contratos.
//
// Flujo: elegir tipo → bajar plantilla → subir archivo → VISTA PREVIA (el
// servidor valida y guarda el lote, nada se escribe en el catálogo) → aplicar.
// El navegador solo LEE el archivo (sin ejecutar fórmulas ni macros) y manda
// texto; todas las reglas las aplica el servidor, que además es quien decide si
// el lote es «todo o nada» o «solo filas válidas». Importar nunca autoriza un
// proveedor, ni lo habilita en un proyecto, ni activa un contrato.
import { useRef, useState } from 'react'
import {
  MAX_FILAS_CARGA,
  PLANTILLAS,
  construirInformeLote,
  csvPlantilla,
  leerArchivoImportacion,
  xlsxPlantilla,
  ArchivoImportacionError,
} from '../../domain/proveedores/importacion'
import {
  useAplicarImportacionMutation,
  useDescartarImportacionMutation,
  usePrevisualizarImportacionMutation,
} from '../../domain/proveedores/mutations'
import { useFilasLoteQuery } from '../../domain/proveedores/queries'
import type {
  AccionImportacion,
  ModoAplicacion,
  ResultadoAplicacion,
  ResumenLote,
  TipoImportacion,
} from '../../types/proveedores'
import { EditModal } from '../shared/EditModal'
import { StatusBadge } from '../shared/StatusBadge'
import { confirm, notify } from '../shared/Dialog'
import { btnLink, btnPrimario, btnSecundario, input } from '../contabilidad/ui'

interface Props {
  tipoInicial?: TipoImportacion
  onClose: () => void
}

const TONO_ACCION: Record<AccionImportacion, 'success' | 'info' | 'neutral' | 'danger' | 'warning'> = {
  crear: 'success', actualizar: 'info', sin_cambios: 'neutral', omitir: 'neutral', error: 'danger',
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

export function ImportarProveedoresModal({ tipoInicial = 'proveedores', onClose }: Props) {
  const [tipo, setTipo] = useState<TipoImportacion>(tipoInicial)
  const [actualizar, setActualizar] = useState(false)
  const [vaciar, setVaciar] = useState(false)
  const [modo, setModo] = useState<ModoAplicacion>('todo_o_nada')
  const [lote, setLote] = useState<{ id: string; resumen: ResumenLote; archivo: string; columnas: string[]; avisos: string[] } | null>(null)
  const [resultado, setResultado] = useState<ResultadoAplicacion | null>(null)
  const [leyendo, setLeyendo] = useState(false)
  const refArchivo = useRef<HTMLInputElement>(null)

  const previsualizar = usePrevisualizarImportacionMutation()
  const aplicar = useAplicarImportacionMutation()
  const descartar = useDescartarImportacionMutation()
  const { data: filas = [] } = useFilasLoteQuery(lote?.id)

  const plantilla = PLANTILLAS[tipo]
  const aplicado = resultado && (resultado.estado === 'aplicado' || resultado.estado === 'aplicado_parcial')

  function reiniciar() { setLote(null); setResultado(null) }

  async function bajarPlantilla(formato: 'csv' | 'xlsx') {
    if (formato === 'csv') descargar(csvPlantilla(tipo), `${plantilla.nombreArchivo}.csv`, 'text/csv;charset=utf-8')
    else descargar(await xlsxPlantilla(tipo), `${plantilla.nombreArchivo}.xlsx`, 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet')
  }

  async function elegirArchivo(archivo: File) {
    setLeyendo(true)
    reiniciar()
    try {
      const leido = await leerArchivoImportacion(archivo.name, await archivo.arrayBuffer(), tipo)
      const r = await previsualizar.mutateAsync({
        tipo, filas: leido.filas, opciones: { actualizar_existentes: actualizar, vaciar_vacios: vaciar },
        archivoNombre: archivo.name, archivoSha256: leido.sha256 || undefined,
      })
      setLote({ id: r.lote_id, resumen: r.resumen as unknown as ResumenLote, archivo: archivo.name, columnas: leido.columnas, avisos: leido.advertencias })
    } catch (e) {
      const m = e instanceof ArchivoImportacionError ? e.message : (e as Error).message
      notify({ variant: 'error', title: 'No se pudo leer el archivo', text: m })
    } finally {
      setLeyendo(false)
      if (refArchivo.current) refArchivo.current.value = ''
    }
  }

  async function ejecutar() {
    if (!lote) return
    const r = await confirm({
      title: modo === 'todo_o_nada' ? '¿Aplicar la carga completa?' : '¿Aplicar solo las filas válidas?',
      text: modo === 'todo_o_nada'
        ? 'Si alguna fila falla, no se guarda ninguna.'
        : `Se guardarán las filas sin error. Las ${lote.resumen.con_error} filas con error NO se cargan y quedarán en el informe.`,
      confirmText: 'Aplicar',
    })
    if (!r.isConfirmed) return
    try {
      const res = await aplicar.mutateAsync({ loteId: lote.id, modo })
      setResultado(res)
      if (res.desactualizado) {
        notify({ variant: 'warning', title: 'Los datos cambiaron', text: 'Entre la vista previa y ahora cambió el catálogo. Revisa de nuevo antes de aplicar.' })
      }
    } catch (e) {
      notify({ variant: 'error', title: 'No se pudo aplicar', text: (e as Error).message })
    }
  }

  async function cancelarLote() {
    if (lote && !aplicado) {
      try { await descartar.mutateAsync(lote.id) } catch { /* el lote caduca solo; no bloquea cerrar */ }
    }
    onClose()
  }

  function bajarInforme() {
    if (!lote) return
    descargar(construirInformeLote(filas, lote.columnas), `informe_${plantilla.nombreArchivo}.csv`, 'text/csv;charset=utf-8')
  }

  const r = lote?.resumen
  const hayError = (r?.con_error ?? 0) > 0

  return (
    <EditModal title="Carga masiva" subtitle="Importar no autoriza proveedores, no habilita proyectos ni activa contratos." onClose={() => void cancelarLote()} size="xl"
      footer={
        <>
          <button type="button" style={btnSecundario} onClick={() => void cancelarLote()}>{aplicado ? 'Cerrar' : 'Cancelar'}</button>
          {lote && !aplicado && (
            <button type="button" style={btnPrimario} disabled={aplicar.isPending || (r?.filas ?? 0) === 0 || (modo === 'todo_o_nada' && hayError)} onClick={() => void ejecutar()}>
              {aplicar.isPending ? 'Aplicando…' : 'Aplicar carga'}
            </button>
          )}
        </>
      }>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
        <fieldset disabled={!!lote} style={{ border: 'none', padding: 0, margin: 0, display: 'flex', gap: 10, flexWrap: 'wrap' }}>
          <legend style={{ fontSize: 12, fontWeight: 600, marginBottom: 4 }}>¿Qué vas a cargar?</legend>
          {(Object.keys(PLANTILLAS) as TipoImportacion[]).map((t) => (
            <label key={t} style={{ display: 'flex', gap: 6, alignItems: 'center', fontSize: 13 }}>
              <input type="radio" name="tipo-importacion" checked={tipo === t} onChange={() => setTipo(t)} />
              {PLANTILLAS[t].titulo}
            </label>
          ))}
        </fieldset>
        <p style={{ margin: 0, fontSize: 12, color: 'var(--at-ink-soft)' }}>{plantilla.descripcion}</p>

        {!lote && (
          <>
            <ul style={{ margin: 0, paddingLeft: 18, fontSize: 12, color: 'var(--at-ink-soft)' }}>
              {plantilla.notas.map((n) => <li key={n}>{n}</li>)}
            </ul>
            <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap' }}>
              <button type="button" style={btnSecundario} onClick={() => void bajarPlantilla('csv')}>Descargar plantilla CSV</button>
              <button type="button" style={btnSecundario} onClick={() => void bajarPlantilla('xlsx')}>Descargar plantilla Excel</button>
            </div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 6, fontSize: 13 }}>
              <label><input type="checkbox" checked={actualizar} onChange={(e) => setActualizar(e.target.checked)} /> Actualizar los que ya existen (por defecto solo se crean los nuevos)</label>
              <label><input type="checkbox" checked={vaciar} onChange={(e) => setVaciar(e.target.checked)} /> Las celdas vacías borran el valor existente (por defecto se conserva)</label>
            </div>
            <label style={{ fontSize: 13, fontWeight: 600 }}>
              Archivo (.csv o .xlsx, hasta {MAX_FILAS_CARGA} filas)
              <input ref={refArchivo} type="file" accept=".csv,.xlsx,.txt" disabled={leyendo} style={{ ...input, display: 'block', marginTop: 4 }}
                onChange={(e) => { const f = e.target.files?.[0]; if (f) void elegirArchivo(f) }} />
            </label>
            {leyendo && <p role="status">Leyendo y validando…</p>}
          </>
        )}

        {lote && r && (
          <>
            <div data-testid="resumen-lote" style={{ display: 'flex', gap: 10, flexWrap: 'wrap', alignItems: 'center' }}>
              <strong>{lote.archivo}</strong>
              <StatusBadge tone="info">{r.filas} filas</StatusBadge>
              <StatusBadge tone="success">{r.crear} nuevas</StatusBadge>
              <StatusBadge tone="info">{r.actualizar} a actualizar</StatusBadge>
              <StatusBadge tone="neutral">{r.sin_cambios} sin cambios</StatusBadge>
              {r.omitir > 0 && <StatusBadge tone="neutral">{r.omitir} omitidas</StatusBadge>}
              <StatusBadge tone={hayError ? 'danger' : 'success'}>{r.con_error} con error</StatusBadge>
              {r.con_advertencia > 0 && <StatusBadge tone="warning">{r.con_advertencia} con advertencia</StatusBadge>}
            </div>
            {r.contenido_ya_aplicado && (
              <p role="alert" style={{ color: 'var(--at-warning)', fontSize: 12 }}>
                Este mismo contenido ya se aplicó antes ({r.contenido_ya_aplicado.aplicado_at?.slice(0, 10)}). Si lo aplicas otra vez no se duplicará nada, pero revisa que no sea un archivo repetido.
              </p>
            )}
            {lote.avisos.map((a) => <p key={a} role="status" style={{ fontSize: 12, color: 'var(--at-warning)', margin: 0 }}>{a}</p>)}

            {!aplicado && (
              <fieldset style={{ border: 'none', padding: 0, margin: 0, fontSize: 13 }}>
                <legend style={{ fontSize: 12, fontWeight: 600 }}>Si hay filas con error</legend>
                <label style={{ display: 'block' }}><input type="radio" name="modo" checked={modo === 'todo_o_nada'} onChange={() => setModo('todo_o_nada')} /> Todo o nada: no se guarda nada hasta corregir el archivo</label>
                <label style={{ display: 'block' }}><input type="radio" name="modo" checked={modo === 'filas_validas'} onChange={() => setModo('filas_validas')} /> Cargar solo las filas válidas; las demás quedan en el informe</label>
              </fieldset>
            )}

            <div style={{ overflowX: 'auto', maxHeight: 340, overflowY: 'auto' }}>
              <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12 }}>
                <thead><tr style={{ textAlign: 'left' }}>
                  <th scope="col">Fila</th><th scope="col">Acción</th><th scope="col">Detalle</th><th scope="col">Cambios</th>
                </tr></thead>
                <tbody>
                  {filas.map((f) => (
                    <tr key={f.id} style={{ borderTop: '1px solid var(--at-line)', verticalAlign: 'top' }}>
                      <td>{f.fila}</td>
                      <td><StatusBadge tone={TONO_ACCION[f.accion]}>{f.accion.replace('_', ' ')}</StatusBadge>{aplicado && f.estado === 'error' && ' · no cargada'}</td>
                      <td>
                        {f.errores.map((e, i) => <div key={`e${i}`} style={{ color: 'var(--at-danger)' }}>{e.campo}: {e.mensaje}</div>)}
                        {f.advertencias.map((e, i) => <div key={`a${i}`} style={{ color: 'var(--at-warning)' }}>{e.campo}: {e.mensaje}</div>)}
                        {f.resultado && <div>{f.resultado}</div>}
                      </td>
                      <td>
                        {Object.entries(f.cambios ?? {}).map(([c, v]) => (
                          <div key={c}><strong>{c}</strong>: {String(v.antes ?? '—')} → {String(v.despues ?? '—')}</div>
                        ))}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap' }}>
              <button type="button" style={btnLink} onClick={bajarInforme}>Descargar informe por fila (CSV)</button>
              {!aplicado && <button type="button" style={btnLink} onClick={() => { void descartar.mutateAsync(lote.id); reiniciar() }}>Elegir otro archivo</button>}
            </div>
          </>
        )}

        {resultado && (
          <div role="status" data-testid="resultado-carga" style={{ padding: 10, borderRadius: 8, border: '1px solid var(--at-line)', fontSize: 13 }}>
            <strong>
              {resultado.estado === 'aplicado' ? 'Carga aplicada.' : resultado.estado === 'aplicado_parcial' ? 'Carga aplicada parcialmente.' : 'La carga NO se aplicó.'}
            </strong>{' '}
            {resultado.aplicadas} filas guardadas
            {resultado.con_error ? ` · ${resultado.con_error} con error (no cargadas)` : ''}
            {resultado.repetido ? ' · el lote ya estaba aplicado: no se duplicó nada' : ''}
            {resultado.error ? ` · ${resultado.error}` : ''}
            {resultado.nota ? ` · ${resultado.nota}` : ''}
          </div>
        )}
      </div>
    </EditModal>
  )
}
