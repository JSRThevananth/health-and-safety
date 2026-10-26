import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

/**
 * Collect everything Apps Script needs into one flat folder for clasp to push.
 *
 * clasp pushes a single rootDir and wants the manifest at the top of it, but the
 * repository keeps the server code in src/ and the generated page in html/. A
 * nested rootDir would show up in the editor as "src/Api" and "html/Index",
 * renaming every file in the live project. Staging a flat copy keeps the editor
 * showing the same names it already has, and keeps node_modules, tests and
 * package.json out of the push without a .claspignore to maintain.
 */
const here = path.dirname(fileURLToPath(import.meta.url))
const root = path.join(here, '..')
const out = path.join(root, '.deploy')

const sources = [
  { dir: path.join(root, 'src'), match: /\.(gs|js|html)$|^appsscript\.json$/ },
  { dir: path.join(root, 'html'), match: /\.html$/ },
]

fs.rmSync(out, { recursive: true, force: true })
fs.mkdirSync(out, { recursive: true })

const staged = []
for (const { dir, match } of sources) {
  if (!fs.existsSync(dir)) continue
  for (const name of fs.readdirSync(dir).sort()) {
    if (!match.test(name)) continue
    const target = path.join(out, name)
    if (fs.existsSync(target)) {
      throw new Error(`Two source folders both provide "${name}"; one would overwrite the other.`)
    }
    fs.copyFileSync(path.join(dir, name), target)
    staged.push(name)
  }
}

/*
 * Without the manifest clasp pushes a project with no runtime, no scopes and no
 * web app entry point, which breaks the deployed URL. Fail here rather than let
 * CI report a successful deploy of a broken project.
 */
if (!staged.includes('appsscript.json')) {
  throw new Error('No appsscript.json was staged. Expected appscript/src/appsscript.json.')
}
if (!staged.some((name) => name.endsWith('.html'))) {
  throw new Error('No HTML page was staged. Run "npm run build:appscript" in web/ first.')
}

console.log(`Staged ${staged.length} files into ${path.relative(process.cwd(), out)}:`)
for (const name of staged) console.log(`  ${name}`)
