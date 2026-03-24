import { Router } from 'express'
import { db } from '../db/database.js'
import { authMiddleware } from '../middleware/auth.js'

const router = Router()
router.use(authMiddleware)

router.get('/', async (req, res) => {
  try {
    const comunas = await db.getComunas(req.tecnico.id)
    const disponibles = await db.getTrabajosdisponibles(comunas)
    const mios = await db.getMisTrabajos(req.tecnico.id)
    res.json({ disponibles, mios })
  } catch (err) { console.error(err); res.status(500).json({ error: 'Error interno' }) }
})

router.post('/:id/aceptar', async (req, res) => {
  try {
    const ok = await db.aceptarTrabajo(parseInt(req.params.id), req.tecnico.id)
    if (!ok) return res.status(400).json({ error: 'No se pudo aceptar el trabajo' })
    res.json({ ok: true })
  } catch (err) { console.error(err); res.status(500).json({ error: 'Error interno' }) }
})

router.post('/:id/completar', async (req, res) => {
  try {
    const ok = await db.completarTrabajo(parseInt(req.params.id), req.tecnico.id)
    if (!ok) return res.status(400).json({ error: 'No se pudo completar el trabajo' })
    res.json({ ok: true })
  } catch (err) { console.error(err); res.status(500).json({ error: 'Error interno' }) }
})

export default router
