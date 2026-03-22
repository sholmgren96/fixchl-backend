import { Router } from 'express'
import { db } from '../db/database.js'
import { authMiddleware } from '../middleware/auth.js'
import { enviarMensajeWA } from '../services/whatsapp.js'

const router = Router()
router.use(authMiddleware)

router.get('/', (req, res) => {
  const trabajos = db.getMisTrabajos(req.tecnico.id).map(t => ({
    ...t,
    ultimo_msg: db.getMensajes(t.id).slice(-1)[0]?.contenido || '',
    no_leidos: db.countNoLeidos(t.id)
  }))
  res.json({ chats: trabajos })
})

router.get('/:trabajoId/mensajes', (req, res) => {
  const trabajoId = parseInt(req.params.trabajoId)
  const trabajo = db.getTrabajo(trabajoId)
  if (!trabajo || trabajo.tecnico_id !== req.tecnico.id)
    return res.status(403).json({ error: 'Sin acceso a este chat' })

  const mensajes = db.getMensajes(trabajoId)
  db.marcarLeidos(trabajoId)
  res.json({ mensajes, trabajo })
})

router.post('/:trabajoId/enviar', (req, res) => {
  const { contenido } = req.body
  if (!contenido?.trim()) return res.status(400).json({ error: 'Mensaje vacío' })

  const trabajoId = parseInt(req.params.trabajoId)
  const trabajo = db.getTrabajo(trabajoId)
  if (!trabajo || trabajo.tecnico_id !== req.tecnico.id || trabajo.estado !== 'activo')
    return res.status(403).json({ error: 'Chat no disponible' })

  const tecnico = db.getTecnico(req.tecnico.id)
  const msg = db.createMensaje(trabajoId, 'tecnico', contenido.trim())
  enviarMensajeWA(trabajo.cliente_wa, `${tecnico.nombre}: ${contenido.trim()}`)
  res.json(msg)
})

export default router
