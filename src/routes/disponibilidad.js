import { Router } from 'express'
import { db } from '../db/database.js'
import { authMiddleware } from '../middleware/auth.js'

const router = Router()
router.use(authMiddleware)

router.get('/', async (req, res) => {
  try {
    const slots          = await db.getDisponibilidadTecnico(req.tecnico.id)
    const bloques_ocupados = await db.getBloquesOcupados(req.tecnico.id)
    res.json({ slots, bloques_ocupados })
  } catch (err) { console.error(err); res.status(500).json({ error: 'Error interno' }) }
})

// Guardar disponibilidad por fecha individual (horas seleccionadas)
router.post('/fecha', async (req, res) => {
  try {
    const { fecha, horas } = req.body
    if (!fecha || !Array.isArray(horas)) return res.status(400).json({ error: 'fecha y horas requeridos' })
    await db.setDisponibilidadFecha(req.tecnico.id, fecha, horas)
    res.json({ ok: true })
  } catch (err) { console.error(err); res.status(500).json({ error: 'Error interno' }) }
})

// Mantener endpoint original para compatibilidad
router.post('/', async (req, res) => {
  try {
    const { bloques } = req.body
    if (!Array.isArray(bloques)) return res.status(400).json({ error: 'bloques debe ser un array' })
    await db.setDisponibilidadSemana(req.tecnico.id, bloques)
    res.json({ ok: true, bloques: bloques.length })
  } catch (err) { console.error(err); res.status(500).json({ error: 'Error interno' }) }
})

export default router
