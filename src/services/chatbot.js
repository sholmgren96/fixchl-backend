import { db } from '../db/database.js'
import { enviarMensajeWA } from './whatsapp.js'

const CATEGORIAS = ['Gasfitería', 'Electricidad', 'Pintura', 'Aseo', 'Otro']
const URGENCIAS  = ['Hoy mismo', 'Esta semana', 'Elegir fecha']

export async function procesarMensaje(numeroWA, texto) {
  const numero = numeroWA.replace('whatsapp:', '')
  const msg    = texto.trim()

  let sesion = db.getSesion(numero)
  if (!sesion) {
    db.upsertSesion(numero, 'inicio', {})
    sesion = { cliente_wa: numero, estado: 'inicio', datos_temp: '{}', trabajo_id: null }
  }

  const datos = JSON.parse(sesion.datos_temp || '{}')

  if (sesion.estado === 'inicio') {
    await enviarMensajeWA(numero, `¡Hola! 👋 Soy el asistente de *FixChl*.\n\nConecto personas con técnicos de calidad en Santiago. ¿Qué servicio necesitas?\n\n${CATEGORIAS.map((c,i) => `*${i+1}* ${c}`).join('\n')}`)
    db.upsertSesion(numero, 'esperando_categoria', datos)
    return
  }

  if (sesion.estado === 'esperando_categoria') {
    const idx = parseInt(msg) - 1
    const categoria = !isNaN(idx) ? CATEGORIAS[idx] : CATEGORIAS.find(c => c.toLowerCase().includes(msg.toLowerCase()))
    if (!categoria) { await enviarMensajeWA(numero, `Responde con el número:\n\n${CATEGORIAS.map((c,i) => `*${i+1}* ${c}`).join('\n')}`); return }
    datos.categoria = categoria
    await enviarMensajeWA(numero, `Entendido, *${categoria}* 👍\n\nCuéntame brevemente el problema.\n\n_Ej: "llave que gotea", "sin luz en dormitorio"_`)
    db.upsertSesion(numero, 'esperando_descripcion', datos)
    return
  }

  if (sesion.estado === 'esperando_descripcion') {
    if (msg.length < 5) { await enviarMensajeWA(numero, 'Por favor describe un poco más el problema 🙏'); return }
    datos.descripcion = msg
    await enviarMensajeWA(numero, `¿En qué comuna de Santiago estás?\n\n_Ej: Providencia, Las Condes, Ñuñoa, Santiago_`)
    db.upsertSesion(numero, 'esperando_comuna', datos)
    return
  }

  if (sesion.estado === 'esperando_comuna') {
    datos.comuna = msg
    await enviarMensajeWA(numero, `¿Con qué urgencia lo necesitas?\n\n*1* Hoy mismo\n*2* Esta semana\n*3* Elegir fecha`)
    db.upsertSesion(numero, 'esperando_urgencia', datos)
    return
  }

  if (sesion.estado === 'esperando_urgencia') {
    const idx = parseInt(msg) - 1
    const urgencia = !isNaN(idx) ? URGENCIAS[idx] : URGENCIAS.find(u => u.toLowerCase().includes(msg.toLowerCase()))
    if (!urgencia) { await enviarMensajeWA(numero, 'Responde *1*, *2* o *3*'); return }
    datos.urgencia = urgencia

    const trabajo = db.createTrabajo({ cliente_nombre: datos.nombre_cliente || 'Cliente', cliente_wa: numero, categoria: datos.categoria, descripcion: datos.descripcion, comuna: datos.comuna, urgencia })
    datos.trabajo_id = trabajo.id

    const tecnicos = db.buscarTecnicos(datos.categoria, datos.comuna)
    if (!tecnicos.length) {
      await enviarMensajeWA(numero, `No encontré técnicos disponibles en *${datos.comuna}* ahora mismo 😕\nTe avisaremos cuando haya uno disponible.`)
      db.upsertSesion(numero, 'inicio', {})
      return
    }

    const lista = tecnicos.map((t,i) => `*${i+1}* ${t.nombre}\n   ★ ${t.rating > 0 ? t.rating.toFixed(1) : 'Nuevo'} · ${t.total_jobs} trabajos`).join('\n\n')
    await enviarMensajeWA(numero, `Encontré *${tecnicos.length} técnico${tecnicos.length !== 1 ? 's' : ''}* disponibles en ${datos.comuna}:\n\n${lista}\n\n¿Con cuál te conecto? Responde el número.`)

    datos.tecnicos = tecnicos.map(t => ({ id: t.id, nombre: t.nombre }))
    db.upsertSesion(numero, 'esperando_eleccion', datos, trabajo.id)
    return
  }

  if (sesion.estado === 'esperando_eleccion') {
    const idx = parseInt(msg) - 1
    const elegido = datos.tecnicos?.[idx]
    if (!elegido) { await enviarMensajeWA(numero, `Responde un número entre 1 y ${datos.tecnicos?.length || 1}`); return }

    db.updateTrabajoTecnico(sesion.trabajo_id, elegido.id)
    db.updateTrabajoEstado(sesion.trabajo_id, 'activo')
    await enviarMensajeWA(numero, `¡Listo! Le avisé a *${elegido.nombre}* sobre tu solicitud 🙌\n\nTe confirmará en los próximos minutos. Puedes escribirme aquí y te haré llegar los mensajes.`)
    db.upsertSesion(numero, 'chat_activo', datos, sesion.trabajo_id)
    return
  }

  if (sesion.estado === 'chat_activo') {
    if (sesion.trabajo_id) db.createMensaje(sesion.trabajo_id, 'cliente', msg)
    return
  }

  if (sesion.estado === 'esperando_calificacion') {
    const puntaje = parseInt(msg)
    if (isNaN(puntaje) || puntaje < 1 || puntaje > 5) { await enviarMensajeWA(numero, 'Responde con un número del 1 al 5 ⭐'); return }

    const trabajo = db.getTrabajo(sesion.trabajo_id)
    if (trabajo) {
      db.createCalificacion(sesion.trabajo_id, trabajo.tecnico_id, puntaje)
      const stats = db.getRatingStats(trabajo.tecnico_id)
      db.updateTecnicoRating(trabajo.tecnico_id, stats.avg, stats.total)
      db.updateTrabajoEstado(sesion.trabajo_id, 'completado')
    }

    await enviarMensajeWA(numero, `¡Gracias por tu calificación ${'⭐'.repeat(puntaje)}!\n\nTu opinión ayuda a mejorar la calidad. ¿Necesitas otro servicio? Escríbeme cuando quieras 🙌`)
    db.upsertSesion(numero, 'inicio', {})
    return
  }

  db.upsertSesion(numero, 'inicio', {})
  await enviarMensajeWA(numero, 'Hola 👋 Escríbeme para pedir un técnico.')
}
