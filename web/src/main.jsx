import React from 'react'
import ReactDOM from 'react-dom/client'
import { BrowserRouter, HashRouter } from 'react-router-dom'
import { isAppsScript } from './lib/appsScriptBridge.js'
import App from './App.jsx'
import { AuthProvider } from './lib/auth.jsx'
import { ThemeProvider } from './lib/theme.jsx'
import { UnitProvider } from './lib/unitContext.jsx'
import { warmUp } from './lib/warmup.js'
import './theme/tokens.css'
import './styles.css'

// Fired before the first render: the API starts waking while the page is still
// painting, so a cold start overlaps with the user rather than following them.
warmUp()

/*
 * Apps Script serves the app from a single URL and cannot route on the path, so
 * navigation there has to live in the hash. Everywhere else keeps clean URLs.
 */
const Router = isAppsScript() ? HashRouter : BrowserRouter

ReactDOM.createRoot(document.getElementById('root')).render(
  <React.StrictMode>
    <ThemeProvider>
      <AuthProvider>
        <UnitProvider>
          <Router>
            <App />
          </Router>
        </UnitProvider>
      </AuthProvider>
    </ThemeProvider>
  </React.StrictMode>
)
