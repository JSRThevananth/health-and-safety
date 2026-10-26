/**
 * Serves the interface.
 *
 * The UI is the same React application as the Node build, produced by Vite and
 * inlined into Index.html. It is not a rewrite: the only difference is that
 * web/src/lib/api.js routes calls through google.script.run instead of fetch.
 */
function doGet() {
  return HtmlService.createHtmlOutputFromFile('Index')
    .setTitle('Health & Safety')
    .addMetaTag('viewport', 'width=device-width, initial-scale=1, viewport-fit=cover')
    // IFRAME is required for the app to run its own scripts; NATIVE is retired.
    .setXFrameOptionsMode(HtmlService.XFrameOptionsMode.ALLOWALL)
    .setSandboxMode(HtmlService.SandboxMode.IFRAME);
}
