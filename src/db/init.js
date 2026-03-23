import { initDb } from './database.js'
initDb().then(() => { console.log('Base de datos lista'); process.exit(0) }).catch(e => { console.error(e); process.exit(1) })
