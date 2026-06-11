// Modal de alta/edición de unidad, extraído de UnidadesSection (P1 #3):
// JSX idéntico al original.
import type { UnidadesCtx } from './ctx'
import { inputStyle, labelStyle } from './ui'
import type { TipoUnidad, TipoRegimen, EstadoOcupacional, ContratoSuministro } from '../../types'
import { TIPOS_UNIDAD, TIPOS_REGIMEN, ESTADOS_OCUPACIONALES, CONTRATOS_SUMINISTRO, TIPO_AGUA_LABELS } from './ui'
import { EditModal } from '../shared/EditModal'

export function UnidadFormModal({ ctx }: { ctx: UnidadesCtx }) {
  const { contadores, clientes, proyectos, form, setForm, selectedContadorIds, setSelectedContadorIds, editingId, loading, cancelForm, handleGuardar } = ctx
  return (
        <EditModal title={editingId ? 'Editar Unidad' : 'Nueva Unidad'} onClose={cancelForm} maxWidth="820px">
          <div style={{ marginBottom: '16px' }}>
            <div style={{ fontSize: '12px', fontWeight: 600, color: 'var(--at-ink-3)', textTransform: 'uppercase', letterSpacing: '0.05em', marginBottom: '10px' }}>
              Datos de la Unidad
            </div>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: '14px' }}>
              {proyectos.length > 1 && (
                <div style={{ gridColumn: '1 / -1' }}>
                  <label style={labelStyle}>Proyecto *</label>
                  <select
                    style={inputStyle}
                    value={form.project_id}
                    onChange={e => setForm(f => ({ ...f, project_id: e.target.value }))}
                  >
                    <option value="">— Seleccionar proyecto —</option>
                    {proyectos.map(p => (
                      <option key={p.id} value={p.id}>{p.nombre}</option>
                    ))}
                  </select>
                </div>
              )}
              <div>
                <label style={labelStyle}>Nombre / Número *</label>
                <input
                  style={inputStyle}
                  value={form.nombre}
                  onChange={e => setForm(f => ({ ...f, nombre: e.target.value }))}
                  placeholder="Ej: Apto 101, Casa 5, Local A..."
                  maxLength={100}
                />
              </div>
              <div>
                <label style={labelStyle}>Tipo de Unidad *</label>
                <select
                  style={inputStyle}
                  value={form.tipo}
                  onChange={e => setForm(f => ({ ...f, tipo: e.target.value as TipoUnidad }))}
                >
                  {TIPOS_UNIDAD.map(t => (
                    <option key={t.value} value={t.value}>{t.icon} {t.label}</option>
                  ))}
                </select>
              </div>
              <div>
                <label style={labelStyle}>Piso</label>
                <input
                  style={inputStyle}
                  type="number"
                  value={form.piso}
                  onChange={e => setForm(f => ({ ...f, piso: e.target.value }))}
                  placeholder="Ej: 1, 2, -1 (sótano)..."
                />
              </div>
              <div>
                <label style={labelStyle}>Área (m²)</label>
                <input
                  style={inputStyle}
                  type="number"
                  min="0"
                  step="0.01"
                  value={form.area_m2}
                  onChange={e => setForm(f => ({ ...f, area_m2: e.target.value }))}
                  placeholder="Ej: 85.50"
                />
              </div>
              <div>
                <label style={labelStyle} title="Porcentaje de participación en gastos comunes (0-100). Si no se define, se calcula proporcionalmente por área.">Alícuota % <span style={{ color: 'var(--at-ink-3)', fontWeight: 400 }}>(opcional)</span></label>
                <input
                  style={inputStyle}
                  type="number"
                  min="0"
                  max="100"
                  step="0.0001"
                  value={form.alicuota_pct}
                  onChange={e => setForm(f => ({ ...f, alicuota_pct: e.target.value }))}
                  placeholder="Ej: 3.2500"
                />
              </div>
              <div style={{ gridColumn: '1 / -1' }}>
                <label style={labelStyle}>Descripción</label>
                <textarea
                  style={{ ...inputStyle, minHeight: '56px', resize: 'vertical' }}
                  value={form.descripcion}
                  onChange={e => setForm(f => ({ ...f, descripcion: e.target.value }))}
                  placeholder="Notas adicionales sobre la unidad..."
                  maxLength={500}
                />
              </div>
            </div>
          </div>

          <div style={{ marginBottom: '20px' }}>
            <div style={{ fontSize: '12px', fontWeight: 600, color: 'var(--at-ink-3)', textTransform: 'uppercase', letterSpacing: '0.05em', marginBottom: '10px' }}>
              Datos del Propietario / Ocupante
            </div>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: '14px' }}>
              <div>
                <label style={labelStyle}>Nombre</label>
                <input
                  style={inputStyle}
                  value={form.propietario_nombre}
                  onChange={e => setForm(f => ({ ...f, propietario_nombre: e.target.value }))}
                  placeholder="Nombre del propietario..."
                  maxLength={150}
                />
              </div>
              <div>
                <label style={labelStyle}>Teléfono</label>
                <input
                  style={inputStyle}
                  type="tel"
                  value={form.propietario_telefono}
                  onChange={e => setForm(f => ({ ...f, propietario_telefono: e.target.value }))}
                  placeholder="Teléfono de contacto..."
                  maxLength={20}
                />
              </div>
              <div>
                <label style={labelStyle}>Correo Electrónico</label>
                <input
                  style={inputStyle}
                  type="email"
                  value={form.propietario_email}
                  onChange={e => setForm(f => ({ ...f, propietario_email: e.target.value }))}
                  placeholder="email@ejemplo.com"
                  maxLength={150}
                />
              </div>
            </div>
          </div>

          {/* Datos del Inmueble */}
          <div style={{ marginBottom: '20px' }}>
            <div style={{ fontSize: '12px', fontWeight: 600, color: 'var(--at-ink-3)', textTransform: 'uppercase', letterSpacing: '0.05em', marginBottom: '10px' }}>
              Datos del Inmueble
            </div>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: '14px' }}>
              <div style={{ gridColumn: '1 / -1' }}>
                <label style={labelStyle}>Dirección</label>
                <input
                  style={inputStyle}
                  value={form.direccion}
                  onChange={e => setForm(f => ({ ...f, direccion: e.target.value }))}
                  placeholder="Dirección de la unidad..."
                  maxLength={255}
                />
              </div>
              <div>
                <label style={labelStyle}>Tipo de Régimen</label>
                <select
                  style={inputStyle}
                  value={form.tipo_regimen}
                  onChange={e => setForm(f => ({ ...f, tipo_regimen: e.target.value as TipoRegimen | '' }))}
                >
                  <option value="">— Sin especificar —</option>
                  {TIPOS_REGIMEN.map(r => (
                    <option key={r.value} value={r.value}>{r.label}</option>
                  ))}
                </select>
              </div>
              <div>
                <label style={labelStyle}>Fecha de Construcción</label>
                <input
                  style={inputStyle}
                  type="date"
                  value={form.fecha_construccion}
                  onChange={e => setForm(f => ({ ...f, fecha_construccion: e.target.value }))}
                />
              </div>
              <div style={{ gridColumn: '1 / -1' }}>
                <label style={labelStyle}>Datos Registrales</label>
                <textarea
                  style={{ ...inputStyle, minHeight: '72px', resize: 'vertical' }}
                  value={form.datos_registrales}
                  onChange={e => setForm(f => ({ ...f, datos_registrales: e.target.value }))}
                  placeholder="Número de finca, tomo, folio, inscripción, etc..."
                  maxLength={1000}
                />
              </div>
            </div>
          </div>

          {/* Estado Ocupacional */}
          <div style={{ marginBottom: '20px' }}>
            <div style={{ fontSize: '12px', fontWeight: 600, color: 'var(--at-ink-3)', textTransform: 'uppercase', letterSpacing: '0.05em', marginBottom: '10px' }}>
              Estado Ocupacional
            </div>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: '14px' }}>
              <div>
                <label style={labelStyle}>Estado</label>
                <select
                  style={inputStyle}
                  value={form.estado_ocupacional}
                  onChange={e => setForm(f => ({ ...f, estado_ocupacional: e.target.value as EstadoOcupacional | '' }))}
                >
                  <option value="">— Sin especificar —</option>
                  {ESTADOS_OCUPACIONALES.map(o => (
                    <option key={o.value} value={o.value}>{o.label}</option>
                  ))}
                </select>
              </div>
            </div>
          </div>

          {/* Contrato de Suministro */}
          <div style={{ marginBottom: '20px' }}>
            <div style={{ fontSize: '12px', fontWeight: 600, color: 'var(--at-ink-3)', textTransform: 'uppercase', letterSpacing: '0.05em', marginBottom: '10px' }}>
              Contrato de Suministro
            </div>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: '14px' }}>
              <div>
                <label style={labelStyle}>¿Tiene Contrato?</label>
                <select
                  style={inputStyle}
                  value={form.contrato_suministro}
                  onChange={e => setForm(f => ({ ...f, contrato_suministro: e.target.value as ContratoSuministro | '' }))}
                >
                  <option value="">— Sin especificar —</option>
                  {CONTRATOS_SUMINISTRO.map(c => (
                    <option key={c.value} value={c.value}>{c.label}</option>
                  ))}
                </select>
              </div>
              <div>
                <label style={labelStyle}>Número de Contrato</label>
                <input
                  style={inputStyle}
                  value={form.numero_contrato_suministro}
                  onChange={e => setForm(f => ({ ...f, numero_contrato_suministro: e.target.value }))}
                  placeholder="Ej: CONT-2025-001..."
                  maxLength={100}
                />
              </div>
              <div>
                <label style={labelStyle}>Fecha de Firma</label>
                <input
                  style={inputStyle}
                  type="date"
                  value={form.fecha_firma_contrato}
                  onChange={e => setForm(f => ({ ...f, fecha_firma_contrato: e.target.value }))}
                />
              </div>
              <div>
                <label style={labelStyle}>Fecha de Vencimiento</label>
                <input
                  style={inputStyle}
                  type="date"
                  value={form.fecha_vencimiento_contrato}
                  onChange={e => setForm(f => ({ ...f, fecha_vencimiento_contrato: e.target.value }))}
                />
              </div>
            </div>
          </div>

          <div style={{ marginBottom: '20px' }}>
            <div style={{ fontSize: '12px', fontWeight: 600, color: 'var(--at-ink-3)', textTransform: 'uppercase', letterSpacing: '0.05em', marginBottom: '10px' }}>
              Cliente Asignado
            </div>
            <select
              style={inputStyle}
              value={form.cliente_id}
              onChange={e => setForm(f => ({ ...f, cliente_id: e.target.value }))}
            >
              <option value="">— Sin cliente asignado —</option>
              {clientes.map(c => (
                <option key={c.id} value={c.id}>{c.nombre} ({c.codigo})</option>
              ))}
            </select>
          </div>

          {/* Contadores Asignados */}
          {(() => {
            const disponibles = contadores.filter(c => c.unidad_id === null || c.unidad_id === editingId)
            return (
              <div style={{ marginBottom: '20px' }}>
                <div style={{ fontSize: '12px', fontWeight: 600, color: 'var(--at-ink-3)', textTransform: 'uppercase', letterSpacing: '0.05em', marginBottom: '10px' }}>
                  Contadores Asignados
                </div>
                {disponibles.length === 0 ? (
                  <div style={{ fontSize: '13px', color: 'var(--at-ink-3)', padding: '12px', background: 'var(--at-surface-2)', borderRadius: '8px', border: '1px solid var(--at-line)' }}>
                    No hay contadores disponibles para asignar.
                  </div>
                ) : (
                  <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(260px, 1fr))', gap: '8px' }}>
                    {disponibles.map(c => {
                      const checked = selectedContadorIds.includes(c.id)
                      return (
                        <label
                          key={c.id}
                          style={{
                            display: 'flex',
                            alignItems: 'center',
                            gap: '10px',
                            padding: '10px 14px',
                            borderRadius: '8px',
                            border: `2px solid ${checked ? 'var(--at-primary)' : 'var(--at-line)'}`,
                            background: checked ? 'var(--at-primary-tint)' : 'var(--at-surface-2)',
                            cursor: 'pointer',
                            userSelect: 'none',
                            transition: 'all 0.1s',
                          }}
                        >
                          <input
                            type="checkbox"
                            checked={checked}
                            onChange={e => {
                              if (e.target.checked) setSelectedContadorIds(prev => [...prev, c.id])
                              else setSelectedContadorIds(prev => prev.filter(id => id !== c.id))
                            }}
                            style={{ width: '16px', height: '16px', accentColor: 'var(--at-primary)', flexShrink: 0 }}
                          />
                          <div style={{ minWidth: 0 }}>
                            <div style={{ fontWeight: 600, fontSize: '13px', color: 'var(--at-ink)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                              🔧 {c.numero_serie}
                            </div>
                            <div style={{ fontSize: '11px', color: 'var(--at-ink-3)' }}>
                              {TIPO_AGUA_LABELS[c.tipo_agua] ?? c.tipo_agua}
                              {c.marca && ` · ${c.marca}`}
                            </div>
                          </div>
                        </label>
                      )
                    })}
                  </div>
                )}
                {selectedContadorIds.length > 0 && (
                  <div style={{ marginTop: '8px', fontSize: '12px', color: 'var(--at-primary-hover)' }}>
                    {selectedContadorIds.length} contador{selectedContadorIds.length !== 1 ? 'es' : ''} seleccionado{selectedContadorIds.length !== 1 ? 's' : ''}
                  </div>
                )}
              </div>
            )
          })()}

          <div style={{ display: 'flex', alignItems: 'center', gap: '16px', marginBottom: '20px' }}>
            <label style={{ ...labelStyle, marginBottom: 0 }}>Estado:</label>
            <button
              type="button"
              onClick={() => setForm(f => ({ ...f, activo: !f.activo }))}
              style={{
                padding: '6px 16px',
                borderRadius: '20px',
                border: 'none',
                cursor: 'pointer',
                fontWeight: 600,
                fontSize: '13px',
                background: form.activo ? 'var(--at-success-tint)' : 'var(--at-danger-tint)',
                color: form.activo ? 'var(--at-success-strong)' : 'var(--at-danger-strong)',
              }}
            >
              {form.activo ? 'Activa' : 'Inactiva'}
            </button>
          </div>

          <div style={{ display: 'flex', gap: '10px' }}>
            <button
              onClick={handleGuardar}
              disabled={loading}
              style={{
                padding: '10px 24px',
                background: loading ? 'var(--at-ink-3)' : 'linear-gradient(135deg, var(--at-primary), var(--at-accent-2))',
                color: 'white',
                border: 'none',
                borderRadius: '8px',
                fontWeight: 600,
                cursor: loading ? 'not-allowed' : 'pointer',
                fontSize: '14px',
              }}
            >
              {loading ? 'Guardando...' : editingId ? 'Actualizar' : 'Guardar'}
            </button>
            <button
              onClick={cancelForm}
              style={{
                padding: '10px 24px',
                background: 'var(--at-chip)',
                color: 'var(--at-ink-2)',
                border: 'none',
                borderRadius: '8px',
                fontWeight: 600,
                cursor: 'pointer',
                fontSize: '14px',
              }}
            >
              Cancelar
            </button>
          </div>
        </EditModal>
  )
}
