// ════════════════════════════════════════════════════════════════════════════
// Validación del DESTINO del harness RLS. Pura, compartida, sin E/S.
// ════════════════════════════════════════════════════════════════════════════
// La misma comprobación la necesitan tres piezas que corren en contextos
// distintos y que antes NO la compartían:
//
//   · `scripts/seed-rls-sandbox.mjs` — escribe con la service_role (BYPASSRLS).
//     Apuntarlo al proyecto equivocado no es un CI en rojo: son datos de un
//     cliente contaminados.
//   · `scripts/rls-preflight.mjs`    — decide si el job corre, ANTES de
//     instalar dependencias o abrir ninguna conexión.
//   · `src/test/rls/rlsHarness.test.ts` — hace INSERT/UPDATE negativos y, en el
//     camino de limpieza, DELETE. Repite la validación como defensa en
//     profundidad: si alguien cambia el secreto `RLS_SUPABASE_URL` sin tocar el
//     workflow, el harness se niega a conectarse.
//
// Que la lógica viva en un solo módulo es el punto: tres copias divergen, y la
// copia que se quede corta es justo la que escribe donde no debe.
//
// El módulo es deliberadamente PURO —sin leer el disco, sin `process.env`, sin
// red— para que se pueda probar exhaustivamente y para que quien lo llame no
// pueda "casi" validar. Recibe el manifiesto (`coverage.json`) por parámetro.

/**
 * Descompone `https://<ref>.<dominio>` en sus dos partes.
 * @returns {{ ref: string, dominio: string } | null}
 */
export function refDeUrl(url) {
  const m = /^https:\/\/([a-z0-9-]+)\.([a-z0-9.-]+)$/i.exec((url ?? '').trim().replace(/\/+$/, ''))
  return m ? { ref: m[1], dominio: m[2] } : null
}

/**
 * Valida que la URL apunte a un sandbox DECLARADO DE ANTEMANO.
 *
 * Los cuatro cerrojos son acumulativos y ninguno sobra:
 *
 *   1. La URL tiene forma de proyecto Supabase.
 *   2. El dominio está en la lista de `coverage.json`. Sin esto se podría
 *      apuntar a un host cualquiera que hable PostgREST.
 *   3. El ref NO es el de producción. Es la lista negra explícita: protege del
 *      accidente concreto y conocido.
 *   4. El ref coincide EXACTAMENTE con el declarado por el operador. Este es el
 *      que hace el trabajo de verdad: la lista negra sólo cubre UN proyecto y
 *      deja pasar el de otro cliente. Exigir la declaración previa convierte un
 *      copiar-pegar equivocado en un abort, no en una escritura.
 *
 * @param {object} opciones
 * @param {string} opciones.url        URL del proyecto.
 * @param {string} opciones.esperado   Ref declarado por el operador.
 * @param {object} opciones.cobertura  `coverage.json` (dominios y ref de prod).
 * @param {string} [opciones.variable] Nombre de la variable que porta `esperado`,
 *                                     para que el mensaje sea accionable en cada
 *                                     contexto (SEED_EXPECTED_REF vs
 *                                     RLS_EXPECTED_PROJECT_REF).
 * @returns {{ ok: true, ref: string } | { ok: false, clave: string, motivo: string }}
 */
export function validarDestino({ url, esperado, cobertura, variable = 'EXPECTED_REF' }) {
  const partes = refDeUrl(url)
  if (!partes) {
    return {
      ok: false,
      clave: 'url-malformada',
      motivo: `la URL "${url}" no tiene la forma https://<ref>.<dominio>`,
    }
  }

  const dominiosOk = cobertura?.dominiosSandboxPermitidos ?? []
  if (!dominiosOk.some((d) => partes.dominio === d || partes.dominio.endsWith(`.${d}`))) {
    return {
      ok: false,
      clave: 'dominio-desconocido',
      motivo:
        `el dominio "${partes.dominio}" no está reconocido como Supabase ` +
        `(permitidos: ${dominiosOk.join(', ')}). No se opera contra un host desconocido.`,
    }
  }

  const refProd = cobertura?.refProduccionProhibido
  if (refProd && partes.ref === refProd) {
    return {
      ok: false,
      clave: 'produccion',
      motivo:
        `la URL apunta al proyecto de PRODUCCIÓN (${refProd}). El harness crea y borra ` +
        'filas de prueba: usá un proyecto Supabase desechable.',
    }
  }

  if (!esperado) {
    return {
      ok: false,
      clave: 'ref-ausente',
      motivo:
        `falta ${variable}. Declará de antemano el ref del sandbox (aquí sería ` +
        `"${partes.ref}"): sin esa declaración, un copiar-pegar de la URL equivocada ` +
        'bastaría para escribir en el proyecto que no es.',
    }
  }

  if (esperado !== partes.ref) {
    return {
      ok: false,
      clave: 'ref-distinto',
      motivo:
        `${variable}="${esperado}" NO coincide con el ref de la URL ("${partes.ref}"). ` +
        'Abortado: uno de los dos está mal y no se adivina cuál.',
    }
  }

  return { ok: true, ref: partes.ref }
}
