import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

/**
 * Inline the built React app into a single HTML file for Apps Script.
 *
 * HtmlService serves one file and cannot serve the hashed asset bundle Vite
 * produces, so the CSS and JS are folded into the page itself. This is generated
 * output: edit the React source and rebuild, never edit Index.html.
 */
const here = path.dirname(fileURLToPath(import.meta.url))
const web = path.join(here, '..')
const dist = path.join(web, 'dist')
const target = path.join(web, '..', 'appscript', 'html', 'Index.html')

if (!fs.existsSync(dist)) {
  console.error('No dist/ folder. Run "npm run build" first.')
  process.exit(1)
}

const html = fs.readFileSync(path.join(dist, 'index.html'), 'utf8')

const inline = (pattern, wrap) =>
  [...html.matchAll(pattern)].map(([, file]) => {
    const asset = path.join(dist, file.replace(/^\//, ''))
    if (!fs.existsSync(asset)) throw new Error(`Missing asset referenced by index.html: ${file}`)
    return wrap(fs.readFileSync(asset, 'utf8'))
  })

const styles = inline(/<link[^>]+href="([^"]+\.css)"[^>]*>/g, (css) => `<style>\n${css}\n</style>`)
/*
 * Escape any closing script tag inside the bundle before inlining it.
 *
 * The HTML parser ends a <script> block at the first literal </script>, even one
 * inside a JavaScript string. React's own source contains markup in strings, so a
 * future build emitting "</script>" would silently truncate the page and leave a
 * blank screen with no error. <\/script> is identical to the JS engine and
 * invisible to the parser.
 */
const escapeClosingTag = (js) => js.replace(/<\/(script)/gi, '<\\/$1')

const scripts = inline(
  /<script[^>]+src="([^"]+\.js)"[^>]*>\s*<\/script>/g,
  (js) => `<script>\n${escapeClosingTag(js)}\n</script>`
)

if (scripts.length === 0) throw new Error('No script bundle found in dist/index.html')

const page = `<!DOCTYPE html>
<html lang="en">
  <head>
    <base target="_top">
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">
    <title>Health &amp; Safety</title>
${styles.join('\n')}
  </head>
  <body>
    <div id="root"></div>
${scripts.join('\n')}
  </body>
</html>
`

/*
 * Only closing tags can break out of a script block: while parsing one, the HTML
 * parser scans for </script and ignores everything else, so a "<script>" sitting
 * inside a JavaScript string is harmless. Count the closers alone.
 */
const closes = (page.match(/<\/script\s*>/gi) || []).length
if (closes !== scripts.length) {
  console.error(
    `Refusing to write: found ${closes} closing script tags, expected ${scripts.length}. ` +
    `An unescaped </script> inside the bundle would truncate the page and blank the screen.`
  )
  process.exit(1)
}

fs.mkdirSync(path.dirname(target), { recursive: true })
fs.writeFileSync(target, page)

const kb = (n) => `${(n / 1024).toFixed(0)} KB`
console.log(`Wrote ${path.relative(path.join(web, '..'), target)}`)
console.log(`  ${styles.length} stylesheet(s), ${scripts.length} script(s), ${kb(page.length)} total`)

// HtmlService rejects very large files, and a slow first paint on airport wifi is
// its own problem. Warn well before either becomes a surprise.
if (page.length > 2 * 1024 * 1024) {
  console.warn(`  WARNING: ${kb(page.length)} is large for HtmlService and slow to load.`)
}
