import { useState, useEffect, type ReactNode} from 'react'
import type { AppSection, UserRole, UserSession } from '../../types'
import { WATER_MODULE_KEYS, CONDOMINIOS_MODULE_KEYS } from '../../lib/moduleConfig'
import { getDisplayRoleLabel } from '../../lib/permissions'
import { BrandLogo } from '../shared/BrandLogo'

interface Tab {
  id: AppSection
  label: string
  roles: UserRole[]
  icon: ReactNode
}

type NavEntry =
  | { kind: 'tab'; tab: Tab }
  | { kind: 'group'; id: string; label: string; tabs: Tab[] }

const STORAGE_KEY = 'aquacontrol:sidebar:groups:v2'

const NAV: NavEntry[] = [
  // ── Super admin ──────────────────────────────────────────────────────────────
  {
    kind: 'tab',
    tab: {
      id: 'superadmin_empresas',
      label: 'Empresas',
      roles: ['super_admin'],
      icon: (
        <svg width="18" height="18" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.8} d="M19 21V5a2 2 0 00-2-2H7a2 2 0 00-2 2v16m14 0h2m-2 0h-5m-9 0H3m2 0h5M9 7h1m-1 4h1m4-4h1m-1 4h1m-5 10v-5a1 1 0 011-1h2a1 1 0 011 1v5m-4 0h4" />
        </svg>
      ),
    },
  },
  // ── Grupo 1: Administración Plataforma ───────────────────────────────────────
  {
    kind: 'group',
    id: 'plataforma',
    label: 'Administración Plataforma',
    tabs: [
      {
        id: 'empresa_proyectos',
        label: 'Mis Proyectos',
        roles: ['company_owner'],
        icon: (
          <svg width="18" height="18" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.8} d="M3 7v10a2 2 0 002 2h14a2 2 0 002-2V9a2 2 0 00-2-2h-6l-2-2H5a2 2 0 00-2 2z" />
          </svg>
        ),
      },
      {
        id: 'clientes',
        label: 'Clientes',
        roles: ['admin', 'super_admin', 'operator', 'company_owner'],
        icon: (
          <svg width="18" height="18" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.8} d="M17 20h5v-2a3 3 0 00-5.356-1.857M17 20H7m10 0v-2c0-.656-.126-1.283-.356-1.857M7 20H2v-2a3 3 0 015.356-1.857M7 20v-2c0-.656.126-1.283.356-1.857m0 0a5.002 5.002 0 019.288 0M15 7a3 3 0 11-6 0 3 3 0 016 0z" />
          </svg>
        ),
      },
      {
        id: 'unidades',
        label: 'Unidades',
        roles: ['admin', 'super_admin', 'company_owner'],
        icon: (
          <svg width="18" height="18" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.8} d="M3 12l2-2m0 0l7-7 7 7M5 10v10a1 1 0 001 1h3m10-11l2 2m-2-2v10a1 1 0 01-1 1h-3m-6 0a1 1 0 001-1v-4a1 1 0 011-1h2a1 1 0 011 1v4a1 1 0 001 1m-6 0h6" />
          </svg>
        ),
      },
      {
        id: 'perfil',
        label: 'Mi Cuenta',
        roles: ['admin', 'super_admin', 'operator', 'viewer'],
        icon: (
          <svg width="18" height="18" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.8} d="M16 7a4 4 0 11-8 0 4 4 0 018 0zM12 14a7 7 0 00-7 7h14a7 7 0 00-7-7z" />
          </svg>
        ),
      },
    ],
  },
  // ── Grupo 2: Manejo Agua ─────────────────────────────────────────────────────
  {
    kind: 'group',
    id: 'agua',
    label: 'Manejo Agua',
    tabs: [
      {
        id: 'admin_dashboard',
        label: 'Dashboard',
        roles: ['company_owner'],
        icon: (
          <svg width="18" height="18" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.8} d="M9 19v-6a2 2 0 00-2-2H5a2 2 0 00-2 2v6a2 2 0 002 2h2a2 2 0 002-2zm0 0V9a2 2 0 012-2h2a2 2 0 012 2v10m-6 0a2 2 0 002 2h2a2 2 0 002-2m0 0V5a2 2 0 012-2h2a2 2 0 012 2v14a2 2 0 01-2 2h-2a2 2 0 01-2-2z" />
          </svg>
        ),
      },
      {
        id: 'dashboard',
        label: 'Dashboard',
        roles: ['admin', 'super_admin', 'operator', 'viewer'],
        icon: (
          <svg width="18" height="18" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.8} d="M9 19v-6a2 2 0 00-2-2H5a2 2 0 00-2 2v6a2 2 0 002 2h2a2 2 0 002-2zm0 0V9a2 2 0 012-2h2a2 2 0 012 2v10m-6 0a2 2 0 002 2h2a2 2 0 002-2m0 0V5a2 2 0 012-2h2a2 2 0 012 2v14a2 2 0 01-2 2h-2a2 2 0 01-2-2z" />
          </svg>
        ),
      },
      {
        id: 'comunicacion',
        label: 'Comunicación',
        roles: ['admin', 'super_admin', 'company_owner', 'operator', 'collector', 'viewer'],
        icon: (
          <svg width="18" height="18" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.8} d="M8 12h.01M12 12h.01M16 12h.01M21 12c0 4.418-4.03 8-9 8a9.863 9.863 0 01-4.255-.949L3 20l1.395-3.72C3.512 15.042 3 13.574 3 12c0-4.418 4.03-8 9-8s9 3.582 9 8z" />
          </svg>
        ),
      },
      {
        id: 'contadores',
        label: 'Contadores',
        roles: ['admin', 'super_admin', 'operator', 'company_owner'],
        icon: (
          <svg width="18" height="18" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.8} d="M9 3v2m6-2v2M9 19v2m6-2v2M5 9H3m2 6H3m18-6h-2m2 6h-2M7 19h10a2 2 0 002-2V7a2 2 0 00-2-2H7a2 2 0 00-2 2v10a2 2 0 002 2zM9 9h6v6H9V9z" />
          </svg>
        ),
      },
      {
        id: 'tarifas',
        label: 'Tarifas',
        roles: ['admin', 'super_admin', 'company_owner'],
        icon: (
          <svg width="18" height="18" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.8} d="M7 7h.01M7 3h5c.512 0 1.024.195 1.414.586l7 7a2 2 0 010 2.828l-7 7a2 2 0 01-2.828 0l-7-7A1.994 1.994 0 013 12V7a4 4 0 014-4z" />
          </svg>
        ),
      },
      {
        id: 'cobros',
        label: 'Cobros',
        roles: ['collector', 'admin', 'super_admin', 'company_owner'],
        icon: (
          <svg width="18" height="18" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.8} d="M17 9V7a2 2 0 00-2-2H5a2 2 0 00-2 2v6a2 2 0 002 2h2m2 4h10a2 2 0 002-2v-6a2 2 0 00-2-2H9a2 2 0 00-2 2v6a2 2 0 002 2zm7-5a2 2 0 11-4 0 2 2 0 014 0z" />
          </svg>
        ),
      },
      {
        id: 'lecturas',
        label: 'Nueva Lectura',
        roles: ['admin', 'super_admin', 'operator', 'company_owner'],
        icon: (
          <svg width="18" height="18" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.8} d="M19.428 15.428a2 2 0 00-1.022-.547l-2.384-.477a6 6 0 00-3.86.517l-.318.158a6 6 0 01-3.86.517L6.05 15.21a2 2 0 00-1.806.547M8 4h8l-1 1v5.172a2 2 0 00.586 1.414l5 5c1.26 1.26.367 3.414-1.415 3.414H4.828c-1.782 0-2.674-2.154-1.414-3.414l5-5A2 2 0 009 10.172V5L8 4z" />
          </svg>
        ),
      },
      {
        id: 'rutas',
        label: 'Rutas',
        roles: ['admin', 'super_admin', 'operator', 'company_owner'],
        icon: (
          <svg width="18" height="18" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.8} d="M13 5l7 7-7 7M5 5l7 7-7 7" />
          </svg>
        ),
      },
      {
        id: 'calidad',
        label: 'Calidad Agua',
        roles: ['admin', 'super_admin', 'operator', 'company_owner'],
        icon: (
          <svg width="18" height="18" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.8} d="M19.428 15.428a2 2 0 00-1.022-.547l-2.384-.477a6 6 0 00-3.86.517l-.318.158a6 6 0 01-3.86.517L6.05 15.21a2 2 0 00-1.806.547M8 4h8l-1 1v5.172a2 2 0 00.586 1.414l5 5c1.26 1.26.367 3.414-1.415 3.414H4.828c-1.782 0-2.674-2.154-1.414-3.414l5-5A2 2 0 009 10.172V5L8 4z" />
          </svg>
        ),
      },
      {
        id: 'servicios_energia',
        label: 'Energía',
        roles: ['admin', 'super_admin', 'operator', 'company_owner'],
        icon: (
          <svg width="18" height="18" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.8} d="M13 10V3L4 14h7v7l9-11h-7z" />
          </svg>
        ),
      },
      {
        id: 'mapa',
        label: 'Mapa',
        roles: ['admin', 'super_admin', 'operator', 'viewer', 'company_owner'],
        icon: (
          <svg width="18" height="18" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.8} d="M9 20l-5.447-2.724A1 1 0 013 16.382V5.618a1 1 0 011.447-.894L9 7m0 13l6-3m-6 3V7m6 10l4.553 2.276A1 1 0 0021 18.382V7.618a1 1 0 00-.553-.894L15 4m0 13V4m0 0L9 7" />
          </svg>
        ),
      },
      {
        id: 'tabla',
        label: 'Historial',
        roles: ['admin', 'super_admin', 'operator', 'viewer', 'company_owner'],
        icon: (
          <svg width="18" height="18" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.8} d="M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2m-3 7h3m-3 4h3m-6-4h.01M9 16h.01" />
          </svg>
        ),
      },
    ],
  },
  // ── Grupo 3: Manejo Condominios ──────────────────────────────────────────────
  {
    kind: 'group',
    id: 'condominios_grp',
    label: 'Manejo Condominios',
    tabs: [
      {
        id: 'condominios_dashboard',
        label: 'Panel',
        roles: ['admin', 'super_admin', 'company_owner', 'operator'],
        icon: (
          <svg width="18" height="18" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.8} d="M9 19v-6a2 2 0 00-2-2H5a2 2 0 00-2 2v6a2 2 0 002 2h2a2 2 0 002-2zm0 0V9a2 2 0 012-2h2a2 2 0 012 2v10m-6 0a2 2 0 002 2h2a2 2 0 002-2m0 0V5a2 2 0 012-2h2a2 2 0 012 2v14a2 2 0 01-2 2h-2a2 2 0 01-2-2z" />
          </svg>
        ),
      },
      {
        id: 'condominios_visitantes',
        label: 'Visitantes',
        roles: ['admin', 'super_admin', 'company_owner', 'operator'],
        icon: (
          <svg width="18" height="18" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.8} d="M17 20h5v-2a3 3 0 00-5.356-1.857M17 20H7m10 0v-2c0-.656-.126-1.283-.356-1.857M7 20H2v-2a3 3 0 015.356-1.857M7 20v-2c0-.656.126-1.283.356-1.857m0 0a5.002 5.002 0 019.288 0M15 7a3 3 0 11-6 0 3 3 0 016 0z" />
          </svg>
        ),
      },
      {
        id: 'condominios_cuotas',
        label: 'Cuotas',
        roles: ['admin', 'super_admin', 'company_owner'],
        icon: (
          <svg width="18" height="18" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.8} d="M17 9V7a2 2 0 00-2-2H5a2 2 0 00-2 2v6a2 2 0 002 2h2m2 4h10a2 2 0 002-2v-6a2 2 0 00-2-2H9a2 2 0 00-2 2v6a2 2 0 002 2zm7-5a2 2 0 11-4 0 2 2 0 014 0z" />
          </svg>
        ),
      },
      {
        id: 'condominios_mantenimiento',
        label: 'Mantenimiento',
        roles: ['admin', 'super_admin', 'company_owner', 'operator'],
        icon: (
          <svg width="18" height="18" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.8} d="M10.325 4.317c.426-1.756 2.924-1.756 3.35 0a1.724 1.724 0 002.573 1.066c1.543-.94 3.31.826 2.37 2.37a1.724 1.724 0 001.065 2.572c1.756.426 1.756 2.924 0 3.35a1.724 1.724 0 00-1.066 2.573c.94 1.543-.826 3.31-2.37 2.37a1.724 1.724 0 00-2.572 1.065c-.426 1.756-2.924 1.756-3.35 0a1.724 1.724 0 00-2.573-1.066c-1.543.94-3.31-.826-2.37-2.37a1.724 1.724 0 00-1.065-2.572c-1.756-.426-1.756-2.924 0-3.35a1.724 1.724 0 001.066-2.573c-.94-1.543.826-3.31 2.37-2.37.996.608 2.296.07 2.572-1.065z" /><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.8} d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
          </svg>
        ),
      },
      {
        id: 'condominios',
        label: 'Módulo Completo',
        roles: ['admin', 'super_admin', 'company_owner', 'operator'],
        icon: (
          <svg width="18" height="18" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.8} d="M19 21V5a2 2 0 00-2-2H7a2 2 0 00-2 2v16m14 0h2m-2 0h-5m-9 0H3m2 0h5M9 7h1m-1 4h1m4-4h1m-1 4h1m-5 10v-5a1 1 0 011-1h2a1 1 0 011 1v5m-4 0h4" />
          </svg>
        ),
      },
    ],
  },
  // ── Config. del sistema (standalone) ────────────────────────────────────────
  {
    kind: 'tab',
    tab: {
      id: 'configuracion',
      label: 'Config. del sistema',
      roles: ['admin', 'super_admin'],
      icon: (
        <svg width="18" height="18" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.8} d="M10.325 4.317c.426-1.756 2.924-1.756 3.35 0a1.724 1.724 0 002.573 1.066c1.543-.94 3.31.826 2.37 2.37a1.724 1.724 0 001.065 2.572c1.756.426 1.756 2.924 0 3.35a1.724 1.724 0 00-1.066 2.573c.94 1.543-.826 3.31-2.37 2.37a1.724 1.724 0 00-2.572 1.065c-.426 1.756-2.924 1.756-3.35 0a1.724 1.724 0 00-2.573-1.066c-1.543.94-3.31-.826-2.37-2.37a1.724 1.724 0 00-1.065-2.572c-1.756-.426-1.756-2.924 0-3.35a1.724 1.724 0 001.066-2.573c-.94-1.543.826-3.31 2.37-2.37.996.608 2.296.07 2.572-1.065z" />
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.8} d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
        </svg>
      ),
    },
  },
]

