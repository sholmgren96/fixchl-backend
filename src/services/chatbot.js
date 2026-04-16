import { db } from '../db/database.js'
import { enviarMensajeWA, enviarLista, enviarBotones } from './whatsapp.js'
import { sanitizarMensaje } from './sanitizar.js'

const CATEGORIAS = ['Electricista', 'Gasfiter', 'Servicio de aseo', 'Pintor', 'Maestro general', 'Otro']
const URGENCIAS  = ['Hoy mismo', 'Esta semana', 'Elegir fecha']
const COMUNAS    = ['Las Condes', 'Vitacura', 'Lo Barnechea', 'Chicureo']

const PALABRAS_AYUDA = ['ayuda', 'help', 'soporte', '?', 'ayudame', 'ayúdame', 'problema']

const TIPOS_REPORTE = [
  { id: 'no_llego',         title: 'El técnico no llegó' },
  { id: 'mal_servicio',     title: 'Problema con el trabajo' },
  { id: 'cancelar_trabajo', title: 'Cancelar un trabajo activo' },
  { id: 'otro',             title: 'Otra consulta o reclamo' },
]

const FAQ = {
  como_funciona: `*¿Cómo funciona TecnicosYa?* 🔧\n\nEscríbenos por WhatsApp, cuéntanos qué servicio necesitas y en qué comuna estás. Te mostramos técnicos disponibles, eliges uno y te contactará para coordinar la visita.\n\nAl terminar el trabajo puedes calificarlo ⭐`,
  comunas:       `*¿En qué comunas trabajan?* 📍\n\nActualmente operamos en:\n• Las Condes\n• Vitacura\n• Lo Barnechea\n• Chicureo\n\nPróximamente más comunas de Santiago 🙌`,
  precios:       `*¿Cuánto cobran los técnicos?* 💰\n\nCada técnico fija sus propios precios según el tipo de trabajo. TecnicosYa no cobra comisión al cliente.\n\nPuedes consultar el precio directamente con el técnico antes de confirmar la visita 👍`,
  cancelar:      `*¿Cómo cancelo una solicitud?* ❌\n\nSi aún no hay técnico asignado, escribe *reiniciar* para volver al inicio.\n\nSi ya tienes un técnico asignado, selecciona la opción *"Tengo un problema"* en este menú de ayuda para reportar la situación y nuestro equipo te contactará.`,
}

const BLOQUES_HORARIOS = [
  { hora: '09:00', label: '09:00 – 11:00' },
  { hora: '11:00', label: '11:00 – 13:00' },
  { hora: '14:00', label: '14:00 – 16:00' },
  { hora: '16:00', label: '16:00 – 18:00' },
]

function getProximosDias(n = 7) {
  const dias = []
  const nombDias  = ['Dom','Lun','Mar','Mié','Jue','Vie','Sáb']
  const nombMeses = ['ene','feb','mar','abr','may','jun','jul','ago','sep','oct','nov','dic']
  const hoy = new Date()
  for (let i = 1; i <= n; i++) {
    const d = new Date(hoy)
    d.setDate(hoy.getDate() + i)
    const fechaStr = d.toISOString().split('T')[0]
    dias.push({
      fecha: fechaStr,
      label: `${nombDias[d.getDay()]} ${d.getDate()} ${nombMeses[d.getMonth()]}`
    })
  }
  return dias
}

function formatFechaCorta(fechaStr) {
  const d = new Date(fechaStr + 'T12:00:00')
  const dias  = ['Dom','Lun','Mar','Mié','Jue','Vie','Sáb']
  const meses = ['ene','feb','mar','abr','may','jun','jul','ago','sep','oct','nov','dic']
  return `${dias[d.getDay()]} ${d.getDate()} ${meses[d.getMonth()]}`
}

