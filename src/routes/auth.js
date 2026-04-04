import { Router } from 'express'
import bcrypt from 'bcryptjs'
import { db } from '../db/database.js'
import { signToken } from '../middleware/auth.js'
import { enviarMensajeWA } from '../services/whatsapp.js'

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

function generarCodigo() {
  return String(Math.floor(100000 + Math.random() * 900000))
}

// ── Enviar OTP por WhatsApp ───────────────────────────────────────────────────
router.post('/otp/enviar', async (req, res) => {
  try {
    const { telefono } = req.body
    if (!telefono) return res.status(400).json({ error: 'Teléfono requerido' })

    const reciente = await db.otpEnviadoReciente(telefono)
    if (reciente) return res.status(429).json({ error: 'Espera un momento antes de pedir otro código' })

    const codigo = generarCodigo()
    await db.crearOtp(telefono, codigo)

    await enviarMensajeWA(
      telefono,
      `Tu código de verificación TecnicosYa es: *${codigo}*\n\nVálido por 10 minutos. No lo compartas con nadie.`
    )

    res.json({ ok: true })
  } catch (err) { console.error(err); res.status(500).json({ error: 'Error interno' }) }
})

// ── Verificar OTP ─────────────────────────────────────────────────────────────
router.post('/otp/verificar', async (req, res) => {
  try {
    const { telefono, codigo } = req.body
    if (!telefono || !codigo) return res.status(400).json({ error: 'Teléfono y código requeridos' })

    const ok = await db.verificarOtp(telefono, codigo)
    if (!ok) return res.status(400).json({ error: 'Código incorrecto o expirado' })

    res.json({ ok: true })
  } catch (err) { console.error(err); res.status(500).json({ error: 'Error interno' }) }
})

// ── Registro ──────────────────────────────────────────────────────────────────
router.post('/registro', async (req, res) => {
  try {
    const { nombre, rut, telefono, password, categoria, categorias, comunas, cedula_foto } = req.body
    if (!nombre || !rut || !telefono || !password)
      return res.status(400).json({ error: 'Faltan campos obligatorios' })

    if (!validarRut(rut))
      return res.status(400).json({ error: 'RUT inválido' })

    if (!cedula_foto)
      return res.status(400).json({ error: 'Debes subir una foto de tu cédula de identidad' })

    const telefonoVerificado = await db.telefonoVerificadoReciente(telefono)
    if (!telefonoVerificado)
      return res.status(400).json({ error: 'Debes verificar tu número de teléfono primero' })

    const todasCategorias = categorias?.length ? categorias : (categoria ? [categoria] : [])
    if (!todasCategorias.length)
      return res.status(400).json({ error: 'Selecciona al menos una categoría' })
    if (!comunas?.length)
      return res.status(400).json({ error: 'Selecciona al menos una comuna' })

    const existe = await db.getTecnicoByRutOrTelefono(rut, telefono)
    if (existe) return res.status(409).json({ error: 'Ya existe un técnico con ese RUT o teléfono' })

    const hash = await bcrypt.hash(password, 10)
    const tecnico = await db.createTecnico({ nombre, rut, telefono, password: hash, cedula_foto })

    for (const c of todasCategorias) { try { await db.addCategoria(tecnico.id, c) } catch {} }
    for (const c of comunas) { try { await db.addComuna(tecnico.id, c) } catch {} }

    const token = signToken({ id: tecnico.id, nombre, telefono })
    res.status(201).json({ token, tecnico: { id: tecnico.id, nombre, rut, telefono } })
  } catch (err) { console.error(err); res.status(500).json({ error: 'Error interno' }) }
})

// ── Login ─────────────────────────────────────────────────────────────────────
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
