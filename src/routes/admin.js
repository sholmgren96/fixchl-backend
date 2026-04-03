import { Router } from 'express'
import bcrypt from 'bcryptjs'
import { db } from '../db/database.js'
import { adminAuthMiddleware, signToken } from '../middleware/auth.js'

const router = Router()

// ── Login (público) ───────────────────────────────────────────────────────────
router.post('/auth/login', async (req, res) => {
  try {
    const { email, password } = req.body
    if (!email || !password) return res.status(400).json({ error: 'Email y contraseña requeridos' })

    const admin = await db.getAdminByEmail(email)
    if (!admin) return res.status(401).json({ error: 'Credenciales incorrectas' })

    const ok = await bcrypt.compare(password, admin.password)
    if (!ok) return res.status(401).json({ error: 'Credenciales incorrectas' })

    const token = signToken({ id: admin.id, nombre: admin.nombre, email: admin.email, role: 'admin' })
    res.json({ token, admin: { id: admin.id, nombre: admin.nombre, email: admin.email } })
  } catch (err) { console.error(err); res.status(500).json({ error: 'Error interno' }) }
})

// ── Rutas protegidas ──────────────────────────────────────────────────────────
router.use(adminAuthMiddleware)

// Técnicos pendientes de verificación
router.get('/tecnicos/pendientes', async (req, res) => {
  try {
    const tecnicos = await db.getPendientes()
    res.json({ tecnicos })
  } catch (err) { console.error(err); res.status(500).json({ error: 'Error interno' }) }
})

// Todos los técnicos
router.get('/tecnicos', async (req, res) => {
  try {
    const tecnicos = await db.getTodosLosTecnicos()
    res.json({ tecnicos })
  } catch (err) { console.error(err); res.status(500).json({ error: 'Error interno' }) }
})

// Ver cédula de un técnico
router.get('/tecnicos/:id/cedula', async (req, res) => {
  try {
    const foto = await db.getCedulaFoto(req.params.id)
    if (!foto) return res.status(404).json({ error: 'Sin foto' })
    res.json({ cedula_foto: foto })
  } catch (err) { console.error(err); res.status(500).json({ error: 'Error interno' }) }
})

// Aprobar técnico
router.post('/tecnicos/:id/aprobar', async (req, res) => {
  try {
    await db.aprobarTecnico(req.params.id)
    res.json({ ok: true })
  } catch (err) { console.error(err); res.status(500).json({ error: 'Error interno' }) }
})

// Rechazar técnico
router.post('/tecnicos/:id/rechazar', async (req, res) => {
  try {
    const { razon } = req.body
    await db.rechazarTecnico(req.params.id, razon)
    res.json({ ok: true })
  } catch (err) { console.error(err); res.status(500).json({ error: 'Error interno' }) }
})

// Suspender técnico activo
router.post('/tecnicos/:id/suspender', async (req, res) => {
  try {
    await db.suspenderTecnico(req.params.id)
    res.json({ ok: true })
  } catch (err) { console.error(err); res.status(500).json({ error: 'Error interno' }) }
})

// Reactivar técnico suspendido
router.post('/tecnicos/:id/reactivar', async (req, res) => {
  try {
    await db.reactivarTecnico(req.params.id)
    res.json({ ok: true })
  } catch (err) { console.error(err); res.status(500).json({ error: 'Error interno' }) }
})

export default router
