import { Router } from 'express'
import bcrypt from 'bcryptjs'
import { db } from '../db/database.js'
import { signToken } from '../middleware/auth.js'

const router = Router()

router.post('/registro', async (req, res) => {
  try {
    const { nombre, rut, telefono, password, categoria, categorias, comunas } = req.body
    if (!nombre || !rut || !telefono || !password)
      return res.status(400).json({ error: 'Faltan campos obligatorios' })

    const todasCategorias = categorias?.length ? categorias : (categoria ? [categoria] : [])
    if (todasCategorias.length === 0)
      return res.status(400).json({ error: 'Selecciona al menos una categoría' })

    if (!comunas?.length)
      return res.status(400).json({ error: 'Selecciona al menos una comuna' })

    if (db.getTecnicoByRutOrTelefono(rut, telefono))
      return res.status(409).json({ error: 'Ya existe un técnico con ese RUT o teléfono' })

    const hash = await bcrypt.hash(password, 10)
    const tecnico = db.createTecnico({ nombre, rut, telefono, password: hash })

    todasCategorias.forEach(c => { try { db.addCategoria(tecnico.id, c) } catch {} })
    comunas.forEach(c => { try { db.addComuna(tecnico.id, c) } catch {} })

    const token = signToken({ id: tecnico.id, nombre, telefono })
    res.status(201).json({ token, tecnico: { id: tecnico.id, nombre, rut, telefono } })
  } catch (err) { console.error(err); res.status(500).json({ error: 'Error interno' }) }
})

router.post('/login', async (req, res) => {
  try {
    const { telefono, password } = req.body
    if (!telefono || !password) return res.status(400).json({ error: 'Teléfono y contraseña requeridos' })

    const tecnico = db.getTecnicoByTelefono(telefono)
    if (!tecnico) return res.status(401).json({ error: 'Credenciales incorrectas' })

    const ok = await bcrypt.compare(password, tecnico.password)
    if (!ok) return res.status(401).json({ error: 'Credenciales incorrectas' })

    const token = signToken({ id: tecnico.id, nombre: tecnico.nombre, telefono: tecnico.telefono })
    res.json({ token, tecnico: { id: tecnico.id, nombre: tecnico.nombre, telefono: tecnico.telefono, rating: tecnico.rating } })
  } catch (err) { console.error(err); res.status(500).json({ error: 'Error interno' }) }
})

export default router
