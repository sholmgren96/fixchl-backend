import { db } from '../db/database.js'
import { enviarMensajeWA, enviarLista, enviarBotones } from './whatsapp.js'

const CATEGORIAS = ['Electricista', 'Gasfiter', 'Servicio de aseo', 'Pintor', 'Maestro general', 'Otro']
const URGENCIAS  = ['Hoy mismo', 'Esta semana', 'Otro momento']
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
      [{
        rows: CATEGORIAS.map(c => ({ id: c, title: c }))
      }]
    )
    db.upsertSesion(numero, 'esperando_categoria', datos)
    return
  }

  // ── ESPERANDO CATEGORÍA ───────────────────────────────────────────────────
  if (sesion.estado === 'esperando_categoria') {
    const categoria = CATEGORIAS.find(c =>
      c.toLowerCase() === msg.toLowerCase() ||
      c.toLowerCase().includes(msg.toLowerCase())
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
    if (msg.length < 5) {
      await enviarMensajeWA(numero, 'Por favor describe un poco más el problema 🙏')
      return
    }
    datos.descripcion = msg
    await enviarLista(numero,
      '¿En qué comuna de Santiago estás?',
      'Ver comunas',
      [{ rows: COMUNAS.map(c => ({ id: c, title: c })) }]
    )
    db.upsertSesion(numero, 'esperando_comuna', datos)
    return
  }

  // ── ESPERANDO COMUNA ──────────────────────────────────────────────────────
  if (sesion.estado === 'esperando_comuna') {
    const comuna = COMUNAS.find(c =>
      c.toLowerCase() === msg.toLowerCase() ||
      c.toLowerCase().includes(msg.toLowerCase())
    )
    if (!comuna) {
      await enviarLista(numero, '¿En qué comuna estás?', 'Ver comunas',
        [{ rows: COMUNAS.map(c => ({ id: c, title: c })) }])
      return
    }
    datos.comuna = comuna
    await enviarBotones(numero,
      '¿Con qué urgencia lo necesitas?',
      URGENCIAS.map(u => ({ id: u, title: u }))
    )
    db.upsertSesion(numero, 'esperando_urgencia', datos)
    return
  }

  // ── ESPERANDO URGENCIA ────────────────────────────────────────────────────
  if (sesion.estado === 'esperando_urgencia') {
    const urgencia = URGENCIAS.find(u =>
      u.toLowerCase() === msg.toLowerCase() ||
      u.toLowerCase().includes(msg.toLowerCase())
    )
    if (!urgencia) {
      await enviarBotones(numero, '¿Con qué urgencia lo necesitas?',
        URGENCIAS.map(u => ({ id: u, title: u })))
      return
    }
    datos.urgencia = urgencia

    const trabajo = db.createTrabajo({
      cliente_nombre: datos.nombre_cliente || 'Cliente',
      cliente_wa: numero,
      categoria: datos.categoria,
      descripcion: datos.descripcion,
      comuna: datos.comuna,
      urgencia
    })
    datos.trabajo_id = trabajo.id

    const tecnicos = db.buscarTecnicos(datos.categoria, datos.comuna)
    if (!tecnicos.length) {
      await enviarMensajeWA(numero,
        `No encontré técnicos disponibles en *${datos.comuna}* ahora mismo 😕\nTe avisaremos cuando haya uno disponible.`)
      db.upsertSesion(numero, 'inicio', {})
      return
    }

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
    db.upsertSesion(numero, 'esperando_eleccion', datos, trabajo.id)
    return
  }

  // ── ESPERANDO ELECCIÓN ────────────────────────────────────────────────────
  if (sesion.estado === 'esperando_eleccion') {
    const elegido = datos.tecnicos?.find(t =>
      String(t.id) === msg || t.nombre.toLowerCase() === msg.toLowerCase()
    )
    if (!elegido) {
      await enviarMensajeWA(numero, 'Por favor selecciona un técnico de la lista.')
      return
    }

    db.updateTrabajoTecnico(sesion.trabajo_id, elegido.id)
    db.updateTrabajoEstado(sesion.trabajo_id, 'activo')

    await enviarMensajeWA(numero,
      `¡Listo! Le avisé a *${elegido.nombre}* sobre tu solicitud 🙌\n\nTe confirmará en los próximos minutos. Puedes escribirme aquí y te haré llegar los mensajes.`)
    db.upsertSesion(numero, 'chat_activo', datos, sesion.trabajo_id)
    return
  }

  // ── CHAT ACTIVO (relay) ───────────────────────────────────────────────────
  if (sesion.estado === 'chat_activo') {
    if (sesion.trabajo_id) db.createMensaje(sesion.trabajo_id, 'cliente', msg)
    return
  }

  // ── ESPERANDO CALIFICACIÓN ────────────────────────────────────────────────
  if (sesion.estado === 'esperando_calificacion') {
    const puntaje = parseInt(msg)
    if (isNaN(puntaje) || puntaje < 1 || puntaje > 5) {
      await enviarBotones(numero, '¿Cómo calificarías el trabajo?', [
        { id: '5', title: '⭐⭐⭐⭐⭐ Excelente' },
        { id: '4', title: '⭐⭐⭐⭐ Bueno' },
        { id: '3', title: '⭐⭐⭐ Regular' },
      ])
      return
    }

    const trabajo = db.getTrabajo(sesion.trabajo_id)
    if (trabajo) {
      db.createCalificacion(sesion.trabajo_id, trabajo.tecnico_id, puntaje)
      const stats = db.getRatingStats(trabajo.tecnico_id)
      db.updateTecnicoRating(trabajo.tecnico_id, stats.avg, stats.total)
      db.updateTrabajoEstado(sesion.trabajo_id, 'completado')
    }

    await enviarMensajeWA(numero,
      `¡Gracias por tu calificación ${'⭐'.repeat(puntaje)}!\n\nTu opinión ayuda a mejorar la calidad. ¿Necesitas otro servicio? Escríbeme cuando quieras 🙌`)
    db.upsertSesion(numero, 'inicio', {})
    return
  }

  db.upsertSesion(numero, 'inicio', {})
  await enviarMensajeWA(numero, 'Hola 👋 Escríbeme para pedir un técnico.')
}
