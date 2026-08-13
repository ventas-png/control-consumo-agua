import { describe, it, expect } from 'vitest'
import {
  buildClienteProjectIndex,
  filterBroadcastsByProjectAccess,
  filterClientesByProjectAccess,
  filterConversationsByProjectAccess,
  filterUnidadesByProjectAccess,
  resolveConversationProjectId,
  type ProjectScope,
} from '../comunicacionAccess'
import type { Broadcast, Cliente, Conversation, Registro, Unidad } from '../../types'

const P_MINE = 'proj-mine'
const P_OTHER = 'proj-other'
const ME = 'user-me'

const unidad = (id: string, project_id: string, cliente_id?: string): Unidad =>
  ({ id, project_id, cliente_id } as Unidad)
const registro = (cliente_id: string, project_id: string): Registro =>
  ({ cliente_id, project_id } as Registro)
const cliente = (id: string): Cliente => ({ id, nombre: id, codigo: id } as Cliente)

const conv = (c: Partial<Conversation> & Pick<Conversation, 'id'>): Conversation => ({
  company_id: 'co',
  subject: c.id,
  category: 'general',
  priority: 'media',
  status: 'abierta',
  created_at: '2026-01-01',
  updated_at: '2026-01-01',
  ...c,
})

const broadcast = (b: Partial<Broadcast> & Pick<Broadcast, 'id' | 'target_type'>): Broadcast => ({
  company_id: 'co',
  title: b.id,
  body: '…',
  sent_by_id: 'u',
  sent_by_name: 'u',
  target_ids: [],
  recipient_count: 0,
  send_email: false,
  created_at: '2026-01-01',
  ...b,
})

const scope = (opts: {
  exempt?: boolean
  accessible?: string[]
  unidades?: Unidad[]
  registros?: Registro[]
} = {}): ProjectScope => ({
  exempt: opts.exempt ?? false,
  accessibleProjectIds: new Set(opts.accessible ?? [P_MINE]),
  clienteProjects: buildClienteProjectIndex({
    unidades: opts.unidades ?? [],
    registros: opts.registros ?? [],
  }),
})

describe('buildClienteProjectIndex', () => {
  it('links a cliente to every project it appears in (units and readings)', () => {
    const index = buildClienteProjectIndex({
      unidades: [unidad('u1', P_MINE, 'cl1')],
      registros: [registro('cl1', P_OTHER), registro('cl2', P_OTHER)],
    })
    expect([...(index.get('cl1') ?? [])].sort()).toEqual([P_MINE, P_OTHER].sort())
    expect([...(index.get('cl2') ?? [])]).toEqual([P_OTHER])
  })

  it('ignores units with no cliente assigned', () => {
    const index = buildClienteProjectIndex({ unidades: [unidad('u1', P_MINE)] })
    expect(index.size).toBe(0)
  })
})

describe('filterConversationsByProjectAccess', () => {
  const run = (conversations: Conversation[], s: ProjectScope, assigned?: Set<string>) =>
    filterConversationsByProjectAccess({
      conversations,
      scope: s,
      userId: ME,
      assignedConversationIds: assigned,
    }).map(c => c.id)

  it('lets an exempt role through untouched', () => {
    const conversations = [conv({ id: 'a', project_id: P_OTHER }), conv({ id: 'b', project_id: P_MINE })]
    expect(run(conversations, scope({ exempt: true }))).toEqual(['a', 'b'])
  })

  it('hides a conversation stamped with an inaccessible project', () => {
    expect(run([conv({ id: 'a', project_id: P_OTHER })], scope())).toEqual([])
  })

  it('keeps a conversation stamped with an accessible project', () => {
    expect(run([conv({ id: 'a', project_id: P_MINE })], scope())).toEqual(['a'])
  })

  it('derives the project from the cliente when project_id is null', () => {
    const conversations = [
      conv({ id: 'mine', cliente_id: 'cl1' }),
      conv({ id: 'other', cliente_id: 'cl2' }),
    ]
    const s = scope({ unidades: [unidad('u1', P_MINE, 'cl1'), unidad('u2', P_OTHER, 'cl2')] })
    expect(run(conversations, s)).toEqual(['mine'])
  })

  it('derives the project from readings when the cliente owns no unit', () => {
    const conversations = [conv({ id: 'other', cliente_id: 'cl2' })]
    expect(run(conversations, scope({ registros: [registro('cl2', P_OTHER)] }))).toEqual([])
  })

  it('keeps a conversation whose cliente cannot be mapped to any project', () => {
    expect(run([conv({ id: 'ghost', cliente_id: 'cl9' })], scope())).toEqual(['ghost'])
  })

  it('keeps a legacy internal discussion with no project_id', () => {
    expect(run([conv({ id: 'team', is_internal: true })], scope())).toEqual(['team'])
  })

  it('hides an internal discussion stamped with another project', () => {
    expect(run([conv({ id: 'team', is_internal: true, project_id: P_OTHER })], scope())).toEqual([])
  })

  it('keeps a conversation assigned to the current user despite the project', () => {
    const conversations = [conv({ id: 'mine', project_id: P_OTHER, assigned_to: ME })]
    expect(run(conversations, scope())).toEqual(['mine'])
  })

  it('keeps a conversation assigned to the user through conversation_assignments', () => {
    const conversations = [conv({ id: 'shared', project_id: P_OTHER })]
    expect(run(conversations, scope(), new Set(['shared']))).toEqual(['shared'])
  })
})

