import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { App } from './app'
import './index.css'

/**
 * The browser entry point.
 *
 * Throws when the mount element is missing rather than failing quietly. A
 * blank page with a clean console is the hardest kind of failure to diagnose
 * for someone who does not read code.
 */
const container = document.getElementById('root')

if (container === null) {
  throw new Error('the dashboard could not start: no #root element in the page')
}

createRoot(container).render(
  <StrictMode>
    <App />
  </StrictMode>,
)
