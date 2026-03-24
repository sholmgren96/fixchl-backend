import { Router } from 'express'
import { db } from '../db/database.js'
import { authMiddleware } from '../middleware/auth.js'

const router = Router()
router.use(authMiddleware)

router.get('/', async (req, res) => {
  try {
    const slots = await db.getDisponibilidadTecnico(req.tecnico.id)
    res.json({ slots })
  } catch (err) { console.error(err); res.status(500).json({ error: 'Error interno' }) }
})

router.post('/', async (req, res) => {
  try {
    const { bloques } = req.body
    if (!Array.isArray(bloques)) return res.status(400).json({ error: 'bloques debe ser un array' })
    await db.setDisponibilidadSemana(req.tecnico.id, bloques)
    res.json({ ok: true, bloques: bloques.length })
  } catch (err) { console.error(err); res.status(500).json({ error: 'Error interno' }) }
})

export default router
