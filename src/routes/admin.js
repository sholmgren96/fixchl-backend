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

// Dashboard — estadísticas generales
router.get('/stats', async (req, res) => {
  try {
    const stats = await db.getStatsAdmin()
    res.json(stats)
  } catch (err) { console.error(err); res.status(500).json({ error: 'Error interno' }) }
})

// Lista de trabajos con filtros
router.get('/trabajos', async (req, res) => {
  try {
    const { estado, categoria, desde, hasta, limit, offset } = req.query
    const data = await db.getTrabajosAdmin({ estado, categoria, desde, hasta,
      limit: limit ? parseInt(limit) : 50,
      offset: offset ? parseInt(offset) : 0,
    })
    res.json(data)
  } catch (err) { console.error(err); res.status(500).json({ error: 'Error interno' }) }
})

// Detalle de trabajo con mensajes
router.get('/trabajos/:id', async (req, res) => {
  try {
    const data = await db.getTrabajoConMensajes(req.params.id)
    if (!data) return res.status(404).json({ error: 'No encontrado' })
    res.json(data)
  } catch (err) { console.error(err); res.status(500).json({ error: 'Error interno' }) }
})

// Lista de reportes con filtro opcional por estado
router.get('/reportes', async (req, res) => {
  try {
    const { estado, limit, offset } = req.query
    const data = await db.getReportesAdmin({
      estado,
      limit:  limit  ? parseInt(limit)  : 50,
      offset: offset ? parseInt(offset) : 0,
    })
    res.json(data)
  } catch (err) { console.error(err); res.status(500).json({ error: 'Error interno' }) }
})

// Actualizar estado de un reporte
router.patch('/reportes/:id/estado', async (req, res) => {
  try {
    const { estado } = req.body
    if (!['pendiente', 'revisado', 'resuelto'].includes(estado))
      return res.status(400).json({ error: 'Estado inválido' })
    await db.updateReporteEstado(req.params.id, estado)
    res.json({ ok: true })
  } catch (err) { console.error(err); res.status(500).json({ error: 'Error interno' }) }
})

export default router
