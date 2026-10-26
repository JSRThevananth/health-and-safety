import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

/**
 * Regenerate src/library/checklist-v1.js from the JSON master.
 *
 * The JSON is the editable source; the .js file is what both the Worker and the
 * tests import, because a plain ES module needs no import attribute and no
 * bundler-specific handling.
 */
const here = path.dirname(fileURLToPath(import.meta.url))
const source = path.join(here, '..', 'src', 'library', 'checklist-v1.json')
const target = path.join(here, '..', 'src', 'library', 'checklist-v1.js')

const data = JSON.parse(fs.readFileSync(source, 'utf8'))
const banner = fs.readFileSync(target, 'utf8').split('export default ')[0]
fs.writeFileSync(target, `${banner}export default ${JSON.stringify(data, null, 2)}\n`)

const items = data.sections.flatMap((s) => s.groups).flatMap((g) => g.items).length
console.log(`Wrote ${data.sections.length} sections, ${items} items to ${path.relative(process.cwd(), target)}`)
