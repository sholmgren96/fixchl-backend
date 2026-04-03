import jwt from 'jsonwebtoken'
import { JWT_SECRET } from '../config.js'

export function authMiddleware(req, res, next) {
  const header = req.headers.authorization
  if (!header || !header.startsWith('Bearer ')) {
    return res.status(401).json({ error: 'Token requerido' })
  }
  const token = header.split(' ')[1]
  try {
    req.tecnico = jwt.verify(token, JWT_SECRET)
    next()
  } catch {
    res.status(401).json({ error: 'Token inválido o expirado' })
  }
}

export function adminAuthMiddleware(req, res, next) {
  const header = req.headers.authorization
  if (!header || !header.startsWith('Bearer ')) {
    return res.status(401).json({ error: 'Token requerido' })
  }
  const token = header.split(' ')[1]
  try {
    const payload = jwt.verify(token, JWT_SECRET)
    if (payload.role !== 'admin') return res.status(403).json({ error: 'No autorizado' })
    req.admin = payload
    next()
  } catch {
    res.status(401).json({ error: 'Token inválido o expirado' })
  }
}

export function signToken(payload) {
  return jwt.sign(payload, JWT_SECRET, { expiresIn: '30d' })
}
