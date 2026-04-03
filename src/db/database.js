import dns from 'dns'
dns.setDefaultResultOrder('ipv4first')
import pg from 'pg'

const { Pool } = pg

const dbUrl = process.env.DATABASE_URL
console.log('DB_URL presente:', !!dbUrl, dbUrl ? dbUrl.substring(0,40) : 'VACIA')
if (!dbUrl) { console.error('ERROR: DATABASE_URL no definida'); process.exit(1) }

const pool = new Pool({
  connectionString: dbUrl,
  ssl: { rejectUnauthorized: false },
})

export async function query(sql, params = []) {
  const client = await pool.connect()
  try {
    const res = await client.query(sql, params)
    return res
  } finally {
    client.release()
  }
}

const DURACION = {
  'Gasfiter': 2, 'Electricista': 2, 'Pintor': 4,
  'Servicio de aseo': 3, 'Maestro general': 3, 'Otro': 2,
}

function horasARangos(horas) {
  if (!horas.length) return []
  const sorted = [...horas].map(h => parseInt(h)).sort((a, b) => a - b)
  const rangos = []
  let inicio = sorted[0]
  let prev   = sorted[0]
  for (let i = 1; i < sorted.length; i++) {
    if (sorted[i] === prev + 1) { prev = sorted[i] }
    else {
      rangos.push({ hora_inicio: `${String(inicio).padStart(2,'0')}:00`, hora_fin: `${String(prev + 1).padStart(2,'0')}:00` })
      inicio = sorted[i]; prev = sorted[i]
    }
  }
  rangos.push({ hora_inicio: `${String(inicio).padStart(2,'0')}:00`, hora_fin: `${String(prev + 1).padStart(2,'0')}:00` })
  return rangos
}

function formatFecha(fecha) {
  const d = new Date(fecha + 'T12:00:00')
  const dias = ['Dom','Lun','Mar','Mié','Jue','Vie','Sáb']
  const meses = ['ene','feb','mar','abr','may','jun','jul','ago','sep','oct','nov','dic']
  return `${dias[d.getDay()]} ${d.getDate()} ${meses[d.getMonth()]}`
}

