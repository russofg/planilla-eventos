import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'
import App from './App.jsx'

// After a new deploy, a client running the previous build may try to lazy-load
// a chunk whose hash no longer exists on the server, which throws
// "Failed to fetch dynamically imported module". Vite emits vite:preloadError
// for exactly this — reload once to pick up the fresh build (guarded so a
// genuinely-missing chunk can't cause an infinite reload loop).
window.addEventListener('vite:preloadError', () => {
  const last = Number(sessionStorage.getItem('vite:preloadError:ts') || 0)
  const now = Date.now()
  if (now - last > 10000) {
    sessionStorage.setItem('vite:preloadError:ts', String(now))
    window.location.reload()
  }
})

createRoot(document.getElementById('root')).render(
  <StrictMode>
    <App />
  </StrictMode>,
)