export async function procesarMensaje(numeroWA, texto) {
  const numero = numeroWA.replace('whatsapp:', '')
  const msg    = texto.trim()

  let sesion = await db.getSesion(numero)
  if (!sesion) {
    await db.upsertSesion(numero, 'inicio', {})
    sesion = { cliente_wa: numero, estado: 'inicio', datos_temp: '{}', trabajo_id: null }
  }

  const datos = JSON.parse(sesion.datos_temp || '{}')

  // ── AYUDA (cualquier estado excepto los propios de ayuda) ─────────────────
  const estadosAyuda = ['esperando_ayuda', 'esperando_tipo_reporte', 'esperando_desc_reporte',
    'esperando_confirmacion_pago', 'esperando_decision_post_pago', 'esperando_slot_reagendamiento']
  if (PALABRAS_AYUDA.includes(msg.toLowerCase()) && !estadosAyuda.includes(sesion.estado)) {
    datos._estado_anterior = sesion.estado
    await mostrarMenuAyuda(numero)
    await db.upsertSesion(numero, 'esperando_ayuda', datos)
    return
  }

  // ── REINICIO MANUAL (cualquier estado) ────────────────────────────────────
  const PALABRAS_REINICIO = ['reiniciar', 'reset', 'inicio', 'hola', 'menu', 'menú', 'empezar']
  if (PALABRAS_REINICIO.includes(msg.toLowerCase())) {
    await db.upsertSesion(numero, 'inicio', {})
    sesion = { ...sesion, estado: 'inicio', datos_temp: '{}' }
  }

  // ── INICIO ────────────────────────────────────────────────────────────────
  if (sesion.estado === 'inicio') {
    await enviarLista(numero,
      '¡Hola! 👋 Soy el asistente de *TecnicosYa*.\n\nConecto personas con técnicos de calidad en Santiago. ¿Qué servicio necesitas?',
      'Ver servicios',
      [{
        rows: [
          ...CATEGORIAS.map(c => ({ id: c, title: c })),
          { id: 'ayuda', title: '❓ Ayuda / Preguntas frecuentes' },
        ]
      }]
    )
    await db.upsertSesion(numero, 'esperando_categoria', datos)
    return
  }

  // ── ESPERANDO CATEGORÍA ───────────────────────────────────────────────────
  if (sesion.estado === 'esperando_categoria') {
    if (msg.toLowerCase() === 'ayuda') {
      datos._estado_anterior = 'esperando_categoria'
      await mostrarMenuAyuda(numero)
      await db.upsertSesion(numero, 'esperando_ayuda', datos)
      return
    }
    const categoria = CATEGORIAS.find(c =>
      c.toLowerCase() === msg.toLowerCase() || c.toLowerCase().includes(msg.toLowerCase())
    )
    if (!categoria) {
      await enviarLista(numero, 'Por favor selecciona una opción:', 'Ver servicios',
        [{
          rows: [
            ...CATEGORIAS.map(c => ({ id: c, title: c })),
            { id: 'ayuda', title: '❓ Ayuda / Preguntas frecuentes' },
          ]
        }])
      return
    }
    datos.categoria = categoria
    await enviarMensajeWA(numero,
      `Entendido, *${categoria}* 👍\n\nCuéntame brevemente el problema.\n\n_Ej: "llave que gotea", "sin luz en dormitorio"_`)
    await db.upsertSesion(numero, 'esperando_descripcion', datos)
    return
  }

  // ── ESPERANDO DESCRIPCIÓN ─────────────────────────────────────────────────
  if (sesion.estado === 'esperando_descripcion') {
    if (msg.length < 5) { await enviarMensajeWA(numero, 'Por favor describe un poco más el problema 🙏'); return }
    datos.descripcion = msg
    await enviarLista(numero, '¿En qué comuna de Santiago estás?', 'Ver comunas',
      [{ rows: COMUNAS.map(c => ({ id: c, title: c })) }])
    await db.upsertSesion(numero, 'esperando_comuna', datos)
    return
  }

  // ── ESPERANDO COMUNA ──────────────────────────────────────────────────────
  if (sesion.estado === 'esperando_comuna') {
    const comuna = COMUNAS.find(c =>
      c.toLowerCase() === msg.toLowerCase() || c.toLowerCase().includes(msg.toLowerCase())
    )
    if (!comuna) {
      await enviarLista(numero, '¿En qué comuna estás?', 'Ver comunas',
        [{ rows: COMUNAS.map(c => ({ id: c, title: c })) }])
      return
    }
    datos.comuna = comuna
    await enviarBotones(numero, '¿Con qué urgencia lo necesitas?',
      URGENCIAS.map(u => ({ id: u, title: u })))
    await db.upsertSesion(numero, 'esperando_urgencia', datos)
    return
  }

  // ── ESPERANDO URGENCIA ────────────────────────────────────────────────────
  if (sesion.estado === 'esperando_urgencia') {
    const urgencia = URGENCIAS.find(u =>
      u.toLowerCase() === msg.toLowerCase() || u.toLowerCase().includes(msg.toLowerCase())
    )
    if (!urgencia) {
      await enviarBotones(numero, '¿Con qué urgencia lo necesitas?',
        URGENCIAS.map(u => ({ id: u, title: u })))
      return
    }
    datos.urgencia = urgencia

    if (urgencia === 'Elegir fecha') {
      datos.fechas_propuestas = []
      const dias = getProximosDias(7)
      await enviarLista(numero,
        '📅 ¿Qué día te acomoda? Puedes agregar hasta 3 opciones para encontrar técnico más rápido.',
        'Ver días',
        [{ rows: dias.map((d, i) => ({ id: String(i), title: d.label })) }]
      )
      await db.upsertSesion(numero, 'esperando_fecha_cliente', { ...datos, _dias: dias })
      return
    }

    const tecnicos = await db.buscarTecnicos(datos.categoria, datos.comuna)

    if (!tecnicos.length) {
      const slots = await db.buscarSlotsDisponibles(datos.categoria, datos.comuna, 3)
      if (slots.length) {
        datos.slots = slots
        await enviarLista(numero,
          `No hay técnicos disponibles ahora mismo en ${datos.comuna} 😕\n\n¿Te agendo para uno de estos horarios?`,
          'Ver horarios',
          [{ rows: slots.map((s, i) => ({ id: String(i), title: s.label })) }]
        )
        await db.upsertSesion(numero, 'esperando_slot', datos)
      } else {
        await enviarBotones(numero,
          `No hay técnicos disponibles en ${datos.comuna} ahora mismo 😕\n\n¿Qué deseas hacer?`,
          [
            { id: 'si_avisar',    title: '🔔 Avísame cuando haya' },
            { id: 'otro_servicio', title: '🔄 Pedir otro servicio' },
          ]
        )
        await db.upsertSesion(numero, 'esperando_aviso', datos)
      }
      return
    }

    await mostrarTecnicos(numero, datos, tecnicos, sesion)
    return
  }

  // ── ESPERANDO FECHA CLIENTE ───────────────────────────────────────────────
  if (sesion.estado === 'esperando_fecha_cliente') {
    const dias = datos._dias || getProximosDias(7)
    const idx = parseInt(msg)
    const diaElegido = (!isNaN(idx) && idx >= 0 && idx < dias.length)
      ? dias[idx]
      : dias.find(d => d.label.toLowerCase().includes(msg.toLowerCase()))

    if (!diaElegido) {
      await enviarLista(numero, '¿Qué día te acomoda?', 'Ver días',
        [{ rows: dias.map((d, i) => ({ id: String(i), title: d.label })) }])
      return
    }

    datos.fecha_temp       = diaElegido.fecha
    datos.fecha_temp_label = diaElegido.label

    await enviarLista(numero, `¿A qué hora el *${diaElegido.label}*?`, 'Ver horarios',
      [{ rows: BLOQUES_HORARIOS.map((b, i) => ({ id: String(i), title: b.label })) }]
    )
    await db.upsertSesion(numero, 'esperando_hora_cliente', datos)
    return
  }

  // ── ESPERANDO HORA CLIENTE ────────────────────────────────────────────────
  if (sesion.estado === 'esperando_hora_cliente') {
    const idx = parseInt(msg)
    const bloqueElegido = (!isNaN(idx) && idx >= 0 && idx < BLOQUES_HORARIOS.length)
      ? BLOQUES_HORARIOS[idx]
      : BLOQUES_HORARIOS.find(b => b.label.toLowerCase().includes(msg.toLowerCase()))

    if (!bloqueElegido) {
      await enviarLista(numero, `¿A qué hora el *${datos.fecha_temp_label}*?`, 'Ver horarios',
        [{ rows: BLOQUES_HORARIOS.map((b, i) => ({ id: String(i), title: b.label })) }])
      return
    }

    if (!datos.fechas_propuestas) datos.fechas_propuestas = []
    datos.fechas_propuestas.push({
      fecha: datos.fecha_temp,
      hora: bloqueElegido.hora,
      label: `${datos.fecha_temp_label} · ${bloqueElegido.label}`
    })
    delete datos.fecha_temp
    delete datos.fecha_temp_label
    delete datos._dias

    const lista = datos.fechas_propuestas.map(f => `• ${f.label}`).join('\n')

    if (datos.fechas_propuestas.length < 3) {
      await enviarBotones(numero,
        `✅ Agregado:\n${lista}\n\n¿Tienes otra fecha disponible?\n_Dar más opciones ayuda a encontrar técnico más rápido_ 😊`,
        [{ id: 'mas_fechas', title: '📅 Agregar otra fecha' }, { id: 'listo_fechas', title: '✅ Listo, buscar técnico' }]
      )
      await db.upsertSesion(numero, 'esperando_mas_fechas', datos)
    } else {
      await procesarFechasListas(numero, datos)
    }
    return
  }

  // ── ESPERANDO MÁS FECHAS ─────────────────────────────────────────────────
  if (sesion.estado === 'esperando_mas_fechas') {
    const quiereMas = msg === 'mas_fechas'
      || msg.toLowerCase().includes('agregar')
      || msg.toLowerCase().includes('otra')
      || msg.toLowerCase().includes('sí')
      || msg.toLowerCase().includes('si')

    if (quiereMas) {
      const dias = getProximosDias(7)
      await enviarLista(numero, '¿Qué otro día te acomoda?', 'Ver días',
        [{ rows: dias.map((d, i) => ({ id: String(i), title: d.label })) }])
      await db.upsertSesion(numero, 'esperando_fecha_cliente', { ...datos, _dias: dias })
    } else {
      await procesarFechasListas(numero, datos)
    }
    return
  }

  // ── ESPERANDO ACCIÓN SIN TÉCNICO ─────────────────────────────────────────
  if (sesion.estado === 'esperando_accion_sin_tecnico') {
    const quiereMasFechas = msg === 'mas_fechas'
      || msg.toLowerCase().includes('agregar')
      || msg.toLowerCase().includes('fecha')

    if (quiereMasFechas) {
      const dias = getProximosDias(7)
      await enviarLista(numero, '¿Qué día te acomoda?', 'Ver días',
        [{ rows: dias.map((d, i) => ({ id: String(i), title: d.label })) }])
      await db.upsertSesion(numero, 'esperando_fecha_cliente', { ...datos, _dias: dias })
    } else {
      // Solicitar otro servicio → reiniciar
      await enviarLista(numero,
        '¡Hola! 👋 Soy el asistente de *TecnicosYa*.\n\n¿Qué servicio necesitas?',
        'Ver servicios',
        [{ rows: CATEGORIAS.map(c => ({ id: c, title: c })) }]
      )
      await db.upsertSesion(numero, 'esperando_categoria', {})
    }
    return
  }

  // ── ESPERANDO SLOT ────────────────────────────────────────────────────────
  if (sesion.estado === 'esperando_slot') {
    const idx = parseInt(msg)
    const slotPorIdx = datos.slots?.[isNaN(idx) ? -1 : idx]
    const slotPorNombre = datos.slots?.find(s => s.label.toLowerCase().includes(msg.toLowerCase()))
    const slotElegido = slotPorIdx || slotPorNombre

    if (!slotElegido) {
      await enviarMensajeWA(numero, 'Por favor selecciona uno de los horarios disponibles.')
      return
    }

    const trabajo = await db.createTrabajo({
      cliente_nombre: 'Cliente',
      cliente_wa: numero,
      categoria: datos.categoria,
      descripcion: datos.descripcion,
      comuna: datos.comuna,
      urgencia: datos.urgencia || 'Agendado',
      fecha_agendada: slotElegido.fecha,
      hora_agendada: slotElegido.hora_inicio,
    })

    await db.updateTrabajoTecnico(trabajo.id, slotElegido.tecnico_id)
    await db.aceptarTrabajo(trabajo.id, slotElegido.tecnico_id)

    await enviarMensajeWA(numero,
      `✅ ¡Listo! Quedaste agendado con *${slotElegido.tecnico_nombre}*\n\n📅 ${slotElegido.label}\n\nTe contactará antes de la visita 🙌`)
    await db.upsertSesion(numero, 'chat_activo', datos, trabajo.id)
    return
  }

  // ── ESPERANDO AVISO ───────────────────────────────────────────────────────
  if (sesion.estado === 'esperando_aviso') {
    const quiereAviso = msg === 'si_avisar'
      || msg.toLowerCase().includes('avis')
      || msg.toLowerCase().includes('sí')
      || (msg.toLowerCase() === 'si')

    if (quiereAviso) {
      await enviarMensajeWA(numero,
        `Perfecto, te avisaremos cuando haya un técnico de *${datos.categoria}* disponible en ${datos.comuna} 🔔`)
    }

    // En ambos casos, ofrecer inmediatamente solicitar otro servicio
    await enviarLista(numero,
      '¿Necesitas algo más? Puedo ayudarte con otro servicio 👇',
      'Ver servicios',
      [{ rows: CATEGORIAS.map(c => ({ id: c, title: c })) }]
    )
    await db.upsertSesion(numero, 'esperando_categoria', {})
    return
  }

  // ── ESPERANDO ELECCIÓN DE TÉCNICO ─────────────────────────────────────────
  if (sesion.estado === 'esperando_eleccion') {
    const elegido = datos.tecnicos?.find(t =>
      String(t.id) === msg || t.nombre.toLowerCase() === msg.toLowerCase()
    )
    if (!elegido) { await enviarMensajeWA(numero, 'Por favor selecciona un técnico de la lista.'); return }

    const trabajo = await db.createTrabajo({
      cliente_nombre: 'Cliente',
      cliente_wa: numero,
      categoria: datos.categoria,
      descripcion: datos.descripcion,
      comuna: datos.comuna,
      urgencia: datos.urgencia,
    })

    await db.updateTrabajoTecnico(trabajo.id, elegido.id)
    await db.updateTrabajoEstado(trabajo.id, 'activo')

    await enviarMensajeWA(numero,
      `¡Listo! Le avisé a *${elegido.nombre}* sobre tu solicitud 🙌\n\nTe confirmará en los próximos minutos.`)
    await db.upsertSesion(numero, 'chat_activo', datos, trabajo.id)
    return
  }

  // ── CHAT ACTIVO ───────────────────────────────────────────────────────────
  if (sesion.estado === 'chat_activo') {
    if (sesion.trabajo_id) await db.createMensaje(sesion.trabajo_id, 'cliente', sanitizarMensaje(msg))
    return
  }

  // ── MENÚ DE AYUDA ────────────────────────────────────────────────────────
  if (sesion.estado === 'esperando_ayuda') {
    const opcion = msg.toLowerCase()

    if (opcion === 'como_funciona' || opcion.includes('funciona')) {
      await enviarMensajeWA(numero, FAQ.como_funciona)
      await mostrarMenuAyuda(numero)
      return
    }
    if (opcion === 'comunas' || opcion.includes('comuna')) {
      await enviarMensajeWA(numero, FAQ.comunas)
      await mostrarMenuAyuda(numero)
      return
    }
    if (opcion === 'precios' || opcion.includes('precio') || opcion.includes('cobran') || opcion.includes('costo')) {
      await enviarMensajeWA(numero, FAQ.precios)
      await mostrarMenuAyuda(numero)
      return
    }
    if (opcion === 'cancelar' || opcion.includes('cancel')) {
      await enviarMensajeWA(numero, FAQ.cancelar)
      await mostrarMenuAyuda(numero)
      return
    }
    if (opcion === 'problema' || opcion.includes('problem') || opcion.includes('reportar') || opcion.includes('reclam')) {
      await enviarLista(numero,
        '😔 Lamentamos que tengas un problema. ¿Qué tipo de situación quieres reportar?',
        'Ver opciones',
        [{ rows: TIPOS_REPORTE }]
      )
      await db.upsertSesion(numero, 'esperando_tipo_reporte', datos)
      return
    }
    if (opcion === 'volver' || opcion.includes('volver') || opcion.includes('menu') || opcion.includes('menú')) {
      const estadoAnterior = datos._estado_anterior
      delete datos._estado_anterior
      if (estadoAnterior && estadoAnterior !== 'inicio' && estadoAnterior !== 'esperando_categoria') {
        await enviarMensajeWA(numero, 'Volviendo a donde estabas... Escribe tu respuesta para continuar 👍')
        await db.upsertSesion(numero, estadoAnterior, datos)
      } else {
        await db.upsertSesion(numero, 'inicio', {})
        sesion = { ...sesion, estado: 'inicio', datos_temp: '{}' }
        // Caemos al handler de inicio abajo — no retornamos
        await enviarLista(numero,
          '¡Hola! 👋 Soy el asistente de *TecnicosYa*.\n\n¿Qué servicio necesitas?',
          'Ver servicios',
          [{
            rows: [
              ...CATEGORIAS.map(c => ({ id: c, title: c })),
              { id: 'ayuda', title: '❓ Ayuda / Preguntas frecuentes' },
            ]
          }]
        )
        await db.upsertSesion(numero, 'esperando_categoria', {})
      }
      return
    }

    // Respuesta no reconocida → mostrar menú de nuevo
    await mostrarMenuAyuda(numero)
    return
  }

  // ── ESPERANDO TIPO DE REPORTE ─────────────────────────────────────────────
  if (sesion.estado === 'esperando_tipo_reporte') {
    const tipo = TIPOS_REPORTE.find(t =>
      t.id === msg.toLowerCase() || t.title.toLowerCase().includes(msg.toLowerCase())
    )
    if (!tipo) {
      await enviarLista(numero, '¿Qué tipo de situación quieres reportar?', 'Ver opciones',
        [{ rows: TIPOS_REPORTE }])
      return
    }
    datos.tipo_reporte = tipo.id
    await enviarMensajeWA(numero,
      `Entendido: *${tipo.title}*\n\nPor favor descríbenos brevemente la situación para que nuestro equipo pueda ayudarte 📝`)
    await db.upsertSesion(numero, 'esperando_desc_reporte', datos)
    return
  }

  // ── ESPERANDO DESCRIPCIÓN DE REPORTE ─────────────────────────────────────
  if (sesion.estado === 'esperando_desc_reporte') {
    if (msg.length < 5) {
      await enviarMensajeWA(numero, 'Por favor describe un poco más la situación 🙏')
      return
    }
    await db.createReporte(numero, datos.tipo_reporte || 'otro', msg, sesion.trabajo_id || null)
    await enviarMensajeWA(numero,
      `✅ Tu reporte fue registrado. Nuestro equipo lo revisará y te contactará si es necesario.\n\n¿Hay algo más en lo que pueda ayudarte?`)
    delete datos.tipo_reporte
    await mostrarMenuAyuda(numero)
    await db.upsertSesion(numero, 'esperando_ayuda', datos)
    return
  }

  // ── ESPERANDO CONFIRMACIÓN DE PAGO ───────────────────────────────────────
  if (sesion.estado === 'esperando_confirmacion_pago') {
    await enviarBotones(numero,
      `¿El trabajo quedó completo o aún falta algo por terminar?`,
      [
        { id: 'evaluar',   title: '⭐ Evaluar el trabajo' },
        { id: 'pendiente', title: '🔧 Falta trabajo por terminar' },
      ]
    )
    await db.upsertSesion(numero, 'esperando_decision_post_pago', datos, sesion.trabajo_id)
    return
  }

  // ── ESPERANDO DECISIÓN POST PAGO ─────────────────────────────────────────
  if (sesion.estado === 'esperando_decision_post_pago') {
    const evaluar   = msg === 'evaluar'   || msg.toLowerCase().includes('evaluar') || msg.toLowerCase().includes('calific')
    const pendiente = msg === 'pendiente' || msg.toLowerCase().includes('falta')   || msg.toLowerCase().includes('pendiente')

    if (!evaluar && !pendiente) {
      await enviarBotones(numero,
        `¿El trabajo quedó completo o aún falta algo por terminar?`,
        [
          { id: 'evaluar',   title: '⭐ Evaluar el trabajo' },
          { id: 'pendiente', title: '🔧 Falta trabajo por terminar' },
        ]
      )
      return
    }

    if (evaluar) {
      await db.updateTrabajoEstado(sesion.trabajo_id, 'esperando_calificacion')
      await enviarBotones(numero, '¿Cómo calificarías el trabajo?', [
        { id: '5', title: '⭐⭐⭐⭐⭐ Excelente' },
        { id: '4', title: '⭐⭐⭐⭐ Bueno' },
        { id: '3', title: '⭐⭐⭐ Regular' },
      ])
      await db.upsertSesion(numero, 'esperando_calificacion', datos, sesion.trabajo_id)
      return
    }

    // Pendiente: buscar slots del mismo técnico
    const trabajo = await db.getTrabajo(sesion.trabajo_id)
    if (!trabajo) {
      await enviarMensajeWA(numero, 'No encontramos el trabajo. Escribe *hola* para reiniciar.')
      await db.upsertSesion(numero, 'inicio', {})
      return
    }

    // Marcar el trabajo original como completado
    await db.updateTrabajoEstado(sesion.trabajo_id, 'completado')

    const slots = await db.getSlotsParaTecnico(trabajo.tecnico_id, trabajo.categoria, 5)
    if (!slots.length) {
      await enviarMensajeWA(numero,
        `Entendido 🔧 El técnico no tiene horarios disponibles en este momento.\n\nTe avisaremos cuando tenga disponibilidad para coordinar la visita pendiente.`)
      await db.upsertSesion(numero, 'inicio', {})
      return
    }

    datos.slots_reagendamiento       = slots
    datos.tecnico_reagendamiento_id  = trabajo.tecnico_id
    datos.trabajo_padre_id           = sesion.trabajo_id
    datos.categoria_reagendamiento   = trabajo.categoria
    datos.descripcion_reagendamiento = trabajo.descripcion
    datos.comuna_reagendamiento      = trabajo.comuna

    await enviarLista(numero,
      `Perfecto 🔧 Elige un horario disponible para que el técnico vuelva a terminar el trabajo:`,
      'Ver horarios',
      [{ rows: slots.map((s, i) => ({ id: String(i), title: s.label })) }]
    )
    await db.upsertSesion(numero, 'esperando_slot_reagendamiento', datos)
    return
  }

  // ── ESPERANDO SLOT DE REAGENDAMIENTO ─────────────────────────────────────
  if (sesion.estado === 'esperando_slot_reagendamiento') {
    const slots = datos.slots_reagendamiento || []
    const idx   = parseInt(msg)
    const slot  = (!isNaN(idx) && idx >= 0 && idx < slots.length)
      ? slots[idx]
      : slots.find(s => s.label.toLowerCase().includes(msg.toLowerCase()))

    if (!slot) {
      await enviarLista(numero, 'Por favor selecciona uno de los horarios disponibles:', 'Ver horarios',
        [{ rows: slots.map((s, i) => ({ id: String(i), title: s.label })) }])
      return
    }

    const nuevoTrabajo = await db.crearTrabajoReagendamiento({
      clienteWa:      numero,
      categoria:      datos.categoria_reagendamiento,
      descripcion:    datos.descripcion_reagendamiento || 'Trabajo pendiente',
      comuna:         datos.comuna_reagendamiento,
      urgencia:       'Trabajo pendiente',
      fechaAgendada:  slot.fecha,
      horaAgendada:   slot.hora_inicio,
      tecnicoId:      datos.tecnico_reagendamiento_id,
      trabajoPadreId: datos.trabajo_padre_id,
    })

    await enviarMensajeWA(numero,
      `✅ Solicitud enviada para el *${slot.label}*.\n\nEl técnico confirmará la fecha. Te avisaremos cuando lo haga 🙌`)
    await db.upsertSesion(numero, 'chat_activo', {}, nuevoTrabajo.id)
    return
  }

  // ── CALIFICACIÓN ──────────────────────────────────────────────────────────
  if (sesion.estado === 'esperando_calificacion') {
    const puntaje = parseInt(msg)
    if (isNaN(puntaje) || puntaje < 1 || puntaje > 5) {
      await enviarBotones(numero, '¿Cómo calificarías el trabajo?', [
        { id: '5', title: '⭐⭐⭐⭐⭐ Excelente' },
        { id: '4', title: '⭐⭐⭐⭐ Bueno' },
        { id: '3', title: '⭐⭐⭐ Regular' },
      ]); return
    }
    const trabajo = await db.getTrabajo(sesion.trabajo_id)
    if (trabajo) {
      await db.createCalificacion(sesion.trabajo_id, trabajo.tecnico_id, puntaje)
      const stats = await db.getRatingStats(trabajo.tecnico_id)
      await db.updateTecnicoRating(trabajo.tecnico_id, stats.avg, stats.total)
      await db.updateTrabajoEstado(sesion.trabajo_id, 'completado')
    }
    await enviarMensajeWA(numero,
      `¡Gracias por tu calificación ${'⭐'.repeat(puntaje)}!\n\nEscríbenos cuando necesites otro técnico 🙌`)
    await db.upsertSesion(numero, 'inicio', {})
    return
  }

  await db.upsertSesion(numero, 'inicio', {})
  await enviarMensajeWA(numero, 'Hola 👋 Escríbeme para pedir un técnico.')
}