describe('filterBroadcastsByProjectAccess', () => {
  const run = (broadcasts: Broadcast[], s: ProjectScope, unidades: Unidad[] = []) =>
    filterBroadcastsByProjectAccess({ broadcasts, scope: s, unidades }).map(b => b.id)

  it('lets an exempt role through untouched', () => {
    const list = [broadcast({ id: 'a', target_type: 'proyecto', target_ids: [P_OTHER] })]
    expect(run(list, scope({ exempt: true }))).toEqual(['a'])
  })

  it('keeps company-wide broadcasts (they reached this project too)', () => {
    expect(run([broadcast({ id: 'all', target_type: 'todos' })], scope())).toEqual(['all'])
  })

  it('filters project-targeted broadcasts by the accessible projects', () => {
    const list = [
      broadcast({ id: 'mine', target_type: 'proyecto', target_ids: [P_MINE] }),
      broadcast({ id: 'other', target_type: 'proyecto', target_ids: [P_OTHER] }),
      broadcast({ id: 'both', target_type: 'proyecto', target_ids: [P_MINE, P_OTHER] }),
    ]
    expect(run(list, scope())).toEqual(['mine', 'both'])
  })

  it('maps unidad targets to their project', () => {
    const list = [
      broadcast({ id: 'mine', target_type: 'unidades', target_ids: ['u1'] }),
      broadcast({ id: 'other', target_type: 'unidades', target_ids: ['u2'] }),
    ]
    const unidades = [unidad('u1', P_MINE), unidad('u2', P_OTHER)]
    expect(run(list, scope(), unidades)).toEqual(['mine'])
  })

  it('keeps unidad broadcasts whose units are no longer resolvable', () => {
    const list = [broadcast({ id: 'gone', target_type: 'unidades', target_ids: ['u-deleted'] })]
    expect(run(list, scope())).toEqual(['gone'])
  })

  it('maps cliente targets through the cliente index', () => {
    const list = [
      broadcast({ id: 'mine', target_type: 'clientes', target_ids: ['cl1'] }),
      broadcast({ id: 'other', target_type: 'clientes', target_ids: ['cl2'] }),
    ]
    const s = scope({ unidades: [unidad('u1', P_MINE, 'cl1'), unidad('u2', P_OTHER, 'cl2')] })
    expect(run(list, s)).toEqual(['mine'])
  })

  it('keeps cliente broadcasts when no target resolves to a project', () => {
    const list = [broadcast({ id: 'ghost', target_type: 'clientes', target_ids: ['cl9'] })]
    expect(run(list, scope())).toEqual(['ghost'])
  })
})

describe('filterUnidadesByProjectAccess / filterClientesByProjectAccess', () => {
  it('keeps only units of accessible projects', () => {
    const unidades = [unidad('u1', P_MINE), unidad('u2', P_OTHER)]
    expect(filterUnidadesByProjectAccess(unidades, scope()).map(u => u.id)).toEqual(['u1'])
    expect(filterUnidadesByProjectAccess(unidades, scope({ exempt: true })).map(u => u.id)).toEqual(['u1', 'u2'])
  })

  it('keeps clientes of accessible projects plus the still-unmapped ones', () => {
    const s = scope({ unidades: [unidad('u1', P_MINE, 'cl1'), unidad('u2', P_OTHER, 'cl2')] })
    const clientes = [cliente('cl1'), cliente('cl2'), cliente('cl-new')]
    expect(filterClientesByProjectAccess(clientes, s).map(c => c.id)).toEqual(['cl1', 'cl-new'])
  })
})

describe('resolveConversationProjectId', () => {
  it('stamps the single accessible project of the cliente', () => {
    const s = scope({ unidades: [unidad('u1', P_MINE, 'cl1')] })
    expect(resolveConversationProjectId('cl1', s)).toBe(P_MINE)
  })

  it('returns null when the cliente spans several accessible projects', () => {
    const s = scope({
      accessible: [P_MINE, P_OTHER],
      unidades: [unidad('u1', P_MINE, 'cl1'), unidad('u2', P_OTHER, 'cl1')],
    })
    expect(resolveConversationProjectId('cl1', s)).toBeNull()
  })

  it('ignores projects the user cannot access when picking the stamp', () => {
    const s = scope({ unidades: [unidad('u1', P_MINE, 'cl1'), unidad('u2', P_OTHER, 'cl1')] })
    expect(resolveConversationProjectId('cl1', s)).toBe(P_MINE)
  })

  it('returns null for an unmapped cliente', () => {
    expect(resolveConversationProjectId('cl9', scope())).toBeNull()
    expect(resolveConversationProjectId(null, scope())).toBeNull()
  })
})
