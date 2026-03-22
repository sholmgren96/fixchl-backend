import fs from 'fs'

const DB_FILE = './fixchl-data.json'

const EMPTY_DB = {
  tecnicos: [], tecnico_comunas: [], tecnico_categorias: [],
  trabajos: [], mensajes: [], calificaciones: [], sesiones_bot: [],
  _counters: { tecnicos: 0, trabajos: 0, mensajes: 0, calificaciones: 0, sesiones_bot: 0 }
}

function loadDb() {
  if (!fs.existsSync(DB_FILE)) fs.writeFileSync(DB_FILE, JSON.stringify(EMPTY_DB, null, 2))
  return JSON.parse(fs.readFileSync(DB_FILE, 'utf8'))
}

function saveDb(data) { fs.writeFileSync(DB_FILE, JSON.stringify(data, null, 2)) }

function nextId(data, table) {
  data._counters[table] = (data._counters[table] || 0) + 1
  return data._counters[table]
}

function now() { return new Date().toISOString() }

export const db = {
  getTecnico: (id) => loadDb().tecnicos.find(t => t.id === id) || null,
  getTecnicoByTelefono: (tel) => loadDb().tecnicos.find(t => t.telefono === tel) || null,
  getTecnicoByRutOrTelefono: (rut, tel) => loadDb().tecnicos.find(t => t.rut === rut || t.telefono === tel) || null,

  createTecnico({ nombre, rut, telefono, password }) {
    const data = loadDb()
    const id = nextId(data, 'tecnicos')
    const tecnico = { id, nombre, rut, telefono, password, foto_url: null, verificado: 0, disponible: 1, rating: 0, total_jobs: 0, total_reviews: 0, created_at: now() }
    data.tecnicos.push(tecnico)
    saveDb(data)
    return tecnico
  },

  updateTecnicoDisponible(id, disponible) {
    const data = loadDb()
    const t = data.tecnicos.find(t => t.id === id)
    if (t) { t.disponible = disponible ? 1 : 0; saveDb(data) }
  },

  updateTecnicoRating(id, rating, totalReviews) {
    const data = loadDb()
    const t = data.tecnicos.find(t => t.id === id)
    if (t) { t.rating = rating; t.total_reviews = totalReviews; saveDb(data) }
  },

  getComunas: (id) => loadDb().tecnico_comunas.filter(c => c.tecnico_id === id).map(c => c.comuna),

  addComuna(tecnicoId, comuna) {
    const data = loadDb()
    if (data.tecnico_comunas.find(c => c.tecnico_id === tecnicoId && c.comuna === comuna)) throw new Error('Duplicado')
    data.tecnico_comunas.push({ tecnico_id: tecnicoId, comuna })
    saveDb(data)
  },

  deleteComuna(tecnicoId, comuna) {
    const data = loadDb()
    data.tecnico_comunas = data.tecnico_comunas.filter(c => !(c.tecnico_id === tecnicoId && c.comuna === comuna))
    saveDb(data)
  },

  getCategorias: (id) => loadDb().tecnico_categorias.filter(c => c.tecnico_id === id).map(c => c.categoria),

  addCategoria(tecnicoId, categoria) {
    const data = loadDb()
    if (data.tecnico_categorias.find(c => c.tecnico_id === tecnicoId && c.categoria === categoria)) throw new Error('Duplicado')
    data.tecnico_categorias.push({ tecnico_id: tecnicoId, categoria })
    saveDb(data)
  },

  deleteCategoria(tecnicoId, categoria) {
    const data = loadDb()
    data.tecnico_categorias = data.tecnico_categorias.filter(c => !(c.tecnico_id === tecnicoId && c.categoria === categoria))
    saveDb(data)
  },

  getTrabajo: (id) => loadDb().trabajos.find(t => t.id === id) || null,

  createTrabajo({ cliente_nombre, cliente_wa, categoria, descripcion, comuna, urgencia }) {
    const data = loadDb()
    const id = nextId(data, 'trabajos')
    const trabajo = { id, cliente_nombre, cliente_wa, categoria, descripcion, comuna, urgencia, estado: 'buscando', tecnico_id: null, created_at: now(), accepted_at: null, completed_at: null }
    data.trabajos.push(trabajo)
    saveDb(data)
    return trabajo
  },

  getTrabajosdisponibles(comunas) {
    return loadDb().trabajos
      .filter(t => t.estado === 'buscando' && comunas.includes(t.comuna))
      .sort((a, b) => (a.urgencia === 'Hoy mismo' ? -1 : 1))
  },

  getMisTrabajos: (tecnicoId) => loadDb().trabajos.filter(t => t.tecnico_id === tecnicoId && ['activo','esperando_calificacion'].includes(t.estado)),

  aceptarTrabajo(id, tecnicoId) {
    const data = loadDb()
    const t = data.trabajos.find(t => t.id === id && t.estado === 'buscando')
    if (!t) return false
    t.estado = 'activo'; t.tecnico_id = tecnicoId; t.accepted_at = now()
    saveDb(data); return true
  },

  completarTrabajo(id, tecnicoId) {
    const data = loadDb()
    const t = data.trabajos.find(t => t.id === id && t.tecnico_id === tecnicoId && t.estado === 'activo')
    if (!t) return false
    t.estado = 'esperando_calificacion'; t.completed_at = now()
    saveDb(data); return true
  },

  updateTrabajoEstado(id, estado) {
    const data = loadDb()
    const t = data.trabajos.find(t => t.id === id)
    if (t) { t.estado = estado; saveDb(data) }
  },

  updateTrabajoTecnico(id, tecnicoId) {
    const data = loadDb()
    const t = data.trabajos.find(t => t.id === id)
    if (t) { t.tecnico_id = tecnicoId; t.accepted_at = now(); saveDb(data) }
  },

  getMensajes: (trabajoId) => loadDb().mensajes.filter(m => m.trabajo_id === trabajoId).sort((a,b) => new Date(a.created_at) - new Date(b.created_at)),

  createMensaje(trabajoId, origen, contenido) {
    const data = loadDb()
    const id = nextId(data, 'mensajes')
    const msg = { id, trabajo_id: trabajoId, origen, contenido, leido: 0, created_at: now() }
    data.mensajes.push(msg); saveDb(data); return msg
  },

  marcarLeidos(trabajoId) {
    const data = loadDb()
    data.mensajes.forEach(m => { if (m.trabajo_id === trabajoId && m.origen === 'cliente') m.leido = 1 })
    saveDb(data)
  },

  countNoLeidos: (trabajoId) => loadDb().mensajes.filter(m => m.trabajo_id === trabajoId && m.origen === 'cliente' && m.leido === 0).length,

  createCalificacion(trabajoId, tecnicoId, puntaje, comentario = null) {
    const data = loadDb()
    if (data.calificaciones.find(c => c.trabajo_id === trabajoId)) return false
    data.calificaciones.push({ trabajo_id: trabajoId, tecnico_id: tecnicoId, puntaje, comentario, created_at: now() })
    saveDb(data); return true
  },

  getCalificacionesTecnico(tecnicoId) {
    const data = loadDb()
    return data.calificaciones.filter(c => c.tecnico_id === tecnicoId)
      .map(c => { const t = data.trabajos.find(t => t.id === c.trabajo_id); return { ...c, cliente_nombre: t?.cliente_nombre, categoria: t?.categoria, comuna: t?.comuna } })
      .sort((a,b) => new Date(b.created_at) - new Date(a.created_at)).slice(0, 20)
  },

  getRatingStats(tecnicoId) {
    const cals = loadDb().calificaciones.filter(c => c.tecnico_id === tecnicoId)
    if (!cals.length) return { avg: 0, total: 0 }
    return { avg: Math.round(cals.reduce((s,c) => s + c.puntaje, 0) / cals.length * 10) / 10, total: cals.length }
  },

  getSesion: (wa) => loadDb().sesiones_bot.find(s => s.cliente_wa === wa) || null,

  upsertSesion(clienteWa, estado, datos, trabajoId = null) {
    const data = loadDb()
    let s = data.sesiones_bot.find(s => s.cliente_wa === clienteWa)
    if (s) {
      s.estado = estado; s.datos_temp = JSON.stringify(datos)
      if (trabajoId !== null) s.trabajo_id = trabajoId
      s.updated_at = now()
    } else {
      data.sesiones_bot.push({ id: nextId(data, 'sesiones_bot'), cliente_wa: clienteWa, estado, datos_temp: JSON.stringify(datos), trabajo_id: trabajoId, updated_at: now() })
    }
    saveDb(data)
  },

  buscarTecnicos(categoria, comuna) {
    const data = loadDb()
    return data.tecnicos.filter(t => {
      if (!t.disponible) return false
      return data.tecnico_categorias.some(c => c.tecnico_id === t.id && c.categoria === categoria)
          && data.tecnico_comunas.some(c => c.tecnico_id === t.id && c.comuna === comuna)
    }).sort((a,b) => b.rating - a.rating).slice(0, 3)
  },
}

export function initDb() { loadDb(); console.log('✅ Base de datos lista en fixchl-data.json') }
export function getDb() { return db }