// ── PROCESAR FECHAS Y CREAR TRABAJO ──────────────────────────────────────────
async function procesarFechasListas(numero, datos) {
  const tecnicos = await db.buscarTecnicosPorFechas(datos.categoria, datos.comuna, datos.fechas_propuestas)
  const lista = datos.fechas_propuestas.map(f => `• ${f.label}`).join('\n')

  if (!tecnicos.length) {
    await enviarBotones(numero,
      `No encontramos técnicos disponibles para tus fechas 😕\n\n${lista}\n\n¿Qué deseas hacer?`,
      [{ id: 'mas_fechas', title: '📅 Agregar más fechas' }, { id: 'otro_servicio', title: '🔄 Solicitar otro servicio' }]
    )
    await db.upsertSesion(numero, 'esperando_accion_sin_tecnico', datos)
    return
  }

  const trabajo = await db.createTrabajo({
    cliente_nombre: 'Cliente',
    cliente_wa: numero,
    categoria: datos.categoria,
    descripcion: datos.descripcion,
    comuna: datos.comuna,
    urgencia: 'Elegir fecha',
  })

  await db.createFechasPropuestas(trabajo.id, datos.fechas_propuestas)

  await enviarMensajeWA(numero,
    `✅ ¡Solicitud enviada!\n\nTus fechas propuestas:\n${lista}\n\nUn técnico revisará tu solicitud y confirmará una fecha.\nTe avisaré cuando ocurra 🙌`)

  await db.upsertSesion(numero, 'chat_activo', datos, trabajo.id)
}

