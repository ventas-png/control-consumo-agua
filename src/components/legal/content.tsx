// Contenido legal de AdministraTodo (administratodo.com), transcrito fielmente de
// los documentos oficiales VFinal-2026. El CONTENIDO vive aquí (front público); el
// catálogo versionado + el rastro de aceptación viven en la BD (legal_documents /
// legal_acceptances). Las páginas son 100% públicas e indexables (ver App.tsx y
// public/robots.txt). El texto está en español: son documentos jurídicos cuya
// versión vinculante es la castellana.

import type { ReactElement } from 'react'

export type LegalDocType = 'privacy' | 'tos' | 'dpa'

/** Rutas públicas canónicas de cada documento (usadas por el footer, el click-wrap
 *  del registro, el sitemap y los enlaces cruzados internos). */
export const LEGAL_PATHS: Record<LegalDocType, string> = {
  privacy: '/politica-privacidad',
  tos: '/terminos-servicio',
  dpa: '/acuerdo-dpa-cookies',
}

export interface LegalDocMeta {
  /** H1 visible en la página. */
  title: string
  /** <title> del documento (SEO). */
  metaTitle: string
  /** <meta name="description"> (SEO, transparencia legal corporativa). */
  metaDescription: string
  /** Línea de "Última actualización". */
  updated: string
}

export const LEGAL_META: Record<LegalDocType, LegalDocMeta> = {
  privacy: {
    title: 'Política de Privacidad',
    metaTitle: 'Política de Privacidad | AdministraTodo',
    metaDescription:
      'Política de Privacidad de administratodo.com: cómo recopilamos, tratamos y protegemos tus datos personales conforme al RGPD, la CCPA/CPRA y las normativas de protección de datos de América Latina.',
    updated: 'Última actualización: 5 de junio de 2026',
  },
  tos: {
    title: 'Términos de Servicio',
    metaTitle: 'Términos de Servicio | AdministraTodo',
    metaDescription:
      'Términos de Servicio de administratodo.com: condiciones del software SaaS multiempresa y multiproyecto, suscripciones, pagos recurrentes, propiedad de los datos y resolución de disputas en LATAM.',
    updated: 'Última actualización: 4 de junio de 2026',
  },
  dpa: {
    title: 'Anexo DPA y Política de Cookies',
    metaTitle: 'Anexo DPA y Política de Cookies | AdministraTodo',
    metaDescription:
      'Anexo de Procesamiento de Datos (DPA) y Política de Cookies de administratodo.com: roles de responsable y encargado del tratamiento, subprocesadores, medidas de seguridad y gestión de cookies conforme al RGPD.',
    updated: 'Última actualización: 4 de junio de 2026',
  },
}

const SUPPORT_EMAIL = 'soporte@administratodo.com'

function Mail() {
  return <a href={`mailto:${SUPPORT_EMAIL}`}>{SUPPORT_EMAIL}</a>
}

