import { db } from '../db/database.js'
import { enviarMensajeWA, enviarLista, enviarBotones } from './whatsapp.js'

const CATEGORIAS = ['Electricista', 'Gasfiter', 'Servicio de aseo', 'Pintor', 'Maestro general', 'Otro']
const URGENCIAS  = ['Hoy mismo', 'Esta semana', 'Elegir fecha']
const COMUNAS    = ['Las Condes', 'Vitacura', 'Lo Barnechea', 'Chicureo']

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

  // ── INICIO ────────────────────────────────────────────────────────────────
  if (sesion.estado === 'inicio') {
    await enviarLista(numero,
      '¡Hola! 👋 Soy el asistente de *TecnoYa*.\n\nConecto personas con técnicos de calidad en Santiago. ¿Qué servicio necesitas?',
      'Ver servicios',
      [{ rows: CATEGORIAS.map(c => ({ id: c, title: c })) }]
    )
    await db.upsertSesion(numero, 'esperando_categoria', datos)
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
          `No hay técnicos disponibles en ${datos.comuna} ahora mismo 😕\n\n¿Quieres que te avisemos cuando haya uno?`,
          [{ id: 'si_avisar', title: 'Sí, avísame' }, { id: 'no', title: 'No, gracias' }]
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
        '¡Hola! 👋 Soy el asistente de *TecnoYa*.\n\n¿Qué servicio necesitas?',
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
    if (msg === 'si_avisar' || msg.toLowerCase().includes('sí') || msg.toLowerCase().includes('si')) {
      await enviarMensajeWA(numero,
        `Perfecto, te avisaremos cuando haya un técnico de ${datos.categoria} disponible en ${datos.comuna} 🙌`)
    } else {
      await enviarMensajeWA(numero, 'Entendido. Escríbenos cuando lo necesites 👋')
    }
    await db.upsertSesion(numero, 'inicio', {})
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
    if (sesion.trabajo_id) await db.createMensaje(sesion.trabajo_id, 'cliente', msg)
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
