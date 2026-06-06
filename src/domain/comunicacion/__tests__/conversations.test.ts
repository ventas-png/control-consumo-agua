// T7/PR3 #1 (Parte C) — Contrato del acceso a conversaciones (comunicacion/
// conversations): filtros de lista (cliente vs empresa), creación con primer
// mensaje, envío con adjunto (Storage + insert), y los marcadores/asignaciones.
// Mock encadenable que enruta el resultado por tabla y registra {table,method,args}.
import { describe, it, expect, vi, beforeEach } from 'vitest'

const h = vi.hoisted(() => {
  const state: {
    results: Record<string, unknown>
    storageResult: { error: unknown }
    calls: Array<{ table: string; method: string; args: unknown[] }>
  } = { results: {}, storageResult: { error: null }, calls: [] }

  function builder(table: string) {
    const b: Record<string, unknown> = {}
    for (const m of ['select', 'order', 'eq', 'is', 'in', 'not', 'insert', 'update', 'delete', 'upsert']) {
      b[m] = (...args: unknown[]) => { state.calls.push({ table, method: m, args }); return b }
    }
    const resolveVal = () => state.results[table] ?? { data: null, error: null }
    b.single = () => Promise.resolve(resolveVal())
    b.then = (resolve: (v: unknown) => void) => resolve(resolveVal())
    return b
  }

  const storageUpload = vi.fn(() => Promise.resolve(state.storageResult))
  return { state, builder, storageUpload }
})

vi.mock('../../../lib/supabase', () => ({
  supabase: {
    from: (table: string) => h.builder(table),
    storage: { from: () => ({ upload: h.storageUpload }) },
  },
}))

import {
  fetchConversations,
  fetchConversationMessages,
  fetchAccessRules,
  createConversationWithFirstMessage,
  sendConversationMessage,
  updateConversation,
  fetchAssignments,
  assignConversationToUsers,
  deleteAssignment,
  markAssignmentSeen,
  saveAccessRule,
} from '../conversations'

const eqArgs = (table: string) => h.state.calls.filter(c => c.table === table && c.method === 'eq').map(c => c.args)

beforeEach(() => {
  h.state.results = {}
  h.state.storageResult = { error: null }
  h.state.calls = []
  h.storageUpload.mockClear()
})

describe('fetchConversations', () => {
  it('rol cliente → filtra cliente_id + service_type', async () => {
    h.state.results['conversations'] = { data: [{ id: 'c1' }], error: null }
    const out = await fetchConversations({ clienteId: 'cl1', isCliente: true, serviceType: 'agua' })
    expect(out).toEqual([{ id: 'c1' }])
    expect(eqArgs('conversations')).toEqual([['cliente_id', 'cl1'], ['service_type', 'agua']])
  })
  it('rol empresa → filtra company_id + service_type', async () => {
    h.state.results['conversations'] = { data: [], error: null }
    await fetchConversations({ companyId: 'co1', isCliente: false, serviceType: 'energia' as never })
    expect(eqArgs('conversations')).toEqual([['company_id', 'co1'], ['service_type', 'energia']])
  })
  it('lanza si hay error', async () => {
    h.state.results['conversations'] = { data: null, error: { message: 'x' } }
    await expect(fetchConversations({ companyId: 'co1', isCliente: false, serviceType: 'agua' })).rejects.toBeTruthy()
  })
})

describe('fetchConversationMessages / fetchAccessRules', () => {
  it('mensajes: devuelve data', async () => {
    h.state.results['conversation_messages'] = { data: [{ id: 'm1' }], error: null }
    expect(await fetchConversationMessages('c1')).toEqual([{ id: 'm1' }])
  })
  it('reglas: filtra company_id + service_type', async () => {
    h.state.results['conversation_access_rules'] = { data: [], error: null }
    await fetchAccessRules('co1', 'agua')
    expect(eqArgs('conversation_access_rules')).toEqual([['company_id', 'co1'], ['service_type', 'agua']])
  })
})

