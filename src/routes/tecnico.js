import { Router } from 'express'
import { db } from '../db/database.js'
import { authMiddleware } from '../middleware/auth.js'

const router = Router()
router.use(authMiddleware)

router.get('/perfil', async (req, res) => {
  try {
    const tecnico = await db.getTecnico(req.tecnico.id)
    if (!tecnico) return res.status(404).json({ error: 'No encontrado' })
    const comunas   = await db.getComunas(tecnico.id)
    const categorias = await db.getCategorias(tecnico.id)
    const { password, ...rest } = tecnico
    res.json({ ...rest, comunas, categorias })
  } catch (err) { console.error(err); res.status(500).json({ error: 'Error interno' }) }
})

router.patch('/disponible', async (req, res) => {
  try {
    await db.updateTecnicoDisponible(req.tecnico.id, req.body.disponible)
    res.json({ ok: true })
  } catch (err) { console.error(err); res.status(500).json({ error: 'Error interno' }) }
})

router.post('/comunas', async (req, res) => {
  try {
    await db.addComuna(req.tecnico.id, req.body.comuna)
    res.json({ ok: true })
  } catch (err) { res.status(400).json({ error: err.message }) }
})

router.delete('/comunas/:comuna', async (req, res) => {
  try {
    await db.deleteComuna(req.tecnico.id, req.params.comuna)
    res.json({ ok: true })
  } catch (err) { res.status(500).json({ error: 'Error interno' }) }
})

router.post('/categorias', async (req, res) => {
  try {
    await db.addCategoria(req.tecnico.id, req.body.categoria)
    res.json({ ok: true })
  } catch (err) { res.status(400).json({ error: err.message }) }
})

router.delete('/categorias/:categoria', async (req, res) => {
  try {
    await db.deleteCategoria(req.tecnico.id, req.params.categoria)
    res.json({ ok: true })
  } catch (err) { res.status(500).json({ error: 'Error interno' }) }
})

router.get('/rendimiento', async (req, res) => {
  try {
    const tecnico = await db.getTecnico(req.tecnico.id)
    const calificaciones = await db.getCalificacionesTecnico(req.tecnico.id)
    res.json({ rating: tecnico.rating, total_reviews: tecnico.total_reviews, total_jobs: tecnico.total_jobs, calificaciones })
  } catch (err) { console.error(err); res.status(500).json({ error: 'Error interno' }) }
})

export default router
