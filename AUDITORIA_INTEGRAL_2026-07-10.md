# Auditoría integral — AdministraTodo vs estándares de la industria

**Fecha:** 2026-07-10 · **Base:** `main@0073e4e` · **Alcance:** solo análisis (sin cambios de código)

**Método:** 11 dimensiones de código analizadas en paralelo + 2 investigaciones de industria
(estado del arte 2025-2026 de la categoría: ComunidadFeliz, Neivor, TownSq, Kiper, AppFolio,
Buildium, Yardi; y estándares técnicos: OWASP ASVS 5.0 L2, SOC 2, WCAG 2.2 AA, RLS multi-tenant,
requisitos enterprise). **Cada brecha de impacto alto/medio fue verificada adversarialmente**
por un agente independiente instruido a refutarla contra el código real:
**46 confirmadas · 13 parciales · 0 refutadas** (de 87 detectadas).

---

## Veredicto ejecutivo

1. **La amplitud funcional es de líder de categoría y los cimientos de ingeniería están muy
   por encima del SaaS LATAM promedio.** Condominios cubre 11/11 sub-dominios del checklist de
   la industria, el backoffice financiero es un ERP genuino de partida doble (Neivor/TownSq no
   lo tienen) y la postura multi-tenant (RLS universal + guard fail-closed en CI) es seria.
2. **Lo menos maduro es lo que decide el negocio: la última milla.** El residente **no puede
   pagar en línea** (el checkout del portal es un placeholder), no hay push ni WhatsApp
   operativos — exactamente el motor de adopción/retención/monetización de la categoría.
3. **La operación está documentada pero no cableada.** Hoy no dispara ninguna alerta de
   runtime, nadie monitorea `/health` y no existe una línea sobre respaldos/PITR/DR.
4. **Hay 3 riesgos de facturación activos** (doble suscripción al cambiar plan, `past_due`
   eterno sin dunning, MRR mal calculado acumulando historia errónea).

> **Síntesis: el motor está construido; falta conectar los cables que cobran, avisan y
> protegen.** Varias piezas ya existen escritas y solo están sin cablear (wizard de onboarding,
> detección de anomalías de consumo, suite E2E, tipos de BD generados, anualidad).

---

## Scorecard por dimensión

| Dimensión | Nota | Resumen |
|---|---|---|
| Contabilidad y finanzas | **A−** | ERP real (partida doble inmutable, asientos automáticos, conciliación difusa, EE