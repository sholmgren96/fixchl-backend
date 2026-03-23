import { Router } from 'express'
import { db } from '../db/database.js'
import { authMiddleware } from '../middleware/auth.js'

const router = Router()
router.use(authMiddleware)

// GET /api/disponibilidad — obtiene disponibilidad del técnico
router.get('/', (req, res) => {
  const slots = db.getDisponibilidadTecnico(req.tecnico.id)
  res.json({ slots })
})

// POST /api/disponibilidad — guarda bloques de disponibilidad semanal
// Body: { bloques: [{fecha, hora_inicio, hora_fin}] }
router.post('/', (req, res) => {
  const { bloques } = req.body
  if (!Array.isArray(bloques)) return res.status(400).json({ error: 'bloques debe ser un array' })

  // Validar cada bloque
  for (const b of bloques) {
    if (!b.fecha || !b.hora_inicio || !b.hora_fin) {
      return res.status(400).json({ error: 'Cada bloque necesita fecha, hora_inicio y hora_fin' })
    }
  }

  db.setDisponibilidadSemana(req.tecnico.id, bloques)
  res.json({ ok: true, bloques: bloques.length })
})

// DELETE /api/disponibilidad/:fecha/:hora — elimina un slot específico
router.delete('/:fecha/:hora', (req, res) => {
  const data = db.getDisponibilidadTecnico(req.tecnico.id)
  // Por simplicidad, re-guardamos sin ese slot
  const nuevos = data.filter(d => !(d.fecha === req.params.fecha && d.hora_inicio === req.params.hora))
  db.setDisponibilidadSemana(req.tecnico.id, nuevos)
  res.json({ ok: true })
})

export default router
