import { Router } from 'express'
import { db } from '../db/database.js'
import { authMiddleware } from '../middleware/auth.js'
import { enviarMensajeWA } from '../services/whatsapp.js'

const router = Router()
router.use(authMiddleware)

router.get('/disponibles', (req, res) => {
  const comunas = db.getComunas(req.tecnico.id)
  if (!comunas.length) return res.json({ trabajos: [] })
  res.json({ trabajos: db.getTrabajosdisponibles(comunas) })
})

router.get('/mis-trabajos', (req, res) => {
  res.json({ trabajos: db.getMisTrabajos(req.tecnico.id) })
})

router.post('/:id/aceptar', (req, res) => {
  const id = parseInt(req.params.id)
  const ok = db.aceptarTrabajo(id, req.tecnico.id)
  if (!ok) return res.status(404).json({ error: 'Trabajo no disponible o ya tomado' })

  const trabajo = db.getTrabajo(id)
  const tecnico = db.getTecnico(req.tecnico.id)
  const msg = `¡Hola ${trabajo.cliente_nombre}! 🙌\n${tecnico.nombre} aceptó tu solicitud de ${trabajo.categoria} en ${trabajo.comuna}.\nYa puedes escribirle directamente aquí.`
  enviarMensajeWA(trabajo.cliente_wa, msg)
  db.createMensaje(id, 'sistema', `${tecnico.nombre} aceptó el trabajo. Chat abierto.`)

  res.json({ ok: true, trabajo_id: id })
})

router.post('/:id/rechazar', (req, res) => res.json({ ok: true }))

router.post('/:id/completar', (req, res) => {
  const id = parseInt(req.params.id)
  const ok = db.completarTrabajo(id, req.tecnico.id)
  if (!ok) return res.status(404).json({ error: 'Trabajo no encontrado o no activo' })

  const trabajo = db.getTrabajo(id)
  const msg = `Hola ${trabajo.cliente_nombre}, ¿cómo resultó el trabajo? ¿Lo recomendarías?\n\n*1* Muy malo\n*2* Malo\n*3* Regular\n*4* Bueno\n*5* Excelente`
  enviarMensajeWA(trabajo.cliente_wa, msg)
  res.json({ ok: true })
})

export default router