// ── TIMEOUT 2H: verificar trabajos sin técnico ────────────────────────────────
export async function checkJobsTimeout() {
  const jobs = await db.getTrabajosPendientesNotificacion()
  for (const job of jobs) {
    const fechas = await db.getFechasPropuestas(job.id)
    let msg = `⏰ Aún no encontramos técnico para tu solicitud de *${job.categoria}* en ${job.comuna}.`
    if (fechas.length) {
      const fechasStr = fechas.map(f => `• ${f.label}`).join('\n')
      msg += `\n\nTus fechas propuestas:\n${fechasStr}`
    }
    msg += '\n\n¿Qué deseas hacer?'

    await enviarBotones(job.cliente_wa, msg,
      [{ id: 'mas_fechas', title: '📅 Agregar más fechas' }, { id: 'otro_servicio', title: '🔄 Solicitar otro servicio' }]
    )

    await db.marcarNotificado(job.id)

    const sesion = await db.getSesion(job.cliente_wa)
    if (sesion) {
      const datos = JSON.parse(sesion.datos_temp || '{}')
      await db.upsertSesion(job.cliente_wa, 'esperando_accion_sin_tecnico', datos, job.id)
    }
  }
}

// ── HELPERS ───────────────────────────────────────────────────────────────────
async function mostrarMenuAyuda(numero) {
  await enviarLista(numero,
    '❓ *Centro de ayuda TecnicosYa*\n\nSelecciona una opción o escribe *ayuda* en cualquier momento para volver aquí:',
    'Ver opciones',
    [{
      rows: [
        { id: 'como_funciona', title: '📋 ¿Cómo funciona?' },
        { id: 'comunas',       title: '📍 ¿En qué comunas trabajan?' },
        { id: 'precios',       title: '💰 ¿Cuánto cobran los técnicos?' },
        { id: 'cancelar',      title: '❌ Cancelar una solicitud' },
        { id: 'problema',      title: '⚠️ Tengo un problema' },
        { id: 'volver',        title: '🔙 Volver al menú principal' },
      ]
    }]
  )
}

