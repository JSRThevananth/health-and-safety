import Database from 'better-sqlite3'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { config } from '../config.js'

const here = path.dirname(fileURLToPath(import.meta.url))

let db

export function getDb() {
  if (db) return db
  fs.mkdirSync(path.dirname(config.db.file), { recursive: true })
  db = new Database(config.db.file)
  db.pragma('journal_mode = WAL')
  db.pragma('foreign_keys = ON')
  db.exec(fs.readFileSync(path.join(here, 'schema.sql'), 'utf8'))
  return db
}

export function closeDb() {
  if (db) {
    db.close()
    db = undefined
  }
}