export const db = {

  // ── OTP ────────────────────────────────────────────────────────────────────
  async crearOtp(telefono, codigo) {
    const expires = new Date(Date.now() + 10 * 60 * 1000) // 10 minutos
    await query('DELETE FROM otp_verificaciones WHERE telefono=$1', [telefono])
    const r = await query(
      'INSERT INTO otp_verificaciones (telefono, codigo, expires_at) VALUES ($1,$2,$3) RETURNING id',
      [telefono, codigo, expires]
    )
    return r.rows[0].id
  },

  async otpEnviadoReciente(telefono) {
    const r = await query(
      "SELECT id FROM otp_verificaciones WHERE telefono=$1 AND created_at > NOW() - INTERVAL '60 seconds'",
      [telefono]
    )
    return r.rows.length > 0
  },

  async verificarOtp(telefono, codigo) {
    const r = await query(
      "SELECT id FROM otp_verificaciones WHERE telefono=$1 AND codigo=$2 AND expires_at > NOW() AND verificado=false",
      [telefono, codigo]
    )
    if (!r.rows[0]) return false
    await query(
      'UPDATE otp_verificaciones SET verificado=true, verificado_at=NOW() WHERE id=$1',
      [r.rows[0].id]
    )
    return true
  },

  async telefonoVerificadoReciente(telefono) {
    const r = await query(
      "SELECT id FROM otp_verificaciones WHERE telefono=$1 AND verificado=true AND verificado_at > NOW() - INTERVAL '15 minutes'",
      [telefono]
    )
    return r.rows.length > 0
  },

  // ── ADMINS ─────────────────────────────────────────────────────────────────
  async getAdminByEmail(email) {
    const r = await query('SELECT * FROM admins WHERE email=$1', [email])
    return r.rows[0] || null
  },

  async getTodosLosTecnicos() {
    const r = await query(
      `SELECT id, nombre, rut, telefono, estado, disponible, rating, total_jobs, total_reviews, razon_rechazo, created_at
       FROM tecnicos ORDER BY created_at DESC`
    )
    return r.rows
  },

  async suspenderTecnico(id) {
    await query("UPDATE tecnicos SET estado='suspendido' WHERE id=$1", [id])
  },

  async reactivarTecnico(id) {
    await query("UPDATE tecnicos SET estado='activo' WHERE id=$1", [id])
  },

  // ── TÉCNICOS ───────────────────────────────────────────────────────────────
  async getTecnico(id) {
    const r = await query('SELECT * FROM tecnicos WHERE id=$1', [id])
    return r.rows[0] || null
  },

  async getTecnicoByTelefono(tel) {
    const r = await query('SELECT * FROM tecnicos WHERE telefono=$1', [tel])
    return r.rows[0] || null
  },

  async getTecnicoByRutOrTelefono(rut, tel) {
    const r = await query('SELECT * FROM tecnicos WHERE rut=$1 OR telefono=$2', [rut, tel])
    return r.rows[0] || null
  },

  async createTecnico({ nombre, rut, telefono, password, cedula_foto }) {
    const r = await query(
      'INSERT INTO tecnicos (nombre,rut,telefono,password,cedula_foto,estado) VALUES ($1,$2,$3,$4,$5,$6) RETURNING *',
      [nombre, rut, telefono, password, cedula_foto, 'pendiente']
    )
    return r.rows[0]
  },

  async getPendientes() {
    const r = await query(
      `SELECT id, nombre, rut, telefono, estado, razon_rechazo, created_at
       FROM tecnicos WHERE estado='pendiente' ORDER BY created_at ASC`
    )
    return r.rows
  },

  async getCedulaFoto(id) {
    const r = await query('SELECT cedula_foto FROM tecnicos WHERE id=$1', [id])
    return r.rows[0]?.cedula_foto || null
  },

  async aprobarTecnico(id) {
    await query("UPDATE tecnicos SET estado='activo', razon_rechazo=NULL WHERE id=$1", [id])
  },

  async rechazarTecnico(id, razon) {
    await query("UPDATE tecnicos SET estado='rechazado', razon_rechazo=$2 WHERE id=$1", [id, razon || null])
  },

  async updateTecnicoDisponible(id, disponible) {
    await query('UPDATE tecnicos SET disponible=$1 WHERE id=$2', [disponible, id])
  },

  async updateTecnicoRating(id, rating, totalReviews) {
    await query('UPDATE tecnicos SET rating=$1, total_reviews=$2 WHERE id=$3', [rating, totalReviews, id])
  },

  // ── COMUNAS ────────────────────────────────────────────────────────────────
  async getComunas(id) {
    const r = await query('SELECT comuna FROM tecnico_comunas WHERE tecnico_id=$1', [id])
    return r.rows.map(r => r.comuna)
  },

  async addComuna(tecnicoId, comuna) {
    await query('INSERT INTO tecnico_comunas (tecnico_id,comuna) VALUES ($1,$2) ON CONFLICT DO NOTHING', [tecnicoId, comuna])
  },

  async deleteComuna(tecnicoId, comuna) {
    await query('DELETE FROM tecnico_comunas WHERE tecnico_id=$1 AND comuna=$2', [tecnicoId, comuna])
  },

  // ── CATEGORÍAS ─────────────────────────────────────────────────────────────
  async getCategorias(id) {
    const r = await query('SELECT categoria FROM tecnico_categorias WHERE tecnico_id=$1', [id])
    return r.rows.map(r => r.categoria)
  },

  async addCategoria(tecnicoId, categoria) {
    await query('INSERT INTO tecnico_categorias (tecnico_id,categoria) VALUES ($1,$2) ON CONFLICT DO NOTHING', [tecnicoId, categoria])
  },

  async deleteCategoria(tecnicoId, categoria) {
    await query('DELETE FROM tecnico_categorias WHERE tecnico_id=$1 AND categoria=$2', [tecnicoId, categoria])
  },

  // ── TRABAJOS ───────────────────────────────────────────────────────────────
  async getTrabajo(id) {
    const r = await query('SELECT * FROM trabajos WHERE id=$1', [id])
    return r.rows[0] || null
  },

  async createTrabajo({ cliente_nombre, cliente_wa, categoria, descripcion, comuna, urgencia, fecha_agendada=null, hora_agendada=null }) {
    const r = await query(
      `INSERT INTO trabajos (cliente_nombre,cliente_wa,categoria,descripcion,comuna,urgencia,fecha_agendada,hora_agendada)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8) RETURNING *`,
      [cliente_nombre, cliente_wa, categoria, descripcion, comuna, urgencia, fecha_agendada, hora_agendada]
    )
    return r.rows[0]
  },

  async getTrabajosdisponibles(comunas) {
    const r = await query(
      `SELECT * FROM trabajos WHERE estado='buscando' AND comuna=ANY($1) ORDER BY urgencia DESC, created_at DESC`,
      [comunas]
    )
    return r.rows
  },

  async getMisTrabajos(tecnicoId) {
    const r = await query(
      `SELECT * FROM trabajos WHERE tecnico_id=$1 AND estado IN ('activo','esperando_calificacion') ORDER BY accepted_at DESC`,
      [tecnicoId]
    )
    return r.rows
  },

  async aceptarTrabajo(id, tecnicoId, fecha = null, hora = null) {
    if (fecha && hora) {
      await query('UPDATE trabajos SET fecha_agendada=$1, hora_agendada=$2 WHERE id=$3', [fecha, hora, id])
    }
    const r = await query(
      `UPDATE trabajos SET estado='activo', tecnico_id=$1, accepted_at=NOW() WHERE id=$2 AND estado='buscando' RETURNING *`,
      [tecnicoId, id]
    )
    if (!r.rows[0]) return null
    const t = r.rows[0]
    if (t.fecha_agendada && t.hora_agendada) {
      const duracion = DURACION[t.categoria] || 2
      await this.bloquearHorario(tecnicoId, t.fecha_agendada, t.hora_agendada, duracion, id)
    }
    return t
  },

  async completarTrabajo(id, tecnicoId) {
    const r = await query(
      `UPDATE trabajos SET estado='esperando_calificacion', completed_at=NOW() WHERE id=$1 AND tecnico_id=$2 AND estado='activo' RETURNING id`,
      [id, tecnicoId]
    )
    return !!r.rows[0]
  },

  async updateTrabajoEstado(id, estado) {
    await query('UPDATE trabajos SET estado=$1 WHERE id=$2', [estado, id])
  },

  async updateTrabajoTecnico(id, tecnicoId) {
    await query('UPDATE trabajos SET tecnico_id=$1, accepted_at=NOW() WHERE id=$2', [tecnicoId, id])
  },

  // ── MENSAJES ───────────────────────────────────────────────────────────────
  async getMensajes(trabajoId) {
    const r = await query('SELECT * FROM mensajes WHERE trabajo_id=$1 ORDER BY created_at ASC', [trabajoId])
    return r.rows
  },

  async createMensaje(trabajoId, origen, contenido) {
    const r = await query(
      'INSERT INTO mensajes (trabajo_id,origen,contenido) VALUES ($1,$2,$3) RETURNING *',
      [trabajoId, origen, contenido]
    )
    return r.rows[0]
  },

  async marcarLeidos(trabajoId) {
    await query(`UPDATE mensajes SET leido=true WHERE trabajo_id=$1 AND origen='cliente' AND leido=false`, [trabajoId])
  },

  async countNoLeidos(trabajoId) {
    const r = await query(`SELECT COUNT(*) FROM mensajes WHERE trabajo_id=$1 AND origen='cliente' AND leido=false`, [trabajoId])
    return parseInt(r.rows[0].count)
  },

  // ── CALIFICACIONES ─────────────────────────────────────────────────────────
  async createCalificacion(trabajoId, tecnicoId, puntaje, comentario=null) {
    try {
      await query(
        'INSERT INTO calificaciones (trabajo_id,tecnico_id,puntaje,comentario) VALUES ($1,$2,$3,$4)',
        [trabajoId, tecnicoId, puntaje, comentario]
      )
      return true
    } catch { return false }
  },

  async getCalificacionesTecnico(tecnicoId) {
    const r = await query(
      `SELECT c.*, t.cliente_nombre, t.categoria, t.comuna FROM calificaciones c
       JOIN trabajos t ON t.id=c.trabajo_id WHERE c.tecnico_id=$1 ORDER BY c.created_at DESC LIMIT 20`,
      [tecnicoId]
    )
    return r.rows
  },

  async getRatingStats(tecnicoId) {
    const r = await query(
      'SELECT AVG(puntaje) as avg, COUNT(*) as total FROM calificaciones WHERE tecnico_id=$1',
      [tecnicoId]
    )
    return { avg: Math.round((r.rows[0].avg || 0) * 10) / 10, total: parseInt(r.rows[0].total) }
  },

  // ── SESIONES BOT ───────────────────────────────────────────────────────────
  async getSesion(wa) {
    const r = await query('SELECT * FROM sesiones_bot WHERE cliente_wa=$1', [wa])
    return r.rows[0] || null
  },

  async upsertSesion(clienteWa, estado, datos, trabajoId=null) {
    await query(
      `INSERT INTO sesiones_bot (cliente_wa,estado,datos_temp,trabajo_id,updated_at)
       VALUES ($1,$2,$3,$4,NOW())
       ON CONFLICT (cliente_wa) DO UPDATE SET
         estado=EXCLUDED.estado, datos_temp=EXCLUDED.datos_temp,
         trabajo_id=COALESCE(EXCLUDED.trabajo_id, sesiones_bot.trabajo_id),
         updated_at=NOW()`,
      [clienteWa, estado, JSON.stringify(datos), trabajoId]
    )
  },

  // ── MATCHING ───────────────────────────────────────────────────────────────
  async buscarTecnicos(categoria, comuna) {
    const r = await query(
      `SELECT t.id, t.nombre, t.rating, t.total_jobs FROM tecnicos t
       JOIN tecnico_categorias tc ON tc.tecnico_id=t.id AND tc.categoria=$1
       JOIN tecnico_comunas cm ON cm.tecnico_id=t.id AND cm.comuna=$2
       WHERE t.disponible=true AND t.estado='activo' ORDER BY t.rating DESC LIMIT 3`,
      [categoria, comuna]
    )
    return r.rows
  },

  // ── DISPONIBILIDAD ─────────────────────────────────────────────────────────
  async setDisponibilidadSemana(tecnicoId, bloques) {
    await query('DELETE FROM disponibilidad WHERE tecnico_id=$1 AND fecha>=CURRENT_DATE', [tecnicoId])
    for (const b of bloques) {
      await query(
        'INSERT INTO disponibilidad (tecnico_id,fecha,hora_inicio,hora_fin) VALUES ($1,$2,$3,$4)',
        [tecnicoId, b.fecha, b.hora_inicio, b.hora_fin]
      )
    }
  },

  async setDisponibilidadFecha(tecnicoId, fecha, horas) {
    await query('DELETE FROM disponibilidad WHERE tecnico_id=$1 AND fecha=$2', [tecnicoId, fecha])
    if (!horas.length) return
    const rangos = horasARangos(horas)
    for (const r of rangos) {
      await query(
        'INSERT INTO disponibilidad (tecnico_id, fecha, hora_inicio, hora_fin) VALUES ($1, $2, $3, $4)',
        [tecnicoId, fecha, r.hora_inicio, r.hora_fin]
      )
    }
  },

  async getBloquesOcupados(tecnicoId) {
    const r = await query(
      `SELECT b.fecha, b.hora_inicio, b.hora_fin, t.categoria, t.cliente_nombre
       FROM bloques_ocupados b
       LEFT JOIN trabajos t ON t.id = b.trabajo_id
       WHERE b.tecnico_id=$1 AND b.fecha >= CURRENT_DATE
       ORDER BY b.fecha, b.hora_inicio`,
      [tecnicoId]
    )
    return r.rows.map(row => ({
      ...row,
      fecha: typeof row.fecha === 'string' ? row.fecha : row.fecha.toISOString().split('T')[0]
    }))
  },

  async getDisponibilidadTecnico(tecnicoId) {
    const r = await query(
      'SELECT * FROM disponibilidad WHERE tecnico_id=$1 AND fecha>=CURRENT_DATE ORDER BY fecha, hora_inicio',
      [tecnicoId]
    )
    return r.rows.map(row => ({
      ...row,
      fecha: typeof row.fecha === 'string' ? row.fecha : row.fecha.toISOString().split('T')[0]
    }))
  },

  // ── FECHAS PROPUESTAS ─────────────────────────────────────────────────────
  async createFechasPropuestas(trabajoId, fechas) {
    for (const f of fechas) {
      await query(
        'INSERT INTO trabajo_fechas_propuestas (trabajo_id, fecha, hora) VALUES ($1, $2, $3)',
        [trabajoId, f.fecha, f.hora]
      )
    }
  },

  async getFechasPropuestas(trabajoId) {
    const r = await query(
      'SELECT fecha, hora FROM trabajo_fechas_propuestas WHERE trabajo_id=$1 ORDER BY fecha, hora',
      [trabajoId]
    )
    return r.rows.map(row => ({
      fecha: typeof row.fecha === 'string' ? row.fecha : row.fecha.toISOString().split('T')[0],
      hora: row.hora,
      label: `${formatFecha(typeof row.fecha === 'string' ? row.fecha : row.fecha.toISOString().split('T')[0])} ${row.hora}`
    }))
  },

  async buscarTecnicosPorFechas(categoria, comuna, fechas) {
    const duracion = DURACION[categoria] || 2
    const tecnicosMap = new Map()
    for (const fp of fechas) {
      const hora = fp.hora
      const [h] = hora.split(':').map(Number)
      const horaFin = `${String(h + duracion).padStart(2, '0')}:00`
      const r = await query(
        `SELECT DISTINCT t.id, t.nombre, t.rating, t.total_jobs
         FROM tecnicos t
         JOIN tecnico_categorias tc ON tc.tecnico_id=t.id AND tc.categoria=$1
         JOIN tecnico_comunas cm ON cm.tecnico_id=t.id AND cm.comuna=$2
         JOIN disponibilidad d ON d.tecnico_id=t.id
           AND d.fecha=$3
           AND d.hora_inicio::time <= $4::time
           AND d.hora_fin::time >= $5::time
         WHERE t.estado='activo'
         AND NOT EXISTS (
           SELECT 1 FROM bloques_ocupados bo
           WHERE bo.tecnico_id=t.id AND bo.fecha=$3
           AND bo.hora_inicio::time < $5::time
           AND bo.hora_fin::time > $4::time
         )`,
        [categoria, comuna, fp.fecha, hora, horaFin]
      )
      for (const row of r.rows) {
        if (!tecnicosMap.has(row.id)) tecnicosMap.set(row.id, row)
      }
    }
    return Array.from(tecnicosMap.values())
  },

  async getTrabajosPendientesNotificacion() {
    const r = await query(
      `SELECT * FROM trabajos
       WHERE estado='buscando'
       AND sin_tecnico_notificado=false
       AND created_at < NOW() - INTERVAL '2 hours'`
    )
    return r.rows
  },

  async marcarNotificado(id) {
    await query('UPDATE trabajos SET sin_tecnico_notificado=true WHERE id=$1', [id])
  },

  async bloquearHorario(tecnicoId, fecha, horaInicio, duracionHoras, trabajoId) {
    const [h, m] = horaInicio.split(':').map(Number)
    const fin = new Date(2000, 0, 1, h + duracionHoras, m)
    const horaFin = `${String(fin.getHours()).padStart(2,'0')}:${String(fin.getMinutes()).padStart(2,'0')}`
    await query(
      'INSERT INTO bloques_ocupados (tecnico_id,trabajo_id,fecha,hora_inicio,hora_fin) VALUES ($1,$2,$3,$4,$5)',
      [tecnicoId, trabajoId, fecha, horaInicio, horaFin]
    )
  },

  async buscarSlotsDisponibles(categoria, comuna, limite=5) {
    const r = await query(
      `SELECT t.id, t.nombre, t.rating, d.fecha, d.hora_inicio, d.hora_fin
       FROM tecnicos t
       JOIN tecnico_categorias tc ON tc.tecnico_id=t.id AND tc.categoria=$1
       JOIN tecnico_comunas cm ON cm.tecnico_id=t.id AND cm.comuna=$2
       JOIN disponibilidad d ON d.tecnico_id=t.id AND d.fecha>=CURRENT_DATE
       WHERE t.estado='activo'
       ORDER BY d.fecha, d.hora_inicio`,
      [categoria, comuna]
    )

    const duracion = DURACION[categoria] || 2
    const slots = []

    for (const row of r.rows) {
      const bloques = await query(
        'SELECT hora_inicio, hora_fin FROM bloques_ocupados WHERE tecnico_id=$1 AND fecha=$2',
        [row.id, row.fecha]
      )
      const [hIni] = row.hora_inicio.split(':').map(Number)
      const [hFin] = row.hora_fin.split(':').map(Number)

      for (let h = hIni; h <= hFin - duracion; h++) {
        const horaSlot = `${String(h).padStart(2,'0')}:00`
        const horaSlotFin = `${String(h + duracion).padStart(2,'0')}:00`
        const ocupado = bloques.rows.some(b => !(horaSlotFin <= b.hora_inicio || horaSlot >= b.hora_fin))
        if (!ocupado) {
          const fechaStr = typeof row.fecha === 'string' ? row.fecha : row.fecha.toISOString().split('T')[0]
          slots.push({
            tecnico_id: row.id,
            tecnico_nombre: row.nombre,
            tecnico_rating: row.rating,
            fecha: fechaStr,
            hora_inicio: horaSlot,
            hora_fin: horaSlotFin,
            label: `${formatFecha(fechaStr)} ${horaSlot} — ${row.nombre}`
          })
        }
      }
      if (slots.length >= limite) break
    }
    return slots.slice(0, limite)
  },
}

