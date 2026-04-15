import { Router } from 'express'
import { db } from '../db/database.js'
import { authMiddleware } from '../middleware/auth.js'
import { enviarMensajeWA, enviarBotones, enviarLista } from '../services/whatsapp.js'

const router = Router()
router.use(authMiddleware)

function formatFechaCorta(fechaStr) {
  if (!fechaStr) return ''
  const d = new Date(fechaStr + 'T12:00:00')
  const dias  = ['Dom','Lun','Mar','Mié','Jue','Vie','Sáb']
  const meses = ['ene','feb','mar','abr','may','jun','jul','ago','sep','oct','nov','dic']
  return `${dias[d.getDay()]} ${d.getDate()} ${meses[d.getMonth()]}`
}

router.get('/', async (req, res) => {
  try {
    const comunas    = await db.getComunas(req.tecnico.id)
    const [disponibles, mios, reagendamientos] = await Promise.all([
      db.getTrabajosdisponibles(comunas),
      db.getMisTrabajos(req.tecnico.id),
      db.getTrabajosReagendamiento(req.tecnico.id),
    ])

    const disponiblesEnriquecidos = await Promise.all(
      disponibles.map(async j => ({
        ...j,
        fechas_propuestas: await db.getFechasPropuestas(j.id)
      }))
    )

    res.json({ disponibles: disponiblesEnriquecidos, mios, reagendamientos })
  } catch (err) { console.error(err); res.status(500).json({ error: 'Error interno' }) }
})

router.post('/:id/aceptar', async (req, res) => {
  try {
    const { fecha, hora } = req.body || {}
    const trabajo = await db.aceptarTrabajo(parseInt(req.params.id), req.tecnico.id, fecha || null, hora || null)
    if (!trabajo) return res.status(400).json({ error: 'No se pudo aceptar el trabajo' })

    const tecnico = await db.getTecnico(req.tecnico.id)
    const fechaFinal = trabajo.fecha_agendada
      ? (typeof trabajo.fecha_agendada === 'string' ? trabajo.fecha_agendada : trabajo.fecha_agendada.toISOString().split('T')[0])
      : null
    const horaFinal = trabajo.hora_agendada || null

    let msgCliente = `✅ ¡Confirmado! *${tecnico.nombre}* aceptó tu solicitud de ${trabajo.categoria} en ${trabajo.comuna}.`
    if (fechaFinal && horaFinal) {
      msgCliente += `\n\n📅 Fecha: ${formatFechaCorta(fechaFinal)} a las ${horaFinal}`
    }
    msgCliente += '\n\nPuedes escribirle directamente aquí 💬'

    await enviarMensajeWA(trabajo.cliente_wa, msgCliente)

    res.json({ ok: true })
  } catch (err) { console.error(err); res.status(500).json({ error: 'Error interno' }) }
})

router.post('/:id/completar', async (req, res) => {
  try {
    const ok = await db.completarTrabajo(parseInt(req.params.id), req.tecnico.id)
    if (!ok) return res.status(400).json({ error: 'No se pudo completar el trabajo' })

    const trabajo = await db.getTrabajo(parseInt(req.params.id))
    const tecnico = await db.getTecnico(req.tecnico.id)

    if (trabajo) {
      // Enviar enlace de pago (placeholder) + aviso de que confirme al pagar
      const URL_PAGO = process.env.PAGO_URL || 'https://tecnicosya.cl/pagar'
      await enviarMensajeWA(trabajo.cliente_wa,
        `✅ *${tecnico.nombre}* terminó la visita de *${trabajo.categoria}* en ${trabajo.comuna}.\n\n` +
        `Para finalizar, realiza el pago aquí:\n${URL_PAGO}\n\n` +
        `Una vez pagado, respóndenos aquí para continuar 👇`
      )
      const sesion = await db.getSesion(trabajo.cliente_wa)
      const datos  = sesion ? JSON.parse(sesion.datos_temp || '{}') : {}
      await db.upsertSesion(trabajo.cliente_wa, 'esperando_confirmacion_pago', datos, trabajo.id)
    }

    res.json({ ok: true })
  } catch (err) { console.error(err); res.status(500).json({ error: 'Error interno' }) }
})

// Confirmar reagendamiento (técnico acepta la fecha propuesta por el cliente)
router.post('/:id/confirmar-reagendamiento', async (req, res) => {
  try {
    const trabajo = await db.confirmarReagendamiento(parseInt(req.params.id), req.tecnico.id)
    if (!trabajo) return res.status(400).json({ error: 'No se pudo confirmar' })

    const tecnico   = await db.getTecnico(req.tecnico.id)
    const fechaStr  = trabajo.fecha_agendada
      ? (typeof trabajo.fecha_agendada === 'string' ? trabajo.fecha_agendada : trabajo.fecha_agendada.toISOString().split('T')[0])
      : null

    await enviarMensajeWA(trabajo.cliente_wa,
      `✅ *${tecnico.nombre}* confirmó la visita para el trabajo pendiente.\n\n` +
      `📅 ${formatFechaCorta(fechaStr)} a las ${trabajo.hora_agendada}\n\n` +
      `Puedes escribirle directamente aquí si necesitas coordinar algo 💬`
    )

    const sesion = await db.getSesion(trabajo.cliente_wa)
    if (sesion) {
      const datos = JSON.parse(sesion.datos_temp || '{}')
      await db.upsertSesion(trabajo.cliente_wa, 'chat_activo', datos, trabajo.id)
    }

    res.json({ ok: true })
  } catch (err) { console.error(err); res.status(500).json({ error: 'Error interno' }) }
})

// Rechazar reagendamiento (técnico rechaza la fecha, cliente debe elegir otra)
router.post('/:id/rechazar-reagendamiento', async (req, res) => {
  try {
    const { razon } = req.body
    const trabajo = await db.rechazarReagendamiento(parseInt(req.params.id), req.tecnico.id, razon || null)
    if (!trabajo) return res.status(400).json({ error: 'No se pudo rechazar' })

    const tecnico = await db.getTecnico(req.tecnico.id)
    const slots   = await db.getSlotsParaTecnico(req.tecnico.id, trabajo.categoria, 5)

    if (!slots.length) {
      await enviarMensajeWA(trabajo.cliente_wa,
        `😔 *${tecnico.nombre}* no puede en la fecha elegida.\n` +
        (razon ? `Motivo: ${razon}\n\n` : '\n') +
        `Por el momento no tiene otros horarios disponibles. Te avisaremos cuando haya disponibilidad.`
      )
    } else {
      const sesion = await db.getSesion(trabajo.cliente_wa)
      const datos  = sesion ? JSON.parse(sesion.datos_temp || '{}') : {}
      datos.slots_reagendamiento = slots
      datos.tecnico_reagendamiento_id = req.tecnico.id
      datos.trabajo_padre_id = trabajo.trabajo_padre_id || trabajo.id

      await enviarLista(trabajo.cliente_wa,
        `😔 *${tecnico.nombre}* no puede en esa fecha.\n` +
        (razon ? `Motivo: _${razon}_\n\n` : '\n') +
        `Por favor elige otro horario disponible:`,
        'Ver horarios',
        [{ rows: slots.map((s, i) => ({ id: String(i), title: s.label })) }]
      )
      await db.upsertSesion(trabajo.cliente_wa, 'esperando_slot_reagendamiento', datos, trabajo.id)
    }

    res.json({ ok: true })
  } catch (err) { console.error(err); res.status(500).json({ error: 'Error interno' }) }
})

export default router
