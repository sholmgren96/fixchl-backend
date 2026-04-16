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

// Verificar técnico en SEC (solo Electricista / Gasfiter)
router.get('/tecnicos/:id/verificar-sec', async (req, res) => {
  try {
    const tecnico = await db.getTecnico(req.params.id)
    if (!tecnico) return res.status(404).json({ error: 'Técnico no encontrado' })

    const categorias = await db.getCategorias(tecnico.id)
    const cats = categorias.map(c => c.categoria)

    const esElectrico = cats.includes('Electricista')
    const esGas       = cats.includes('Gasfiter')

    if (!esElectrico && !esGas) {
      return res.json({ aplica: false, mensaje: 'Categoría no certificada por SEC' })
    }

    const tipo      = esElectrico ? 'ELECTRICO' : 'GAS'
    const resultado = await consultarSEC(tecnico.rut, tipo)

    await db.setSECEstado(tecnico.id, resultado.estado)
    res.json({ aplica: true, ...resultado })
  } catch (err) {
    console.error('verificar-sec:', err)
    res.status(500).json({ error: 'Error al consultar SEC' })
  }
})

async function consultarSEC(rut, tipo) {
  // Normalizar RUT: quitar puntos, mayúscula en K, mantener guión
  const rutNorm = rut.replace(/\./g, '').toUpperCase()

  const CATEGORIAS_SEC = {
    ELECTRICO: ['ELECTRICO', 'ELÉCTRICO', 'E'],
    GAS:       ['GAS', 'G'],
  }

  // Intentamos distintos nombres de campo que usa Struts en el SEC
  const variantes = [
    { tipoServicio: tipo, rut: rutNorm, apellidoPaterno: '', apellidoMaterno: '' },
    { tipoInstalador: tipo, rut: rutNorm, apellidoPaterno: '', apellidoMaterno: '' },
    { tipo, rut: rutNorm, apellidoPaterno: '', apellidoMaterno: '' },
  ]

  for (const campos of variantes) {
    try {
      const body = new URLSearchParams(campos)
      const resp = await fetch(
        'https://wlhttp.sec.cl/validadorInstaladores/sec/consulta.do',
        {
          method:  'POST',
          headers: {
            'Content-Type': 'application/x-www-form-urlencoded',
            'User-Agent':   'Mozilla/5.0',
            'Referer':      'https://wlhttp.sec.cl/validadorInstaladores/sec/consulta.do',
          },
          body:   body.toString(),
          signal: AbortSignal.timeout(12000),
        }
      )

      const html = await resp.text()

      // Detectar errores de Struts (action mapping no encontrado)
      if (html.includes('There is no Action mapped') || html.includes('Error 404')) continue

      const htmlUp = html.toUpperCase()

      if (htmlUp.includes('VIGENTE'))
        return { estado: 'vigente',        detalle: 'Instalador registrado y vigente en SEC' }
      if (htmlUp.includes('CADUCADO') || htmlUp.includes('VENCIDO') || htmlUp.includes('EXPIRADO'))
        return { estado: 'caducado',       detalle: 'Licencia SEC caducada' }
      if (
        htmlUp.includes('NO SE ENCONTRARON') ||
        htmlUp.includes('NO EXISTEN RESULTADOS') ||
        htmlUp.includes('NO ENCONTRADO')
      )
        return { estado: 'no_registrado',  detalle: 'RUT no encontrado en registro SEC' }

    } catch (err) {
      // timeout u otro error de red — continuar con siguiente variante
      console.warn('SEC variante falló:', err.message)
    }
  }

  return { estado: 'error', detalle: 'No se pudo obtener respuesta del SEC' }
}

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
