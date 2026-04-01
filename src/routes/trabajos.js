import { Router } from 'express'
import { db } from '../db/database.js'
import { authMiddleware } from '../middleware/auth.js'
import { enviarMensajeWA, enviarBotones } from '../services/whatsapp.js'

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
    const disponibles = await db.getTrabajosdisponibles(comunas)
    const mios        = await db.getMisTrabajos(req.tecnico.id)

    const disponiblesEnriquecidos = await Promise.all(
      disponibles.map(async j => ({
        ...j,
        fechas_propuestas: await db.getFechasPropuestas(j.id)
      }))
    )

    res.json({ disponibles: disponiblesEnriquecidos, mios })
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
    if (trabajo) {
      await enviarBotones(trabajo.cliente_wa,
        `🎉 *${(await db.getTecnico(req.tecnico.id)).nombre}* marcó tu trabajo como completado.\n\n¿Cómo calificarías el servicio?`,
        [
          { id: '5', title: '⭐⭐⭐⭐⭐ Excelente' },
          { id: '4', title: '⭐⭐⭐⭐ Bueno' },
          { id: '3', title: '⭐⭐⭐ Regular' },
        ]
      )
      const sesion = await db.getSesion(trabajo.cliente_wa)
      if (sesion) {
        const datos = JSON.parse(sesion.datos_temp || '{}')
        await db.upsertSesion(trabajo.cliente_wa, 'esperando_calificacion', datos, trabajo.id)
      }
    }

    res.json({ ok: true })
  } catch (err) { console.error(err); res.status(500).json({ error: 'Error interno' }) }
})

export default router
