import { Router } from 'express'
import { db } from '../db/database.js'
import { authMiddleware } from '../middleware/auth.js'
import { enviarMensajeWA } from '../services/whatsapp.js'
import { sanitizarMensaje } from '../services/sanitizar.js'

const router = Router()
router.use(authMiddleware)

router.get('/:trabajoId/mensajes', async (req, res) => {
  try {
    const trabajo = await db.getTrabajo(parseInt(req.params.trabajoId))
    if (!trabajo || trabajo.tecnico_id !== req.tecnico.id)
      return res.status(403).json({ error: 'No autorizado' })
    await db.marcarLeidos(trabajo.id)
    const mensajes = await db.getMensajes(trabajo.id)
    res.json({ mensajes })
  } catch (err) { console.error(err); res.status(500).json({ error: 'Error interno' }) }
})

router.post('/:trabajoId/mensajes', async (req, res) => {
  try {
    const trabajo = await db.getTrabajo(parseInt(req.params.trabajoId))
    if (!trabajo || trabajo.tecnico_id !== req.tecnico.id)
      return res.status(403).json({ error: 'No autorizado' })
    const contenido = sanitizarMensaje(req.body.contenido)
    const msg = await db.createMensaje(trabajo.id, 'tecnico', contenido)
    await enviarMensajeWA(trabajo.cliente_wa, contenido)
    res.json({ mensaje: msg })
  } catch (err) { console.error(err); res.status(500).json({ error: 'Error interno' }) }
})

router.get('/resumen', async (req, res) => {
  try {
    const trabajos = await db.getMisTrabajos(req.tecnico.id)
    const resumen = await Promise.all(trabajos.map(async t => ({
      ...t,
      no_leidos: await db.countNoLeidos(t.id)
    })))
    res.json({ trabajos: resumen })
  } catch (err) { console.error(err); res.status(500).json({ error: 'Error interno' }) }
})

export default router