export async function initDb() {
  await query(`
    CREATE TABLE IF NOT EXISTS otp_verificaciones (
      id SERIAL PRIMARY KEY,
      telefono TEXT NOT NULL,
      codigo TEXT NOT NULL,
      expires_at TIMESTAMPTZ NOT NULL,
      verificado BOOLEAN DEFAULT false,
      verificado_at TIMESTAMPTZ,
      created_at TIMESTAMPTZ DEFAULT NOW()
    )
  `)

  // Migraciones — agregar columnas nuevas si no existen
  await query(`ALTER TABLE IF EXISTS tecnicos ADD COLUMN IF NOT EXISTS estado TEXT NOT NULL DEFAULT 'activo'`)
  await query(`ALTER TABLE IF EXISTS tecnicos ADD COLUMN IF NOT EXISTS cedula_foto TEXT`)
  await query(`ALTER TABLE IF EXISTS tecnicos ADD COLUMN IF NOT EXISTS razon_rechazo TEXT`)
  await query(`
    CREATE TABLE IF NOT EXISTS admins (
      id SERIAL PRIMARY KEY,
      nombre TEXT NOT NULL,
      email TEXT UNIQUE NOT NULL,
      password TEXT NOT NULL,
      created_at TIMESTAMPTZ DEFAULT NOW()
    )
  `)
  // Seed del primer admin desde variables de entorno
  if (process.env.ADMIN_EMAIL && process.env.ADMIN_PASSWORD) {
    const bcrypt = await import('bcryptjs')
    const hash = await bcrypt.default.hash(process.env.ADMIN_PASSWORD, 10)
    await query(
      'INSERT INTO admins (nombre, email, password) VALUES ($1, $2, $3) ON CONFLICT (email) DO NOTHING',
      [process.env.ADMIN_NOMBRE || 'Admin', process.env.ADMIN_EMAIL, hash]
    )
  }

  await query(`
    CREATE TABLE IF NOT EXISTS tecnicos (
      id SERIAL PRIMARY KEY,
      nombre TEXT NOT NULL,
      rut TEXT UNIQUE NOT NULL,
      telefono TEXT UNIQUE NOT NULL,
      password TEXT NOT NULL,
      foto_url TEXT,
      verificado BOOLEAN DEFAULT false,
      disponible BOOLEAN DEFAULT true,
      rating REAL DEFAULT 0,
      total_jobs INTEGER DEFAULT 0,
      total_reviews INTEGER DEFAULT 0,
      created_at TIMESTAMPTZ DEFAULT NOW()
    );
    CREATE TABLE IF NOT EXISTS tecnico_comunas (
      id SERIAL PRIMARY KEY,
      tecnico_id INTEGER REFERENCES tecnicos(id) ON DELETE CASCADE,
      comuna TEXT NOT NULL,
      UNIQUE(tecnico_id, comuna)
    );
    CREATE TABLE IF NOT EXISTS tecnico_categorias (
      id SERIAL PRIMARY KEY,
      tecnico_id INTEGER REFERENCES tecnicos(id) ON DELETE CASCADE,
      categoria TEXT NOT NULL,
      UNIQUE(tecnico_id, categoria)
    );
    CREATE TABLE IF NOT EXISTS trabajos (
      id SERIAL PRIMARY KEY,
      cliente_nombre TEXT NOT NULL,
      cliente_wa TEXT NOT NULL,
      categoria TEXT NOT NULL,
      descripcion TEXT NOT NULL,
      comuna TEXT NOT NULL,
      urgencia TEXT NOT NULL,
      fecha_agendada DATE,
      hora_agendada TEXT,
      estado TEXT DEFAULT 'buscando',
      tecnico_id INTEGER REFERENCES tecnicos(id),
      created_at TIMESTAMPTZ DEFAULT NOW(),
      accepted_at TIMESTAMPTZ,
      completed_at TIMESTAMPTZ
    );
    CREATE TABLE IF NOT EXISTS mensajes (
      id SERIAL PRIMARY KEY,
      trabajo_id INTEGER REFERENCES trabajos(id) ON DELETE CASCADE,
      origen TEXT NOT NULL,
      contenido TEXT NOT NULL,
      leido BOOLEAN DEFAULT false,
      created_at TIMESTAMPTZ DEFAULT NOW()
    );
    CREATE TABLE IF NOT EXISTS calificaciones (
      id SERIAL PRIMARY KEY,
      trabajo_id INTEGER UNIQUE REFERENCES trabajos(id),
      tecnico_id INTEGER REFERENCES tecnicos(id),
      puntaje INTEGER NOT NULL,
      comentario TEXT,
      created_at TIMESTAMPTZ DEFAULT NOW()
    );
    CREATE TABLE IF NOT EXISTS sesiones_bot (
      id SERIAL PRIMARY KEY,
      cliente_wa TEXT UNIQUE NOT NULL,
      estado TEXT NOT NULL DEFAULT 'inicio',
      datos_temp TEXT,
      trabajo_id INTEGER REFERENCES trabajos(id),
      updated_at TIMESTAMPTZ DEFAULT NOW()
    );
    CREATE TABLE IF NOT EXISTS disponibilidad (
      id SERIAL PRIMARY KEY,
      tecnico_id INTEGER REFERENCES tecnicos(id) ON DELETE CASCADE,
      fecha DATE NOT NULL,
      hora_inicio TEXT NOT NULL,
      hora_fin TEXT NOT NULL,
      created_at TIMESTAMPTZ DEFAULT NOW()
    );
    CREATE TABLE IF NOT EXISTS bloques_ocupados (
      id SERIAL PRIMARY KEY,
      tecnico_id INTEGER REFERENCES tecnicos(id) ON DELETE CASCADE,
      trabajo_id INTEGER REFERENCES trabajos(id),
      fecha DATE NOT NULL,
      hora_inicio TEXT NOT NULL,
      hora_fin TEXT NOT NULL,
      created_at TIMESTAMPTZ DEFAULT NOW()
    );
    CREATE TABLE IF NOT EXISTS trabajo_fechas_propuestas (
      id SERIAL PRIMARY KEY,
      trabajo_id INTEGER REFERENCES trabajos(id) ON DELETE CASCADE,
      fecha DATE NOT NULL,
      hora TEXT NOT NULL,
      created_at TIMESTAMPTZ DEFAULT NOW()
    );
    ALTER TABLE trabajos ADD COLUMN IF NOT EXISTS sin_tecnico_notificado BOOLEAN DEFAULT false;
  `)
  console.log('✅ Base de datos PostgreSQL lista')
}

export function getDb() { return db }