// ────────────────────────────────────────────────────────────────────────────
// Política de Privacidad
// ────────────────────────────────────────────────────────────────────────────
function PrivacyBody(): ReactElement {
  return (
    <>
      <p>
        En administratodo.com (en adelante, «la Plataforma», «el SaaS» o «Nosotros»), nos comprometemos
        firmemente a proteger la privacidad, confidencialidad y seguridad de los datos personales de
        nuestros usuarios. Esta Política de Privacidad constituye un todo integrado con nuestros{' '}
        <a href={LEGAL_PATHS.tos}>Términos de Servicio</a> y el{' '}
        <a href={LEGAL_PATHS.dpa}>Anexo de Procesamiento de Datos (DPA)</a>, diseñados bajo los
        estándares internacionales más exigentes, incluyendo el Reglamento General de Protección de
        Datos (RGPD), la Ley de Privacidad del Consumidor de California (CCPA/CPRA) y las normativas de
        protección de datos vigentes en América Latina.
      </p>
      <p>
        Este documento es una pieza fundamental para la transparencia operativa y los procesos de
        verificación de plataformas globales de terceros, incluyendo la autorización de aplicaciones de
        Google.
      </p>

      <h2>1. Flujo de aceptación expresa y vinculación jurídica (Click-wrap)</h2>
      <p>
        Esta Política de Privacidad no es un documento de lectura pasiva. Al registrar una cuenta, dar de
        alta una organización o utilizar los Servicios, el Administrador Principal y cada Usuario
        Autorizado deben aceptar de forma afirmativa este documento mediante una casilla de verificación
        desmarcada por defecto (mecanismo Click-wrap).
      </p>
      <p>
        La Plataforma registrará de forma automatizada e inalterable en sus bases de datos la dirección
        IP de origen, la fecha, la hora exacta y la versión del documento aceptado. Dicho registro
        constituirá prueba legal plena de consentimiento ante entidades bancarias, disputas de
        contracargos, auditorías fiscales y procesos de certificación de tiendas de aplicaciones de
        terceros.
      </p>

      <h2>2. Información que recopilamos</h2>
      <p>
        Para prestar los servicios SaaS multiempresa de manera óptima, recopilamos las siguientes
        categorías de información:
      </p>
      <h3>A. Información proporcionada directamente por el Usuario</h3>
      <ul>
        <li>
          <strong>Datos de registro y cuenta:</strong> nombre, apellidos, dirección de correo
          electrónico, número de teléfono y credenciales de acceso encriptadas.
        </li>
        <li>
          <strong>Datos fiscales de facturación local:</strong> razón social, identificaciones fiscales
          gubernamentales (por ejemplo, NIT en Guatemala, RTU, RUC, RFC o el equivalente en la
          jurisdicción de LATAM correspondiente) y dirección física de facturación.
        </li>
        <li>
          <strong>Comunicaciones:</strong> datos enviados a través de formularios de contacto, tickets de
          soporte técnico o correos electrónicos dirigidos a <Mail />.
        </li>
      </ul>
      <h3>B. Información recopilada automáticamente</h3>
      <ul>
        <li>
          <strong>Datos de conexión y dispositivo:</strong> dirección IP, tipo de navegador, sistema
          operativo, identificadores únicos de dispositivos de acceso, configuración de idioma y zona
          horaria.
        </li>
        <li>
          <strong>Datos de uso de la infraestructura:</strong> páginas y módulos visitados dentro de la
          Plataforma, tiempo de permanencia, clics, flujos de navegación e interacciones entre empresas y
          proyectos.
        </li>
        <li>
          <strong>Cookies y tecnologías de rastreo:</strong> datos recopilados mediante cookies
          esenciales, analíticas y funcionales de conformidad con nuestra{' '}
          <a href={LEGAL_PATHS.dpa}>Política de Cookies</a>.
        </li>
      </ul>

      <h2>3. Finalidades y base legal del tratamiento de datos</h2>
      <p>
        Tratamos los datos personales únicamente cuando contamos con una base legal válida de acuerdo con
        los estándares internacionales de privacidad, detallados a continuación:
      </p>
      <div className="legal-table-wrap">
        <table>
          <thead>
            <tr>
              <th>Finalidad del tratamiento</th>
              <th>Descripción detallada</th>
              <th>Base legal aplicable</th>
            </tr>
          </thead>
          <tbody>
            <tr>
              <td>Prestación del Servicio SaaS</td>
              <td>
                Gestionar las cuentas de usuario, permitir el funcionamiento del entorno multiempresa y
                multiproyecto, proveer soporte técnico y procesar las transacciones financieras
                recurrentes.
              </td>
              <td>Ejecución de un contrato</td>
            </tr>
            <tr>
              <td>Cumplimiento tributario en LATAM</td>
              <td>
                Procesar la información fiscal requerida para la emisión de facturas electrónicas
                (Régimen FEL, CFDI o equivalentes regionales) por los cobros de la suscripción.
              </td>
              <td>Obligación legal</td>
            </tr>
            <tr>
              <td>Mejora de la infraestructura</td>
              <td>
                Analizar estadísticas agregadas de uso para optimizar el rendimiento de la Plataforma,
                corregir errores y desarrollar nuevas herramientas administrativas.
              </td>
              <td>Interés legítimo</td>
            </tr>
            <tr>
              <td>Seguridad de la Plataforma</td>
              <td>
                Prevenir fraudes informáticos, mitigar ataques cibernéticos, detectar disputas
                financieras maliciosas y garantizar la integridad de las bases de datos.
              </td>
              <td>Interés legítimo / Obligación legal</td>
            </tr>
            <tr>
              <td>Comunicaciones de servicio</td>
              <td>
                Enviar notificaciones técnicas sobre el estado del sistema, alertas del dunning process
                por transacciones declinadas y actualizaciones legales de la Plataforma.
              </td>
              <td>Ejecución de un contrato</td>
            </tr>
          </tbody>
        </table>
      </div>

      <h2>4. Uso de servicios de terceros y autorización de Google</h2>
      <p>
        Para ofrecer un entorno de software de alta disponibilidad, la Plataforma integra componentes y
        APIs de proveedores tecnológicos líderes a nivel mundial y regional, lo que implica
        transferencias internacionales y procesamiento por parte de terceros:
      </p>
      <h3>A. Integración con ecosistemas y APIs de Google</h3>
      <ul>
        <li>
          <strong>Google Workspace / Gmail API:</strong> utilizado estrictamente para la gestión,
          sincronización y envío automatizado de correos electrónicos transaccionales, alertas de
          facturación y notificaciones de flujos de trabajo generadas por el usuario. El uso de la
          información recibida a través de las APIs de Google se apegará estrictamente a la Política de
          Datos de Usuario de los Servicios de API de Google, incluyendo los requisitos de Uso Limitado
          (Limited Use).
        </li>
        <li>
          <strong>Google Analytics:</strong> herramienta de análisis web para evaluar el uso de la
          interfaz, generar métricas de rendimiento del software y comprender el comportamiento de los
          usuarios de forma agregada y anonimizada.
        </li>
        <li>
          <strong>Google Maps API:</strong> utilizado para funciones geográficas, localización de
          proyectos y validación cartográfica de direcciones dentro de los módulos de administración.
        </li>
      </ul>
      <h3>B. Pasarelas de pago y adquirencia segura (PCI-DSS)</h3>
      <p>
        Con el fin de garantizar la seguridad transaccional, administratodo.com utiliza proveedores
        externos especializados. La Plataforma no almacena ni procesa datos completos de tarjetas de
        crédito o débito en sus servidores. Toda la información financiera viaja cifrada directamente a:
      </p>
      <ul>
        <li>
          <strong>Stripe y PayPal:</strong> procesadores globales bajo certificación PCI-DSS, cuyos
          servidores pueden estar ubicados en Estados Unidos y Europa.
        </li>
        <li>
          <strong>QPayPro, NeoNet (VisaNet Guatemala) y BAC Credomatic:</strong> pasarelas adquirentes
          regionales que gestionan los cobros locales en Centroamérica y LATAM, procesando los flujos de
          cobro recurrente bajo las regulaciones bancarias de cada país.
        </li>
      </ul>

      <h2>5. Descargo de responsabilidad para contenido general del usuario (Data Ownership)</h2>
      <p>
        administratodo.com opera exclusivamente como una plataforma de infraestructura en la nube para la
        gestión administrativa. El Cliente actúa como dueño y «Responsable» absoluto de cualquier
        información, archivo, documento digital, factura, contrato o dato personal de terceros
        (empleados, proveedores o sus propios clientes) que ingrese o aloje en sus módulos multiempresa y
        multiproyecto.
      </p>
      <p>
        La Plataforma funciona únicamente como «Encargado del Tratamiento» técnico de dichos datos. En
        consecuencia, administratodo.com queda totalmente exonerado de cualquier responsabilidad legal,
        civil, penal o administrativa derivada de la licitud, veracidad, propiedad intelectual o
        violaciones a la privacidad de los documentos y datos cargados por los usuarios en su entorno
        corporativo. El Cliente se obliga a mantener indemne a la Plataforma frente a cualquier
        reclamación de terceros.
      </p>

      <h2>6. Período de retención de los datos</h2>
      <p>
        Conservaremos los datos personales únicamente durante el tiempo estrictamente necesario para
        cumplir con las finalidades contractuales y las obligaciones legales aplicables:
      </p>
      <ul>
        <li>
          Los datos de la cuenta activa se mantendrán vigentes mientras el Cliente no solicite la baja
          voluntaria del servicio o la rescisión del Acuerdo Principal.
        </li>
        <li>
          Los datos contenidos en entornos suspendidos por impago serán resguardados por un plazo máximo
          de treinta (30) días calendario para garantizar la portabilidad del Cliente, procediendo luego
          a su eliminación definitiva de los servidores de producción.
        </li>
        <li>
          Los registros contables y de facturación fiscal electrónica emitidos se conservarán durante los
          plazos mínimos obligatorios exigidos por las administraciones tributarias locales de LATAM
          (generalmente entre 5 y 10 años).
        </li>
      </ul>

      <h2>7. Derechos del usuario (Derechos ARCO)</h2>
      <p>
        Independientemente de su ubicación en LATAM, garantizamos a los titulares de los datos el
        ejercicio de sus derechos de Acceso, Rectificación, Cancelación y Oposición (ARCO). El usuario
        podrá solicitar la ejecución de estos derechos configurando directamente su perfil de usuario o
        enviando un correo electrónico formal a <Mail /> adjuntando una identificación que valide su
        identidad como titular.
      </p>

      <h2>8. Modificaciones a esta Política</h2>
      <p>
        Nos reservamos el derecho de actualizar esta Política de Privacidad en cualquier momento para
        adaptarla a mejoras técnicas en el SaaS o a cambios legislativos en la región de Latinoamérica.
        Cualquier modificación será publicada en esta sección y notificada al Administrador Principal por
        los canales internos del sistema.
      </p>
    </>
  )
}

