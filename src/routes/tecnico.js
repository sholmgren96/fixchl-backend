import { Router } from 'express'
import { db } from '../db/database.js'
import { authMiddleware } from '../middleware/auth.js'

const router = Router()
router.use(authMiddleware)

router.get('/perfil', (req, res) => {
  const tecnico = db.getTecnico(req.tecnico.id)
  if (!tecnico) return res.status(404).json({ error: 'No encontrado' })
  const { password, ...datos } = tecnico
  res.json({ ...datos, comunas: db.getComunas(req.tecnico.id), categorias: db.getCategorias(req.tecnico.id) })
})

router.patch('/disponible', (req, res) => {
  const { disponible } = req.body
  if (typeof disponible !== 'boolean') return res.status(400).json({ error: 'disponible debe ser true o false' })
  db.updateTecnicoDisponible(req.tecnico.id, disponible)
  res.json({ disponible })
})

router.get('/comunas', (req, res) => res.json({ comunas: db.getComunas(req.tecnico.id) }))

router.post('/comunas', (req, res) => {
  const { comuna } = req.body
  if (!comuna) return res.status(400).json({ error: 'comuna requerida' })
  try { db.addComuna(req.tecnico.id, comuna); res.status(201).json({ comuna }) }
  catch { res.status(409).json({ error: 'Ya tienes esa comuna' }) }
})

router.delete('/comunas/:comuna', (req, res) => {
  db.deleteComuna(req.tecnico.id, req.params.comuna)
  res.json({ eliminada: req.params.comuna })
})

router.post('/categorias', (req, res) => {
  const { categoria } = req.body
  if (!categoria) return res.status(400).json({ error: 'categoria requerida' })
  try { db.addCategoria(req.tecnico.id, categoria); res.status(201).json({ categoria }) }
  catch { res.status(409).json({ error: 'Ya tienes esa categoría' }) }
})

router.delete('/categorias/:cat', (req, res) => {
  db.deleteCategoria(req.tecnico.id, req.params.cat)
  res.json({ eliminada: req.params.cat })
})

router.get('/estadisticas', (req, res) => {
  const tecnico = db.getTecnico(req.tecnico.id)
  const calificaciones = db.getCalificacionesTecnico(req.tecnico.id)
  res.json({ rating: tecnico.rating, total_jobs: tecnico.total_jobs, total_reviews: tecnico.total_reviews, calificaciones })
})

export default router
