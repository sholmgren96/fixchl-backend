import { Router } from 'express'
import bcrypt from 'bcryptjs'
import { db } from '../db/database.js'
import { signToken } from '../middleware/auth.js'

const router = Router()

function validarRut(rut) {
  const limpio = String(rut).replace(/[\.\-\s]/g, '').toUpperCase()
  if (limpio.length < 2) return false
  const cuerpo = limpio.slice(0, -1)
  const dv     = limpio.slice(-1)
  if (!/^\d+$/.test(cuerpo)) return false

  let suma = 0, mul = 2
  for (let i = cuerpo.length - 1; i >= 0; i--) {
    suma += parseInt(cuerpo[i]) * mul
    mul = mul === 7 ? 2 : mul + 1
  }
  const resto = 11 - (suma % 11)
  const dvEsperado = resto === 11 ? '0' : resto === 10 ? 'K' : String(resto)
  return dv === dvEsperado
}

router.post('/registro', async (req, res) => {
  try {
    const { nombre, rut, telefono, password, categoria, categorias, comunas } = req.body
    if (!nombre || !rut || !telefono || !password)
      return res.status(400).json({ error: 'Faltan campos obligatorios' })

    if (!validarRut(rut))
      return res.status(400).json({ error: 'RUT inválido' })

    const todasCategorias = categorias?.length ? categorias : (categoria ? [categoria] : [])
    if (!todasCategorias.length)
      return res.status(400).json({ error: 'Selecciona al menos una categoría' })
    if (!comunas?.length)
      return res.status(400).json({ error: 'Selecciona al menos una comuna' })

    const existe = await db.getTecnicoByRutOrTelefono(rut, telefono)
    if (existe) return res.status(409).json({ error: 'Ya existe un técnico con ese RUT o teléfono' })

    const hash = await bcrypt.hash(password, 10)
    const tecnico = await db.createTecnico({ nombre, rut, telefono, password: hash })

    for (const c of todasCategorias) { try { await db.addCategoria(tecnico.id, c) } catch {} }
    for (const c of comunas) { try { await db.addComuna(tecnico.id, c) } catch {} }

    const token = signToken({ id: tecnico.id, nombre, telefono })
    res.status(201).json({ token, tecnico: { id: tecnico.id, nombre, rut, telefono } })
  } catch (err) { console.error(err); res.status(500).json({ error: 'Error interno' }) }
})

router.post('/login', async (req, res) => {
  try {
    const { telefono, password } = req.body
    if (!telefono || !password) return res.status(400).json({ error: 'Teléfono y contraseña requeridos' })

    const tecnico = await db.getTecnicoByTelefono(telefono)
    if (!tecnico) return res.status(401).json({ error: 'Credenciales incorrectas' })

    const ok = await bcrypt.compare(password, tecnico.password)
    if (!ok) return res.status(401).json({ error: 'Credenciales incorrectas' })

    const token = signToken({ id: tecnico.id, nombre: tecnico.nombre, telefono: tecnico.telefono })
    res.json({ token, tecnico: { id: tecnico.id, nombre: tecnico.nombre, telefono: tecnico.telefono, rating: tecnico.rating } })
  } catch (err) { console.error(err); res.status(500).json({ error: 'Error interno' }) }
})

export default router