interface Props {
  activeSection: AppSection
  userRole: UserRole
  currentUser: UserSession
  canViewModule: (moduleKey: string) => boolean
  onSelect: (section: AppSection) => void
  onLogout: () => void
  isOpen: boolean
  unreadComunicacion?: number
}

function getInitials(name: string): string {
  return name
    .split(' ')
    .slice(0, 2)
    .map(n => n[0])
    .join('')
    .toUpperCase()
}

const NON_CONFIGURABLE = ['perfil', 'admin_dashboard', 'empresa_proyectos', 'superadmin_empresas']
const BYPASS_ROLES: UserRole[] = ['super_admin', 'company_owner']

function isServiceEnabled(tabId: string, session: UserSession): boolean {
  const isExempt = (['super_admin', 'company_owner'] as string[]).includes(session.role)
  if (WATER_MODULE_KEYS.has(tabId)) {
    if (session.servicio_agua === false) return false
    if (isExempt) return true
    if (!session.permissions) return false
    for (const key of session.permissions) {
      if (key.startsWith('agua.')) return true
    }
    return false
  }
  if (CONDOMINIOS_MODULE_KEYS.has(tabId)) {
    if (session.servicio_condominios === false) return false
    if (isExempt) return true
    if (!session.permissions) return false
    for (const key of session.permissions) {
      if (key.startsWith('condominios.')) return true
    }
    return false
  }
  return true
}

