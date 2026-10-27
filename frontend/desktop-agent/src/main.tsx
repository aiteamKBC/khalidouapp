import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'
import App from './App.tsx'
import '../../shared/typography.css'
import './window-shell.css'
import { ErrorBoundary } from './ErrorBoundary.tsx'
import { NativeModalWindowControls } from './NativeWindowControls.tsx'

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <ErrorBoundary>
      <App />
      <NativeModalWindowControls />
    </ErrorBoundary>
  </StrictMode>,
)
