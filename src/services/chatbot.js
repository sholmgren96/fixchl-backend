import { db } from '../db/database.js'
import { enviarMensajeWA, enviarLista, enviarBotones } from './whatsapp.js'

const CATEGORIAS = ['Electricista', 'Gasfiter', 'Servicio de aseo', 'Pintor', 'Maestro general', 'Otro']
const URGENCIAS  = ['Hoy mismo', 'Esta semana', 'Elegir fecha']
const COMUNAS    = ['Las Condes', 'Vitacura', 'Lo Barnechea', 'Chicureo']

export async function procesarMensaje(numeroWA, texto) {
  const numero = numeroWA.replace('whatsapp:', '')
  const msg    = texto.trim()

  let sesion = db.getSesion(numero)
  if (!sesion) {
    db.upsertSesion(numero, 'inicio', {})
    sesion = { cliente_wa: numero, estado: 'inicio', datos_temp: '{}', trabajo_id: null }
  }

  const datos = JSON.parse(sesion.datos_temp || '{}')

  // ── INICIO ────────────────────────────────────────────────────────────────
  if (sesion.estado === 'inicio') {
    await enviarLista(numero,
      '¡Hola! 👋 Soy el asistente de *TecnoYa*.\n\nConecto personas con técnicos de calidad en Santiago. ¿Qué servicio necesitas?',
      'Ver servicios',
      [{ rows: CATEGORIAS.map(c => ({ id: c, title: c })) }]
    )
    db.upsertSesion(numero, 'esperando_categoria', datos)
    return
  }

  // ── ESPERANDO CATEGORÍA ───────────────────────────────────────────────────
  if (sesion.estado === 'esperando_categoria') {
    const categoria = CATEGORIAS.find(c =>
      c.toLowerCase() === msg.toLowerCase() || c.toLowerCase().includes(msg.toLowerCase())
    )
    if (!categoria) {
      await enviarLista(numero, 'Por favor selecciona una opción:', 'Ver servicios',
        [{ rows: CATEGORIAS.map(c => ({ id: c, title: c })) }])
      return
    }
    datos.categoria = categoria
    await enviarMensajeWA(numero,
      `Entendido, *${categoria}* 👍\n\nCuéntame brevemente el problema.\n\n_Ej: "llave que gotea", "sin luz en dormitorio"_`)
    db.upsertSesion(numero, 'esperando_descripcion', datos)
    return
  }

  // ── ESPERANDO DESCRIPCIÓN ─────────────────────────────────────────────────
  if (sesion.estado === 'esperando_descripcion') {
    if (msg.length < 5) { await enviarMensajeWA(numero, 'Por favor describe un poco más el problema 🙏'); return }
    datos.descripcion = msg
    await enviarLista(numero, '¿En qué comuna de Santiago estás?', 'Ver comunas',
      [{ rows: COMUNAS.map(c => ({ id: c, title: c })) }])
    db.upsertSesion(numero, 'esperando_comuna', datos)
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
    db.upsertSesion(numero, 'esperando_urgencia', datos)
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
      // Mostrar slots disponibles
      return await mostrarSlots(numero, datos, sesion)
    }

    // Buscar técnicos disponibles ahora
    const tecnicos = db.buscarTecnicos(datos.categoria, datos.comuna)

    if (!tecnicos.length) {
      // No hay nadie disponible ahora — ofrecer agenda
      const slots = db.buscarSlotsDisponibles(datos.categoria, datos.comuna, 3)
      if (slots.length) {
        datos.slots = slots
        await enviarLista(numero,
          `No hay técnicos disponibles ahora mismo en ${datos.comuna} 😕\n\n¿Te agendo para uno de estos horarios?`,
          'Ver horarios',
          [{ rows: slots.map((s,i) => ({ id: String(i), title: s.label })) }]
        )
        db.upsertSesion(numero, 'esperando_slot', datos)
      } else {
        await enviarBotones(numero,
          `No hay técnicos disponibles en ${datos.comuna} ahora mismo 😕\n\n¿Quieres que te avisemos cuando haya uno disponible?`,
          [{ id: 'si_avisar', title: 'Sí, avísame' }, { id: 'no', title: 'No, gracias' }]
        )
        db.upsertSesion(numero, 'esperando_aviso', datos)
      }
      return
    }

    await mostrarTecnicos(numero, datos, tecnicos, sesion)
    return
  }

  // ── ESPERANDO SLOT (fecha agendada) ───────────────────────────────────────
  if (sesion.estado === 'esperando_slot') {
    const idx = parseInt(msg)
    const slot = datos.slots?.[isNaN(idx) ? -1 : idx]

    // También buscar por nombre del slot
    const slotPorNombre = datos.slots?.find(s => s.label.toLowerCase().includes(msg.toLowerCase()))
    const slotElegido = slot || slotPorNombre

    if (!slotElegido) {
      await enviarMensajeWA(numero, 'Por favor selecciona uno de los horarios disponibles.')
      return
    }

    datos.fecha_agendada = slotElegido.fecha
    datos.hora_agendada  = slotElegido.hora_inicio
    datos.tecnico_preseleccionado = { id: slotElegido.tecnico_id, nombre: slotElegido.tecnico_nombre }

    const trabajo = db.createTrabajo({
      cliente_nombre: 'Cliente',
      cliente_wa: numero,
      categoria: datos.categoria,
      descripcion: datos.descripcion,
      comuna: datos.comuna,
      urgencia: datos.urgencia || 'Agendado',
      fecha_agendada: datos.fecha_agendada,
      hora_agendada: datos.hora_agendada,
    })
    datos.trabajo_id = trabajo.id

    db.updateTrabajoTecnico(trabajo.id, slotElegido.tecnico_id)
    db.aceptarTrabajo(trabajo.id, slotElegido.tecnico_id)

    await enviarMensajeWA(numero,
      `✅ ¡Listo! Quedaste agendado con *${slotElegido.tecnico_nombre}*\n\n📅 ${slotElegido.label}\n\nTe contactará antes de la visita. ¿Alguna duda puedes escribirme aquí 🙌`)
    db.upsertSesion(numero, 'chat_activo', datos, trabajo.id)
    return
  }

  // ── ESPERANDO AVISO ───────────────────────────────────────────────────────
  if (sesion.estado === 'esperando_aviso') {
    if (msg === 'si_avisar' || msg.toLowerCase().includes('sí') || msg.toLowerCase().includes('si')) {
      await enviarMensajeWA(numero,
        `Perfecto, te avisaremos cuando haya un técnico de ${datos.categoria} disponible en ${datos.comuna} 🙌\n\nPuedes escribirnos en cualquier momento para verificar.`)
    } else {
      await enviarMensajeWA(numero, 'Entendido. Escríbenos cuando lo necesites 👋')
    }
    db.upsertSesion(numero, 'inicio', {})
    return
  }

  // ── ESPERANDO ELECCIÓN DE TÉCNICO ─────────────────────────────────────────
  if (sesion.estado === 'esperando_eleccion') {
    const elegido = datos.tecnicos?.find(t =>
      String(t.id) === msg || t.nombre.toLowerCase() === msg.toLowerCase()
    )
    if (!elegido) { await enviarMensajeWA(numero, 'Por favor selecciona un técnico de la lista.'); return }

    const trabajo = db.createTrabajo({
      cliente_nombre: 'Cliente',
      cliente_wa: numero,
      categoria: datos.categoria,
      descripcion: datos.descripcion,
      comuna: datos.comuna,
      urgencia: datos.urgencia,
    })

    db.updateTrabajoTecnico(trabajo.id, elegido.id)
    db.updateTrabajoEstado(trabajo.id, 'activo')

    await enviarMensajeWA(numero,
      `¡Listo! Le avisé a *${elegido.nombre}* sobre tu solicitud 🙌\n\nTe confirmará en los próximos minutos. Puedes escribirme aquí.`)
    db.upsertSesion(numero, 'chat_activo', datos, trabajo.id)
    return
  }

  // ── CHAT ACTIVO ───────────────────────────────────────────────────────────
  if (sesion.estado === 'chat_activo') {
    if (sesion.trabajo_id) db.createMensaje(sesion.trabajo_id, 'cliente', msg)
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
    const trabajo = db.getTrabajo(sesion.trabajo_id)
    if (trabajo) {
      db.createCalificacion(sesion.trabajo_id, trabajo.tecnico_id, puntaje)
      const stats = db.getRatingStats(trabajo.tecnico_id)
      db.updateTecnicoRating(trabajo.tecnico_id, stats.avg, stats.total)
      db.updateTrabajoEstado(sesion.trabajo_id, 'completado')
    }
    await enviarMensajeWA(numero,
      `¡Gracias por tu calificación ${'⭐'.repeat(puntaje)}!\n\nTu opinión mejora la calidad del servicio. Escríbenos cuando necesites otro técnico 🙌`)
    db.upsertSesion(numero, 'inicio', {})
    return
  }

  db.upsertSesion(numero, 'inicio', {})
  await enviarMensajeWA(numero, 'Hola 👋 Escríbeme para pedir un técnico.')
}

// ── Helpers ──────────────────────────────────────────────────────────────────

async function mostrarSlots(numero, datos, sesion) {
  const slots = db.buscarSlotsDisponibles(datos.categoria, datos.comuna, 5)
  if (!slots.length) {
    await enviarMensajeWA(numero,
      `No hay horarios disponibles en ${datos.comuna} para los próximos días 😕\n\nEscríbenos más adelante o elige otra urgencia.`)
    db.upsertSesion(numero, 'inicio', {})
    return
  }
  datos.slots = slots
  await enviarLista(numero,
    `Estos son los próximos horarios disponibles en ${datos.comuna}:`,
    'Ver horarios',
    [{ rows: slots.map((s,i) => ({ id: String(i), title: s.label })) }]
  )
  db.upsertSesion(numero, 'esperando_slot', datos, sesion.trabajo_id)
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
  db.upsertSesion(numero, 'esperando_eleccion', datos, sesion.trabajo_id)
}