function isTabVisible(tab: Tab, userRole: UserRole, canViewModule: (key: string) => boolean): boolean {
  if (NON_CONFIGURABLE.includes(tab.id)) return tab.roles.includes(userRole)
  if (BYPASS_ROLES.includes(userRole)) return tab.roles.includes(userRole)
  return canViewModule(tab.id)
}

function findActiveGroupId(activeSection: AppSection): string | null {
  for (const entry of NAV) {
    if (entry.kind === 'group' && entry.tabs.some(t => t.id === activeSection)) {
      return entry.id
    }
  }
  return null
}

export function Sidebar({ activeSection, userRole, currentUser, canViewModule, onSelect, onLogout, isOpen, unreadComunicacion = 0 }: Props) {
  const [hoveredTab, setHoveredTab] = useState<AppSection | null>(null)
  const [hoveredLogout, setHoveredLogout] = useState(false)
  const [hoveredProfile, setHoveredProfile] = useState(false)
  const [hoveredGroup, setHoveredGroup] = useState<string | null>(null)

  const [expanded, setExpanded] = useState<Record<string, boolean>>(() => {
    const initialActiveGroupId = findActiveGroupId(activeSection)
    try {
      const stored: Record<string, boolean> = JSON.parse(localStorage.getItem(STORAGE_KEY) || '{}')
      const hasStoredData = Object.keys(stored).length > 0
      const isMobile = typeof window !== 'undefined' && window.innerWidth < 768
      const defaults: Record<string, boolean> = {}
      for (const entry of NAV) {
        if (entry.kind === 'group') {
          defaults[entry.id] = hasStoredData
            ? (stored[entry.id] !== undefined ? stored[entry.id] : !isMobile)
            : !isMobile
        }
      }
      if (initialActiveGroupId) defaults[initialActiveGroupId] = true
      return defaults
    } catch {
      const defaults: Record<string, boolean> = {}
      for (const entry of NAV) {
        if (entry.kind === 'group') defaults[entry.id] = true
      }
      if (initialActiveGroupId) defaults[initialActiveGroupId] = true
      return defaults
    }
  })

  useEffect(() => {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(expanded))
  }, [expanded])

  // Auto-expand group when active section is inside a collapsed group
  useEffect(() => {
    const gid = findActiveGroupId(activeSection)
    if (gid) {
      setExpanded(prev => prev[gid] ? prev : { ...prev, [gid]: true })
    }
  }, [activeSection])

  const toggleGroup = (groupId: string) => {
    setExpanded(prev => ({ ...prev, [groupId]: !prev[groupId] }))
  }

  const renderTabButton = (tab: Tab) => {
    const isActive = activeSection === tab.id
    const isHovered = hoveredTab === tab.id
    return (
      <button
        key={tab.id}
        aria-label={`Ir a ${tab.label}`}
        aria-current={isActive ? 'page' : undefined}
        onClick={() => onSelect(tab.id)}
        onMouseEnter={() => setHoveredTab(tab.id)}
        onMouseLeave={() => setHoveredTab(null)}
        style={{
          width: '100%',
          display: 'flex',
          alignItems: 'center',
          gap: '10px',
          padding: '12px 14px',
          minHeight: '44px',
          border: 'none',
          borderRadius: '10px',
          cursor: 'pointer',
          textAlign: 'left',
          marginBottom: '1px',
          transition: 'all 0.14s ease',
          background: isActive
            ? 'rgba(255,255,255,0.12)'
            : isHovered
            ? 'rgba(255,255,255,0.05)'
            : 'transparent',
          color: isActive ? '#ffffff' : isHovered ? '#cbd5e1' : '#9ca3af',
          fontWeight: isActive ? 600 : 400,
          fontSize: '13.5px',
          letterSpacing: isActive ? '-0.1px' : '0',
          outline: 'none',
        }}
      >
        <span
          style={{
            flexShrink: 0,
            width: '28px',
            height: '28px',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            borderRadius: '7px',
            background: isActive
              ? 'rgba(185,106,63,0.30)'
              : isHovered
              ? 'rgba(255,255,255,0.07)'
              : 'transparent',
            color: isActive ? '#ffffff' : isHovered ? '#94a3b8' : '#4b5563',
            transition: 'all 0.14s ease',
          }}
        >
          {tab.icon}
        </span>
        {tab.label}
        {isActive && (
          <span style={{
            marginLeft: 'auto',
            width: '5px',
            height: '5px',
            borderRadius: '50%',
            background: 'var(--at-accent)',
            boxShadow: '0 0 6px rgba(185,106,63,0.7)',
            flexShrink: 0,
          }} />
        )}
      </button>
    )
  }

  return (
    <aside
      role="navigation"
      aria-label="Menu principal"
      className={`app-sidebar${isOpen ? ' open' : ''}`}
      style={{
        width: '256px',
        minWidth: '256px',
        background: '#102622',
        display: 'flex',
        flexDirection: 'column',
        height: '100vh',
        position: 'sticky',
        top: 0,
        overflowY: 'auto',
        transition: 'transform 0.28s cubic-bezier(0.4, 0, 0.2, 1)',
        borderRight: '1px solid rgba(255,255,255,0.05)',
      }}
    >
      {/* ── Brand ───────────────────────────────────────────── */}
      <div style={{ padding: '22px 20px 20px', borderBottom: '1px solid rgba(255,255,255,0.06)' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
          <div style={{ flexShrink: 0, lineHeight: 0, boxShadow: '0 4px 14px rgba(0,0,0,0.25)', borderRadius: '11px' }}>
            <BrandLogo size={38} />
          </div>
          <div>
            <div style={{ color: '#f1f5f9', fontWeight: 700, fontSize: '15px', letterSpacing: '-0.3px', lineHeight: '1.2' }}>
              AdministraTodo
            </div>
            <div style={{ color: '#4b5563', fontSize: '11px', marginTop: '2px', letterSpacing: '0.02em' }}>
              Agua + Condominios
            </div>
          </div>
        </div>
      </div>

      {/* ── Navigation ──────────────────────────────────────── */}
      <nav style={{ flex: 1, padding: '10px 10px', overflowY: 'auto' }}>
        {NAV.map(entry => {
          if (entry.kind === 'tab') {
            if (!isTabVisible(entry.tab, userRole, canViewModule)) return null
            if (!isServiceEnabled(entry.tab.id, currentUser)) return null
            return renderTabButton(entry.tab)
          }

          // Group entry
          const visibleTabs = entry.tabs.filter(t =>
            isTabVisible(t, userRole, canViewModule) && isServiceEnabled(t.id, currentUser)
          )
          if (visibleTabs.length === 0) return null

          const isExpanded = expanded[entry.id] ?? true
          const isHG = hoveredGroup === entry.id

          return (
            <div key={entry.id} style={{ marginTop: '12px' }}>
              <button
                aria-expanded={isExpanded}
                aria-controls={`group-${entry.id}`}
                onClick={() => toggleGroup(entry.id)}
                onMouseEnter={() => setHoveredGroup(entry.id)}
                onMouseLeave={() => setHoveredGroup(null)}
                style={{
                  width: '100%',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'space-between',
                  padding: '6px 10px',
                  border: 'none',
                  background: 'transparent',
                  cursor: 'pointer',
                  color: isHG ? '#9ca3af' : '#6b7280',
                  fontSize: '11px',
                  fontWeight: 700,
                  letterSpacing: '0.1em',
                  textTransform: 'uppercase',
                  outline: 'none',
                  borderRadius: '6px',
                  marginBottom: '2px',
                }}
              >
                <span style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                  {entry.label}
                  {entry.id === 'comunicacion' && unreadComunicacion > 0 && (
                    <span style={{
                      width: '7px', height: '7px', borderRadius: '50%',
                      background: '#ef4444',
                      boxShadow: '0 0 6px rgba(239,68,68,0.7)',
                      flexShrink: 0,
                    }} />
                  )}
                </span>
                <svg
                  width="12"
                  height="12"
                  fill="none"
                  stroke="currentColor"
                  viewBox="0 0 24 24"
                  style={{
                    transform: isExpanded ? 'rotate(90deg)' : 'rotate(0deg)',
                    transition: 'transform 0.22s ease',
                    flexShrink: 0,
                  }}
                >
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M9 5l7 7-7 7" />
                </svg>
              </button>
              <div
                id={`group-${entry.id}`}
                style={{
                  maxHeight: isExpanded ? '600px' : '0',
                  overflow: 'hidden',
                  opacity: isExpanded ? 1 : 0,
                  transition: 'max-height 0.22s ease, opacity 0.18s ease',
                }}
              >
                {visibleTabs.map(tab => renderTabButton(tab))}
              </div>
            </div>
          )
        })}
      </nav>

      {/* ── User footer ──────────────────────────────────────── */}
      <div style={{ padding: '12px', borderTop: '1px solid rgba(255,255,255,0.06)' }}>
        {/* Profile button */}
        <button
          onClick={() => onSelect('perfil')}
          onMouseEnter={() => setHoveredProfile(true)}
          onMouseLeave={() => setHoveredProfile(false)}
          style={{
            width: '100%',
            display: 'flex',
            alignItems: 'center',
            gap: '10px',
            padding: '9px 10px',
            borderRadius: '10px',
            background: hoveredProfile ? 'rgba(255,255,255,0.08)' : 'rgba(255,255,255,0.04)',
            marginBottom: '6px',
            border: '1px solid',
            borderColor: hoveredProfile ? 'rgba(255,255,255,0.14)' : 'rgba(255,255,255,0.05)',
            cursor: 'pointer',
            textAlign: 'left',
            transition: 'all 0.15s ease',
            outline: 'none',
          }}
        >
          <div
            style={{
              width: '34px',
              height: '34px',
              borderRadius: '50%',
              background: 'linear-gradient(135deg, #577B69 0%, #B96A3F 100%)',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              color: 'white',
              fontWeight: 700,
              fontSize: '12px',
              flexShrink: 0,
              boxShadow: '0 2px 8px rgba(0,0,0,0.3)',
            }}
          >
            {getInitials(currentUser.name)}
          </div>
          <div style={{ overflow: 'hidden', flex: 1 }}>
            <div style={{
              color: '#e2e8f0',
              fontWeight: 600,
              fontSize: '13px',
              whiteSpace: 'nowrap',
              overflow: 'hidden',
              textOverflow: 'ellipsis',
              lineHeight: '1.3',
            }}>
              {currentUser.name}
            </div>
            <div style={{ color: '#4b5563', fontSize: '11px', marginTop: '1px' }}>
              {getDisplayRoleLabel(currentUser)}
            </div>
          </div>
          <svg width="13" height="13" fill="none" stroke="#374151" viewBox="0 0 24 24" style={{ flexShrink: 0 }}>
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
          </svg>
        </button>

        {/* Logout button */}
        <button
          onClick={onLogout}
          onMouseEnter={() => setHoveredLogout(true)}
          onMouseLeave={() => setHoveredLogout(false)}
          style={{
            width: '100%',
            display: 'flex',
            alignItems: 'center',
            gap: '9px',
            padding: '8px 10px',
            border: 'none',
            borderRadius: '8px',
            cursor: 'pointer',
            background: hoveredLogout ? 'rgba(239,68,68,0.1)' : 'transparent',
            color: hoveredLogout ? '#f87171' : '#4b5563',
            fontSize: '13px',
            fontWeight: 500,
            transition: 'all 0.14s ease',
            outline: 'none',
          }}
        >
          <svg width="15" height="15" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M17 16l4-4m0 0l-4-4m4 4H7m6 4v1a3 3 0 01-3 3H6a3 3 0 01-3-3V7a3 3 0 013-3h4a3 3 0 013 3v1" />
          </svg>
          Cerrar sesión
        </button>
      </div>
    </aside>
  )
}
