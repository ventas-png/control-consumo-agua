# 🔐 SECURITY AUDIT + UX RESPONSIVITY REPORT
**Fecha:** 2026-04-07  
**Proyecto:** Control de Consumo de Agua (AquaControl)  
**Estado General:** ✅ Buena postura de seguridad + ⚠️ UX/Responsivity con mejoras necesarias

---

## 📊 RESUMEN EJECUTIVO

| Categoría | Estado | Problemas Críticos | Acción |
|-----------|--------|-------------------|--------|
| **Seguridad - Exposición de datos** | ✅ BUENO | 0 hallazgos críticos | Mantener |
| **Seguridad - Aislamiento multi-empresa** | ⚠️ MEJORABLE | 2 críticos en Edge Functions | INMEDIATO |
| **Seguridad - Control de Roles** | ✅ BUENO | 0 hallazgos críticos | Mantener |
| **Seguridad - Input Validation** | ✅ BUENO | Mejoras menores | Próxima sprint |
| **UX - Mobile Responsivity** | ❌ CRÍTICO | 6 issues altos | INMEDIATO |
| **UX - Tablet Layout** | ⚠️ MEJORABLE | 3 issues medios | PRÓXIMA SPRINT |
| **UX - Accessibility** | ❌ CRÍTICO | 7 issues altos | INMEDIATO |
| **UX - Touch Targets** | ⚠️ MEJORABLE | 4 issues medios | PRÓXIMA SPRINT |

---

## 🚨 CRÍTICO - SEGURIDAD (Fijar AHORA)

### 1️⃣ create-payment-intent NO valida que el usuario pertenece a la empresa
**Archivo:** `supabase/functions/create-payment-intent/index.ts` (líneas 38-69)  
**Riesgo:** Un usuario autenticado de Empresa A puede crear payment intents para registros de Empresa B  
**Impacto:** Cross-company payment creation, exposición de registros de otras empresas

**Solución (5 min):**
```typescript
// Agregar después de línea 44:
const { data: callerProfile } = await callerClient
  .from('app_users')
  .select('company_id')
  .eq('id', caller.id)
  .single()

if (callerProfile?.company_id !== company_id) {
  return new Response(JSON.stringify({ error: 'Cannot create payment for other companies' }), {
    status: 403, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  })
}
```

### 2️⃣ stripe-webhook-handler confía en metadata sin validar
**Archivo:** `supabase/functions/stripe-webhook-handler/index.ts` (líneas 81-128)  
**Riesgo:** Si metadata es manipulada, podría crear pagos en la empresa incorrecta  
**Impacto:** Medio (Stripe signature válida es buena mitigación), pero falta validación explícita

**Solución (3 min):**
```typescript
// En payment_intent.succeeded (línea 91), agregar:
if (paymentRequest.company_id !== companyId) {
  console.error('Company mismatch in webhook')
  return new Response(JSON.stringify({ error: 'Company validation failed' }), {
    status: 400, headers: { 'Content-Type': 'application/json' },
  })
}
```

### 3️⃣ useData.ts carga registros sin filtro de company_id
**Archivo:** `src/hooks/useData.ts` (líneas 79-86)  
**Riesgo:** Depende 100% de RLS; si RLS está desactivada, todos los registros de todas las empresas son visibles  
**Impacto:** Defensa en profundidad - agregar validación aplicación

**Solución (8 min):** Añadir filters explícitos a queries críticas:
```typescript
// src/hooks/useData.ts línea ~105
const fetchAllData = async (companyId: string) => {
  // Añadir .eq('company_id', companyId) donde aplicable
  const registros = await supabase
    .from('registros')
    .select('*')
    .eq('company_id', companyId)  // ← AGREGAR ESTA LÍNEA
}
```

---

## 🎨 CRÍTICO - UX/RESPONSIVITY (Fijar AHORA)

### 1️⃣ Tablas no son responsivas en móvil
**Archivos:** ContadoresSection, AdminHistoryTab, CobrosSection, CalidadSection  
**Problema:** Tablas con 5+ columnas causan horizontal scroll en teléfonos (375px)  
**Severidad:** Rompe experiencia móvil completamente

