import 'dotenv/config'

export const PORT        = process.env.PORT || 3000
export const JWT_SECRET  = process.env.JWT_SECRET || 'dev_secret'
export const PWA_URL     = process.env.PWA_URL || 'http://localhost:5173'
export const PUBLIC_URL  = process.env.PUBLIC_URL || `http://localhost:${process.env.PORT || 3000}`
export const NODE_ENV    = process.env.NODE_ENV || 'development'
export const DATABASE_URL = process.env.DATABASE_URL || ''

export const TWILIO_ACCOUNT_SID     = process.env.TWILIO_ACCOUNT_SID || ''
export const TWILIO_AUTH_TOKEN      = process.env.TWILIO_AUTH_TOKEN || ''
export const TWILIO_WHATSAPP_NUMBER = process.env.TWILIO_WHATSAPP_NUMBER || ''