// ────────────────────────────────────────────────────────────────────────────
// Términos de Servicio
// ────────────────────────────────────────────────────────────────────────────
function TosBody(): ReactElement {
  return (
    <>
      <p>
        Bienvenido a administratodo.com (en adelante, «la Plataforma», «el SaaS» o «Nosotros»). Estos
        Términos de Servicio (en adelante, los «Términos») constituyen un acuerdo legal, vinculante y
        exigible entre administratodo.com y la persona física o jurídica que contrata, accede o utiliza
        nuestros servicios de software bajo demanda (en adelante, el «Cliente» o el «Usuario»).
      </p>
      <p>
        Al registrarse, activar una cuenta corporativa o utilizar la Plataforma, usted acepta cumplir y
        estar sujeto a estos Términos en su totalidad. Si está celebrando este acuerdo en nombre de una
        empresa u otra entidad legal, usted declara tener la autoridad legal para vincular a dicha entidad
        a estos Términos.
      </p>

      <h2>1. Naturaleza del servicio SaaS y licencia de uso</h2>
      <p>
        administratodo.com opera exclusivamente como un software de distribución en la nube (Software as a
        Service - SaaS). Sujeto al cumplimiento estricto de estos Términos y al pago puntual de las
        tarifas correspondientes, otorgamos al Cliente una licencia limitada, no exclusiva, no
        transferible, revocable y global para acceder y utilizar la Plataforma para sus operaciones
        comerciales internas.
      </p>
      <p>
        Esta licencia no constituye una venta del software. El Cliente no adquiere ningún derecho de
        propiedad intelectual sobre el código fuente, la arquitectura, el diseño, los algoritmos o las
        marcas de la Plataforma.
      </p>

      <h2>2. Arquitectura de cuentas: entorno multiempresa y multiproyecto</h2>
      <p>
        La Plataforma cuenta con una estructura técnica avanzada diseñada para la gestión consolidada de
        múltiples unidades de negocio independientes. El Cliente comprende y acepta las siguientes reglas
        operativas sobre este ecosistema:
      </p>
      <ul>
        <li>
          <strong>Cuenta del Administrador Principal (Tenant):</strong> es el titular legal del contrato y
          de la suscripción de pago. Tiene el control total del entorno contratado y es el único
          responsable legal de todas las actividades realizadas dentro del mismo.
        </li>
        <li>
          <strong>Módulos Multiempresa:</strong> el Cliente puede dar de alta diferentes razones sociales,
          filiales, sucursales o marcas (cada una denominada «Empresa») bajo una misma cuenta
          centralizada, según los límites de su plan contratado. El Cliente es responsable de segregar
          correctamente los accesos y asegurar que cada Empresa cumpla con la normativa contable,
          comercial y fiscal de su respectiva jurisdicción.
        </li>
        <li>
          <strong>Gestión de Multiproyectos:</strong> dentro de cada Empresa, la Plataforma permite
          estructurar flujos de trabajo, presupuestos, inventarios y cronogramas segregados por proyectos
          (cada uno denominado «Proyecto»). La eliminación, archivo o alteración de datos de un Proyecto
          específico es responsabilidad exclusiva del Usuario asignado.
        </li>
      </ul>

      <h2>3. Control de accesos, usuarios autorizados y roles</h2>
      <p>
        El Administrador Principal puede invitar a terceros (empleados, contadores externos, asesores,
        socios comerciales) a formar parte de su entorno como «Usuarios Autorizados».
      </p>
      <ul>
        <li>
          <strong>Asignación de roles y permisos:</strong> es responsabilidad exclusiva del Cliente
          configurar, auditar y restringir los roles (ej. Administrador, Editor, Lector, Auditor) para
          cada Usuario Autorizado dentro de cada Empresa o Proyecto específico. administratodo.com no se
          hace responsable por fugas de información, borrado de datos o transacciones erróneas derivadas
          de una mala asignación de permisos por parte del Cliente o sus administradores.
        </li>
        <li>
          <strong>Confidencialidad de credenciales:</strong> cada cuenta de usuario es personal e
          intransferible. Queda prohibido compartir credenciales entre colaboradores. El Cliente debe
          notificar inmediatamente a <Mail /> cualquier sospecha de violación de seguridad o acceso no
          autorizado.
        </li>
      </ul>

      <h2>4. Modelos de suscripción, planes y regulación de precios</h2>
      <p>
        El acceso a la Plataforma se rige por planes de suscripción basados en la recurrencia y la
        escalabilidad del negocio del Cliente.
      </p>
      <h3>A. Métricas de facturación (tarificación por consumo o capacidad)</h3>
      <p>Los precios de los planes se estructuran de forma modular según las siguientes variables del entorno SaaS:</p>
      <ul>
        <li>Número total de Empresas dadas de alta en el sistema.</li>
        <li>Número de Proyectos concurrentes o archivados.</li>
        <li>Volumen de Usuarios Autorizados interactuando en el sistema.</li>
        <li>Capacidad de almacenamiento en la nube consumida.</li>
      </ul>
      <h3>B. Ajustes de precios e inflación en mercados de LATAM</h3>
      <p>
        Siguiendo estándares internacionales de plataformas multinacionales, administratodo.com se
        reserva el derecho de ajustar las tarifas de sus planes de suscripción para adaptarlas a las
        fluctuaciones cambiarias de las monedas locales, inflación regional en América Latina, o mejoras
        sustanciales en la infraestructura tecnológica. Todo cambio de precio será notificado por correo
        electrónico al Administrador Principal con un mínimo de treinta (30) días calendario de
        anticipación. Si el Cliente no acepta el reajuste, tendrá derecho a cancelar su suscripción antes
        de la próxima fecha de facturación sin penalización alguna.
      </p>

      <h2>5. Condiciones de pago, recurrencia y adquirencia local (QPayPro / VisaNet / NeoNet / BAC)</h2>
      <p>
        El procesamiento financiero de los Servicios de administratodo.com se rige bajo estrictas
        normativas internacionales y de adquirencia local.
      </p>
      <h3>A. Autorización expresa de cargo recurrente</h3>
      <p>
        Al registrar una tarjeta de crédito o débito (Visa, Mastercard, American Express, entre otras) en
        nuestra Plataforma, el Cliente otorga su consentimiento y autorización expresa para que se
        realicen cargos automáticos y recurrentes en su cuenta bancaria. Los cargos se efectuarán al
        inicio de cada ciclo de facturación (mensual o anual) por el monto correspondiente al plan
        contratado y los módulos multiempresa/multiproyecto activos.
      </p>
      <h3>B. Canales de procesamiento seguro y PCI-DSS</h3>
      <p>
        Los pagos se procesan de forma externa y segura a través de pasarelas de pago integradas
        autorizadas: Stripe y PayPal para transacciones internacionales; y QPayPro, NeoNet (VisaNet
        Guatemala) o BAC Credomatic para el procesamiento financiero local en Centroamérica y LATAM.
        administratodo.com no recopila, procesa ni almacena datos de tarjetas en servidores propios; toda
        la información viaja cifrada directamente a los procesadores bajo certificación estándar de
        seguridad financiera PCI-DSS.
      </p>
      <h3>C. Política anti-contracargos (chargebacks) y disputas maliciosas</h3>
      <p>
        Dado que las pasarelas locales (como QPayPro o VisaNet) exigen transparencia absoluta, cualquier
        intento por parte del Cliente de iniciar un contracargo ante su banco emisor alegando
        desconocimiento de un cobro recurrente debidamente autorizado será considerado una violación grave
        a estos Términos. En caso de detectarse una disputa de pago injustificada, administratodo.com
        procederá a la suspensión inmediata y definitiva de todas las empresas y proyectos asociados a la
        cuenta, y se reserva el derecho de trasladar al Cliente los costos por penalización aplicados por
        el banco adquirente.
      </p>

      <h2>6. Protocolo ante transacciones declinadas y fallos de cobro</h2>
      <p>
        Para garantizar la estabilidad operativa del SaaS y proteger los datos del Cliente ante problemas
        imprevistos con sus tarjetas de crédito o débito, se establece el siguiente protocolo
        automatizado de mitigación:
      </p>
      <h3>A. Causas de fallo en el cobro</h3>
      <p>
        El Cliente reconoce que una transacción de cargo recurrente puede ser rechazada o declinada por
        las pasarelas (QPayPro, VisaNet, Stripe, etc.) debido a:
      </p>
      <ul>
        <li>Fondos insuficientes en la cuenta de origen.</li>
        <li>Tarjeta de crédito o débito vencida, bloqueada o reportada.</li>
        <li>
          Restricciones de seguridad por prevención de fraude del banco emisor (bloqueo de transacciones
          por internet o cargos internacionales).
        </li>
        <li>Interrupciones técnicas en las redes de comunicación de los bancos adquirentes locales.</li>
      </ul>
      <p>
        administratodo.com queda eximido de cualquier responsabilidad si las pasarelas de pago no logran
        procesar el cobro automático debido a las causas antes mencionadas.
      </p>
      <h3>B. Proceso de reintentos graduales (Dunning Process)</h3>
      <p>En caso de que un cargo recurrente sea declinado, el sistema activará un cronograma de mitigación financiera:</p>
      <ul>
        <li>
          <strong>Día 1 (primer fallo):</strong> se enviará una notificación electrónica inmediata al
          Administrador Principal indicando el rechazo de la transacción y solicitando la revisión de su
          método de pago.
        </li>
        <li>
          <strong>Días 3 y 5:</strong> el sistema realizará reintentos automáticos de cobro a través de
          las pasarelas integradas. Se enviarán recordatorios adicionales de saldo pendiente.
        </li>
      </ul>
      <h3>C. Estado de «Solo Lectura» y periodo de gracia</h3>
      <p>
        Durante un periodo de gracia de siete (7) días calendario contados a partir del primer fallo de
        cobro, el entorno multiempresa del Cliente permanecerá activo pero se restringirá automáticamente
        a un Modo de Solo Lectura.
      </p>
      <p>
        Bajo este estado, el Cliente y sus Usuarios Autorizados podrán visualizar la información existente
        de sus proyectos y empresas, pero no podrán realizar modificaciones, registrar nuevas
        transacciones, emitir documentos fiscales, dar de alta nuevas empresas o proyectos, ni agregar
        nuevos usuarios.
      </p>
      <h3>D. Suspensión total y costos de reactivación</h3>
      <p>
        Transcurrido el período de gracia de siete (7) días sin que se haya podido procesar el cobro con
        éxito o sin que el Cliente haya registrado una tarjeta válida con fondos, el entorno SaaS será
        suspendido por completo.
      </p>
      <p>
        Para restablecer el servicio, el Cliente deberá liquidar el saldo vencido. administratodo.com se
        reserva el derecho de aplicar una tarifa administrativa por concepto de reactivación de cuentas
        suspendidas para cubrir los costos de reindexación en la nube de la infraestructura de sus
        empresas.
      </p>
      <h3>E. Exoneración de responsabilidad por pérdidas operativas debido a suspensión</h3>
      <p>
        El Cliente acepta que la suspensión legítima de la cuenta por falta de pago o transacciones
        declinadas es su total responsabilidad. administratodo.com no será responsable bajo ninguna
        circunstancia por daños, perjuicios, pérdidas financieras, multas fiscales de entidades
        gubernamentales de LATAM, o retrasos en proyectos que sufra el Cliente, sus Empresas afiliadas o
        sus propios clientes finales a causa de la pérdida de acceso al software provocada por la
        suspensión del servicio.
      </p>

      <h2>7. Tratamiento fiscal, impuestos y facturación electrónica en LATAM</h2>
      <p>
        Al operar en mercados de Latinoamérica bajo entornos multiempresa, los aspectos fiscales se rigen
        por las siguientes estipulaciones:
      </p>
      <ul>
        <li>
          <strong>Territorialidad e impuestos:</strong> las tarifas publicadas en la Plataforma pueden
          estar sujetas a impuestos locales (como el Impuesto al Valor Agregado - IVA) dependiendo del
          país de residencia legal declarado por el Cliente o la configuración fiscal de la Empresa
          Principal. administratodo.com desglosará dichos impuestos de acuerdo con las leyes tributarias
          aplicables.
        </li>
        <li>
          <strong>Emisión de facturas electrónicas:</strong> una vez procesado el pago con éxito a través
          de QPayPro, VisaNet o Stripe, administratodo.com emitirá el documento fiscal digital
          correspondiente (ej. Régimen FEL en Guatemala, CFDI en México o el equivalente legal en el país
          correspondiente) a la razón social indicada por el Administrador Principal. El Cliente es
          responsable de proveer datos fiscales válidos y actualizados.
        </li>
        <li>
          <strong>Retenciones de impuestos locales:</strong> en caso de que el Cliente actúe como agente
          de retención según las leyes de su país, deberá notificarlo previamente a administratodo.com
          para coordinar los flujos de cobro correspondientes; de lo contrario, el cargo automático se
          realizará por el valor total de la factura.
        </li>
      </ul>

      <h2>8. Propiedad, custodia y protección de datos del Cliente (Data Ownership)</h2>
      <p>
        El Cliente retiene la propiedad absoluta y exclusiva de todos los datos, archivos, registros
        financieros, presupuestos o información comercial que ingrese, procese o genere en los entornos
        multiempresa y multiproyecto de la Plataforma («Datos del Cliente»).
      </p>
      <ul>
        <li>
          <strong>Rol de administratodo.com:</strong> actuamos únicamente como «Encargados del
          Tratamiento» de dichos datos, procesándolos estrictamente para la ejecución del servicio
          técnico, bajo las directrices de nuestra{' '}
          <a href={LEGAL_PATHS.privacy}>Política de Privacidad</a> y estándares internacionales (como el
          RGPD).
        </li>
        <li>
          <strong>Garantía de indemnidad por datos de terceros:</strong> el Cliente declara y garantiza
          que posee todos los derechos, consentimientos y bases legales requeridas para registrar en la
          Plataforma información confidencial o datos personales pertenecientes a sus propios clientes,
          empleados, proveedores o subcontratistas. El Cliente indemnizará y mantendrá indemne a
          administratodo.com frente a cualquier demanda o sanción derivada de infracciones a la privacidad
          cometidas por el uso indebido de los Datos del Cliente dentro de la Plataforma.
        </li>
        <li>
          <strong>Portabilidad y eliminación definitiva:</strong> el Cliente podrá exportar la información
          de sus Empresas y Proyectos en formatos estándar (como CSV o Excel) en cualquier momento
          mientras su suscripción esté activa o durante el periodo de gracia de solo lectura. Tras la
          suspensión total por falta de pago o la cancelación voluntaria de la cuenta, administratodo.com
          conservará los datos en sus servidores por un plazo máximo de treinta (30) días calendario para
          permitir una última descarga de respaldo. Pasado ese tiempo, toda la información será eliminada
          permanentemente de nuestros servidores de producción por motivos de seguridad informática.
        </li>
      </ul>

      <h2>9. Limitación de responsabilidad comercial</h2>
      <p>
        administratodo.com provee una herramienta tecnológica avanzada de apoyo a la gestión
        administrativa. El SaaS no toma decisiones de negocio por el Cliente, no sustituye el criterio de
        contadores, auditores o administradores profesionales, ni garantiza resultados comerciales
        específicos. Nuestra responsabilidad civil total acumulada ante cualquier reclamación demostrada
        derivada de estos Términos estará limitada estrictamente al monto equivalente pagado por el
        Cliente por su suscripción durante los últimos tres (3) meses anteriores al evento que originó la
        disputa.
      </p>

      <h2>10. Resolución de disputas multipaís y jurisdicción (mecanismo escalado)</h2>
      <p>
        Considerando la naturaleza del mercado en Latinoamérica, donde el Cliente y el SaaS pueden operar
        en jurisdicciones distintas, las partes se someten a un proceso escalonado de solución de
        controversias:
      </p>
      <ul>
        <li>
          <strong>Negociación directa:</strong> las partes intentarán resolver cualquier disputa de forma
          amistosa mediante reuniones virtuales en un plazo máximo de treinta (30) días hábiles
          escribiendo a <Mail />.
        </li>
        <li>
          <strong>Arbitraje comercial obligatorio:</strong> de no alcanzarse un acuerdo en la fase
          directa, la disputa se resolverá de manera definitiva mediante arbitraje de derecho,
          administrado de forma virtual por un centro de arbitraje de prestigio internacional de común
          acuerdo o, en su defecto, en la sede jurídica principal donde se encuentre constituida la
          empresa matriz operadora de administratodo.com. El idioma del arbitraje será el español y el
          laudo arbitral será definitivo, vinculante e inapelable para ambas partes.
        </li>
      </ul>

      <h2>11. Modificaciones y contacto</h2>
      <p>
        Podemos modificar estos Términos en cualquier momento para reflejar actualizaciones técnicas en
        nuestra arquitectura multiempresa o cambios legislativos en LATAM. El uso continuo del SaaS tras
        la publicación de los Términos modificados constituirá la aceptación de los mismos.
      </p>
      <p>
        Para cualquier consulta legal sobre este acuerdo, puede comunicarse con nuestro departamento de
        cumplimiento a través del correo: <Mail />.
      </p>
    </>
  )
}