**Solución (30 min):** Agregar a `src/index.css`:
```css
/* Mobile table: hide secondary columns */
@media (max-width: 640px) {
  .table-col-secondary {
    display: none !important;
  }
  /* Convertir tablas a layout de bloques en móvil */
  table.mobile-responsive {
    display: block;
    width: 100%;
  }
  table.mobile-responsive thead {
    display: none;
  }
  table.mobile-responsive tbody,
  table.mobile-responsive tr,
  table.mobile-responsive td {
    display: block;
    width: 100%;
  }
  table.mobile-responsive tr {
    margin-bottom: 15px;
    border: 1px solid #e2e8f0;
    border-radius: 8px;
  }
  table.mobile-responsive td::before {
    content: attr(data-label);
    font-weight: 600;
    display: inline-block;
    width: 120px;
  }
}
```

### 2️⃣ Modales no se adaptan a pantallas pequeñas
**Archivos:** EditModal.tsx, ContadoresSection.tsx (modales)  
**Problema:** maxWidth='760px' en teléfono 375px = unlegible (96% de pantalla)  
**Severidad:** Modales completamente inutilizables en móvil

**Solución (5 min):** Cambiar maxWidth en todos los modales:
```typescript
// De: maxWidth="760px"
// A:
const responsiveWidth = window.innerWidth < 480 ? '95vw' : Math.min(760, window.innerWidth - 40)
// O más simple:
maxWidth={`min(760px, 95vw)`}
```

### 3️⃣ Falta ARIA labels + accesibilidad en iconos
**Archivos:** Sidebar.tsx, Topbar.tsx, EditModal.tsx, todas las secciones  
**Problema:** 20+ botones de ícono sin aria-label; tablas sin scope; formularios sin htmlFor  
**Severidad:** Completamente inaccesible para screen readers

**Ejemplos de fixes:**
```typescript
// Sidebar.tsx línea ~350
<button
  aria-label={`Ir a ${tab.label}`}  // ← AGREGAR
  title={tab.label}
  onClick={() => {...}}
>
  {tab.icon}
</button>

// EditModal close button
<button
  aria-label="Cerrar modal"  // ← AGREGAR
  onClick={onClose}
  style={{ padding: '12px', minHeight: '44px', minWidth: '44px' }}  // ← AUMENTAR SIZE
>
  ✕
</button>

// Tablas
<th scope="col">Fecha</th>  // ← AGREGAR scope
```

### 4️⃣ Botones y checkboxes demasiado pequeños para móvil
**Archivos:** Todas las secciones con checkboxes, EditModal close button  
**Problema:** Touch targets < 44x44px es difícil en teléfono  
**Severidad:** Mala UX móvil, inaccesible

**Solución (15 min):** Standardizar touch targets:
```typescript
// Todos los botones, checkboxes, inputs
minHeight: '44px'
minWidth: '44px'  // Para botones cuadrados
padding: '12px 16px'  // Mínimo para botones

// Checkboxes especialmente
<input 
  type="checkbox" 
  style={{ 
    width: '24px',  // De 16px a 24px
    height: '24px',
    cursor: 'pointer',
    margin: '10px'  // Padding around checkbox
  }}
/>
```

---

## ⚠️ ALTO - SEGURIDAD (Próxima sprint, pero importante)

