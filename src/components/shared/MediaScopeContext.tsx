import { createContext, useContext, type ReactNode } from 'react'

// Active project_id for condominios-media uploads (infra:I14).
//
// The `condominios-media` storage bucket scopes objects by project_id as the
// first path segment — `${project_id}/<categoría>/<archivo>` — so the storage
// RLS policies can isolate tenants (a logged-in user must not read/write media
// of another condominio/company). The generic uploaders (ImageUploader,
// MultiImageUploader, FileUploader) are reused across ~16 tabs and don't know
// which project they're rendered in, so the active project_id is provided via
// this context instead of threading a prop through every (often deeply nested)
// call-site.
//
// Two providers mount it:
//   * staff  → CondominiosSection wraps the tab content with the selected project.
//   * portal → CondominiosClientPortal wraps the resident tabs with their unit's
//              project_id.
// An uploader rendered outside a provider gets '' and refuses to upload (the new
// storage policy would reject an unscoped path anyway, so we fail loudly+early).

const MediaScopeContext = createContext<string>('')

export function MediaScopeProvider({ projectId, children }: { projectId: string; children: ReactNode }) {
  return <MediaScopeContext.Provider value={projectId}>{children}</MediaScopeContext.Provider>
}

/** Returns the active project_id for media uploads, or '' if outside a provider. */
export function useMediaScope(): string {
  return useContext(MediaScopeContext)
}
