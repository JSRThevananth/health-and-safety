import { createApp } from './app.js'
import { config, assertProductionConfig } from './config.js'
import { getDb } from './db/index.js'

assertProductionConfig()
getDb()

createApp().listen(config.port, () => {
  console.log(`API listening on http://localhost:${config.port}  [${config.env}]`)
  console.log(`  email:   ${config.brevo.enabled ? 'Brevo (live)' : 'dry-run (logged, not sent)'}`)
  console.log(`  storage: ${config.drive.enabled ? 'Google Drive' : `local (${config.drive.localFallbackDir})`}`)
})