async function mostrarSlots(numero, datos, sesion) {
  const slots = await db.buscarSlotsDisponibles(datos.categoria, datos.comuna, 5)
  if (!slots.length) {
    await enviarMensajeWA(numero,
      `No hay horarios disponibles en ${datos.comuna} para los próximos días 😕`)
    await db.upsertSesion(numero, 'inicio', {})
    return
  }
  datos.slots = slots
  await enviarLista(numero,
    `Estos son los próximos horarios disponibles en ${datos.comuna}:`,
    'Ver horarios',
    [{ rows: slots.map((s, i) => ({ id: String(i), title: s.label })) }]
  )
  await db.upsertSesion(numero, 'esperando_slot', datos, sesion.trabajo_id)
}

async function mostrarTecnicos(numero, datos, tecnicos, sesion) {
  const lista = tecnicos.map(t => ({
    id: String(t.id),
    title: t.nombre,
    description: `★ ${t.rating > 0 ? t.rating.toFixed(1) : 'Nuevo'} · ${t.total_jobs} trabajos`
  }))
  await enviarLista(numero,
    `Encontré *${tecnicos.length} técnico${tecnicos.length !== 1 ? 's' : ''}* disponibles en ${datos.comuna}. ¿Con cuál te conecto?`,
    'Ver técnicos',
    [{ rows: lista }]
  )
  datos.tecnicos = tecnicos.map(t => ({ id: t.id, nombre: t.nombre }))
  await db.upsertSesion(numero, 'esperando_eleccion', datos, sesion.trabajo_id)
}