describe('createConversationWithFirstMessage', () => {
  it('crea la conversación y el primer mensaje con su id', async () => {
    h.state.results['conversations'] = { data: { id: 'cv1' }, error: null }
    const conv = await createConversationWithFirstMessage(
      { subject: 's', category: 'general' as never, priority: 'media' as never, clienteId: 'cl1', clienteNombre: 'N', companyId: 'co1', firstMessage: 'hola', senderName: 'Yo' },
      { userId: 'u1', isCliente: false, serviceType: 'agua' },
    )
    expect(conv).toEqual({ id: 'cv1' })
    const msgInsert = h.state.calls.find(c => c.table === 'conversation_messages' && c.method === 'insert')
    expect(msgInsert?.args[0]).toMatchObject({ conversation_id: 'cv1', sender_type: 'agent', body: 'hola' })
  })
})

describe('sendConversationMessage', () => {
  const actor = { userId: 'u1', isCliente: true }
  it('con adjunto → sube a Storage e incluye attachment_url', async () => {
    const file = { name: 'a b.png', type: 'image/png', size: 3 } as unknown as File
    await sendConversationMessage({ conversationId: 'cv1', body: 'b', senderName: 'N', attachment: file }, actor)
    expect(h.storageUpload).toHaveBeenCalledTimes(1)
    const insert = h.state.calls.find(c => c.table === 'conversation_messages' && c.method === 'insert')
    expect((insert?.args[0] as Record<string, unknown>).attachment_url).toMatch(/^cv1\//)
    expect((insert?.args[0] as Record<string, unknown>).sender_type).toBe('cliente')
  })
  it('sin adjunto → no toca Storage', async () => {
    await sendConversationMessage({ conversationId: 'cv1', body: 'b', senderName: 'N' }, actor)
    expect(h.storageUpload).not.toHaveBeenCalled()
  })
  it('si falla el upload, lanza', async () => {
    h.state.storageResult = { error: { message: 'boom' } }
    const file = { name: 'x.png', type: 'image/png', size: 1 } as unknown as File
    await expect(sendConversationMessage({ conversationId: 'cv1', body: 'b', senderName: 'N', attachment: file }, actor)).rejects.toBeTruthy()
  })
})

describe('assignments + reglas', () => {
  it('updateConversation: update + filtro por id', async () => {
    await updateConversation('cv1', { status: 'cerrada' as never })
    const upd = h.state.calls.find(c => c.table === 'conversations' && c.method === 'update')
    expect(upd?.args[0]).toEqual({ status: 'cerrada' })
    expect(eqArgs('conversations')).toEqual([['id', 'cv1']])
  })
  it('fetchAssignments: degrada a null si hay error', async () => {
    h.state.results['conversation_assignments'] = { data: null, error: { message: 'x' } }
    expect(await fetchAssignments()).toBeNull()
  })
  it('assignConversationToUsers: upsert con onConflict', async () => {
    await assignConversationToUsers('cv1', [{ userId: 'u1', userName: 'A' }], { id: 'b1', name: 'B' })
    const up = h.state.calls.find(c => c.table === 'conversation_assignments' && c.method === 'upsert')
    expect((up?.args[0] as unknown[])[0]).toMatchObject({ conversation_id: 'cv1', user_id: 'u1', assigned_by_id: 'b1' })
    expect(up?.args[1]).toEqual({ onConflict: 'conversation_id,user_id' })
  })
  it('deleteAssignment: delete + filtro por id', async () => {
    await deleteAssignment('a1')
    expect(eqArgs('conversation_assignments')).toEqual([['id', 'a1']])
  })
  it('markAssignmentSeen: true en éxito, false en error', async () => {
    h.state.results['conversation_assignments'] = { error: null }
    expect(await markAssignmentSeen('cv1', 'u1', 'T')).toBe(true)
    h.state.results['conversation_assignments'] = { error: { message: 'x' } }
    expect(await markAssignmentSeen('cv1', 'u1', 'T')).toBe(false)
  })
  it('saveAccessRule: upsert con onConflict company_id,role,service_type', async () => {
    await saveAccessRule({ company_id: 'co1', role: 'admin', service_type: 'agua' } as never)
    const up = h.state.calls.find(c => c.table === 'conversation_access_rules' && c.method === 'upsert')
    expect(up?.args[1]).toEqual({ onConflict: 'company_id,role,service_type' })
  })
})