### 1️⃣ Input sanitization incomplete
**Archivo:** `src/lib/validation.ts`  
**Problema:** sanitizeInput no detecta ataques SVG/CSS  
**Solución:** Usar [DOMPurify](https://github.com/cure53/DOMPurify) o mejorar regex

### 2️⃣ StripePayPalConfig muestra textarea para secret keys
**Archivo:** `src/components/empresa/StripePayPalConfig.tsx`  
**Problema:** Usuarios escriben keys en textarea visible (keylogger risk)  
**Solución:** Masked input + copy-paste only, no display

---

## ⚠️ MEDIO - UX (Próxima sprint)

### 1️⃣ Tablet layout (768px-1024px)
- Sidebar 256px = 25% de pantalla, demasiado
- Solución: Reducir a 200px o hacer collapsible

### 2️⃣ Chart grids con minmax(400px)
- En tablet, solo 2 columnas, muy pocas
- Solución: Cambiar a `minmax(300px, 1fr)`

### 3️⃣ Placeholder text color contrast
- `#94a3b8` es muy claro (WCAG fail)
- Solución: Cambiar a `#64748b` (más oscuro)

### 4️⃣ Modal close button demasiado sutil
- Botón X pequeño + gris claro
- Solución: 44x44px + color más oscuro + title/aria-label

---

## ✅ LO QUE ESTÁ BIEN

### Seguridad - Positivos:
- ✅ Secretos de Stripe/PayPal NO expuestos en frontend
- ✅ PII (emails, teléfonos) no almacenada en localStorage
- ✅ Sessions en sessionStorage, no localStorage
- ✅ Políticas RLS robustas en todas las tablas críticas
- ✅ JWT validation en todos los Edge Functions
- ✅ Stripe webhook signature verification implementado
- ✅ RoleGuard wrapper en secciones sensibles
- ✅ Rate limiting en login implementado
- ✅ Password policy forte (8 chars, mayús, minús, número)

### UX - Positivos:
- ✅ Hamburger menu en móvil
- ✅ Topbar responsive
- ✅ Sidebar collapsible
- ✅ Modales con padding
- ✅ Focus states definidos
- ✅ Print stylesheet incluido

---

## 📋 PLAN DE ACCIÓN

### SEMANA 1 - CRÍTICOS (Estimado: 2 hrs)
1. ✅ Fijar create-payment-intent validation (5 min)
2. ✅ Fijar stripe-webhook-handler validation (3 min)
3. ✅ Agregar ARIA labels a botones (30 min)
4. ✅ Agregar scope="col" a tablas (15 min)
5. ✅ Hacer tablas responsivas en móvil (30 min)
6. ✅ Fijar modal responsive width (15 min)
7. ✅ Aumentar touch targets a 44px (20 min)

### SEMANA 2 - ALTOS (Estimado: 3 hrs)
1. Agregar htmlFor/id a formularios (30 min)
2. Agregar role="dialog" a modales (20 min)
3. Agregar focus trap en modales (30 min)
4. Mejorar loading states en móvil (30 min)
5. Mejorar error message display (20 min)
6. Mejorar placeholder contrast (10 min)
7. Agregar scroll hints en tablas (20 min)

### SEMANA 3 - MEDIOS (Estimado: 2 hrs)
1. Optimizar Sidebar width tablet (20 min)
2. Agregar 768px-1024px breakpoints (45 min)
3. Actualizar chart grid minmax (15 min)
4. Mejorar color contrast (15 min)
5. DOMPurify para sanitization (30 min)

---

## 🎯 RECOMENDACIONES FINALES

### Inmediatas (HOY):
1. Fijar los 2 críticos de seguridad en Edge Functions (8 min)
2. Hacer tablas responsivas (30 min)
3. Agregar ARIA labels (30 min)
4. Aumentar touch targets (20 min)

### Próximos pasos:
- Usar [DOMPurify](https://github.com/cure53/DOMPurify) para sanitization
- Considerar Storybook para component testing en diferentes viewports
- Setup automated accessibility testing (jest-axe)
- Regular security audits cada 2 sprints

### Tools recomendadas:
- **Accessibility:** axe DevTools, WAVE, lighthouse
- **Security:** OWASP ZAP, npm audit
- **Performance:** Chrome DevTools, Lighthouse
- **Responsivity:** Chrome DevTools device simulator

---

## 📎 ARCHIVOS CRÍTICOS A REVISAR

### Seguridad (INMEDIATO):
- `supabase/functions/create-payment-intent/index.ts` - agregar validación
- `supabase/functions/stripe-webhook-handler/index.ts` - agregar validación
- `src/hooks/useData.ts` - agregar filtros company_id

### UX/Responsivity (INMEDIATO):
- `src/index.css` - agregar media queries
- `src/components/shared/EditModal.tsx` - responsive width + accessibility
- `src/components/admin-dashboard/AdminHistoryTab.tsx` - table accessibility
- `src/components/layout/Sidebar.tsx` - aria-labels

---

**Próxima revisión:** 2026-04-14 (1 semana)  
**Contacto:** Security & UX Team