// ────────────────────────────────────────────────────────────────────────────
// Anexo DPA + Política de Cookies
// ────────────────────────────────────────────────────────────────────────────
function DpaBody(): ReactElement {
  return (
    <>
      <p>
        Este Acuerdo de Procesamiento de Datos (en adelante, el «DPA») complementa los{' '}
        <a href={LEGAL_PATHS.tos}>Términos de Servicio</a> de administratodo.com (en adelante, el «Acuerdo
        Principal») y regula el tratamiento de datos personales realizado en el marco de la prestación de
        los servicios SaaS multiempresa y multiproyecto.
      </p>

      <h2>1. Objeto y definiciones</h2>
      <p>
        Este DPA se aplica cuando administratodo.com procesa Datos Personales en calidad de «Encargado del
        Tratamiento» en nombre del Cliente, quien actúa como «Responsable del Tratamiento».
      </p>
      <ul>
        <li>
          <strong>Responsable del Tratamiento (Cliente):</strong> la entidad o persona que determina los
          fines y medios del tratamiento de datos de sus empresas y proyectos.
        </li>
        <li>
          <strong>Encargado del Tratamiento (la Plataforma):</strong> administratodo.com, que procesa los
          datos únicamente bajo las instrucciones del Responsable.
        </li>
        <li>
          <strong>Datos Personales del Cliente:</strong> cualquier información cargada en el SaaS que
          identifique de forma directa o indirecta a empleados, proveedores, clientes o colaboradores del
          Responsable.
        </li>
      </ul>

      <h2>2. Instrucciones del tratamiento</h2>
      <p>
        La Plataforma se compromete a tratar los Datos Personales única y exclusivamente siguiendo las
        instrucciones por escrito del Cliente, reflejadas en el Acuerdo Principal, este DPA y la
        configuración que el Cliente realice en el panel de administración multiproyecto.
      </p>

      <h2>3. Obligaciones de administratodo.com</h2>
      <p>En su rol de Encargado, la Plataforma se obliga a:</p>
      <ul>
        <li>
          <strong>Seguridad:</strong> implementar medidas de seguridad técnicas y organizativas adecuadas,
          incluyendo cifrado de datos en tránsito (SSL/TLS) y en reposo, para mitigar riesgos de acceso no
          autorizado o pérdida.
        </li>
        <li>
          <strong>Confidencialidad:</strong> garantizar que todo el personal autorizado para procesar los
          datos esté sujeto a estrictos acuerdos de confidencialidad de la información.
        </li>
        <li>
          <strong>Subprocesadores:</strong> el Cliente autoriza la integración de herramientas
          indispensables de terceros (tales como Google Cloud, Stripe, PayPal, QPayPro, NeoNet y BAC
          Credomatic). La Plataforma exigirá a estos subprocesadores el mismo nivel de protección de datos
          estipulado en este DPA.
        </li>
        <li>
          <strong>Asistencia al Responsable:</strong> colaborar con el Cliente, en la medida de lo
          técnicamente viable, para que este pueda responder a las solicitudes de los titulares de datos
          que ejerzan sus derechos de Acceso, Rectificación, Supresión u Oposición (Derechos ARCO / RGPD).
        </li>
        <li>
          <strong>Notificación de incidentes:</strong> informar al Cliente sin dilación indebida, y a más
          tardar dentro de las 48 horas siguientes, tras confirmar cualquier brecha de seguridad que
          afecte la integridad de sus Datos Personales.
        </li>
      </ul>

      <h2>4. Destino de los datos al término del servicio</h2>
      <p>
        A la terminación de los Servicios SaaS, y conforme a los plazos previstos en los Términos de
        Servicio, la Plataforma conservará los datos por un periodo máximo de treinta (30) días calendario
        para permitir su portabilidad y exportación. Transcurrido dicho plazo, administratodo.com
        procederá a la eliminación segura y definitiva de toda la información de sus servidores activos,
        salvo por aquellos registros cuya retención sea exigida por legislaciones fiscales o contables
        locales aplicables en Latinoamérica.
      </p>

      <h2 className="legal-divider">Política de Cookies</h2>
      <p className="legal-subtle">Última actualización: 4 de junio de 2026</p>
      <p>
        En administratodo.com utilizamos cookies y tecnologías similares de seguimiento para mejorar el
        rendimiento de la plataforma, optimizar la experiencia multiempresa del usuario y garantizar la
        seguridad transaccional en nuestros procesamientos de pago.
      </p>

      <h3>1. ¿Qué es una cookie?</h3>
      <p>
        Una cookie es un pequeño archivo de texto que un sitio web almacena en el navegador o dispositivo
        del usuario. Permite recordar información sobre su visita, como su idioma preferido, sesiones de
        cuenta activas y otras configuraciones operativas.
      </p>

      <h3>2. Tipos de cookies que utiliza esta Plataforma</h3>
      <p>Clasificamos las cookies que implementamos en las siguientes categorías:</p>
      <div className="legal-table-wrap">
        <table>
          <thead>
            <tr>
              <th>Categoría de cookie</th>
              <th>Finalidad específica</th>
              <th>Terceros involucrados</th>
            </tr>
          </thead>
          <tbody>
            <tr>
              <td>Esenciales o técnicas</td>
              <td>
                Obligatorias para el correcto funcionamiento de la interfaz, mantenimiento de sesiones
                abiertas y prevención de fraudes.
              </td>
              <td>Propias de la plataforma, Stripe, PayPal.</td>
            </tr>
            <tr>
              <td>De rendimiento y analítica</td>
              <td>
                Recopilan datos anónimos y agregados sobre los patrones de navegación y uso multiproyecto
                del software para optimizar la infraestructura.
              </td>
              <td>Google Analytics.</td>
            </tr>
            <tr>
              <td>Funcionales y preferencias</td>
              <td>
                Permiten recordar selecciones del usuario, tales como la moneda de facturación local o la
                segregación visual de empresas en el panel.
              </td>
              <td>Propias de la plataforma, Google Maps API.</td>
            </tr>
          </tbody>
        </table>
      </div>

      <h3>3. Gestión y revocación del consentimiento</h3>
      <p>
        De conformidad con las directrices del RGPD y los estándares internacionales de privacidad, el
        usuario puede modificar sus preferencias o revocar su consentimiento en cualquier momento a través
        del Panel de Configuración de Cookies integrado en nuestro banner informativo, o ajustando
        directamente la configuración de privacidad de su navegador web.
      </p>
    </>
  )
}

export const LEGAL_BODIES: Record<LegalDocType, () => ReactElement> = {
  privacy: PrivacyBody,
  tos: TosBody,
  dpa: DpaBody,
}
