import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'
import App from './App.tsx'
import '../../shared/typography.css'
import './window-shell.css'
import { ErrorBoundary } from './ErrorBoundary.tsx'
import { NativeModalWindowControls, NativeWindowFrame } from './NativeWindowControls.tsx'
import QuoteReminderWindow from './QuoteReminderWindow.tsx'

const isQuoteWindow = new URLSearchParams(window.location.search).get('window') === 'quote';
if (isQuoteWindow) document.documentElement.dataset.quoteWindow = 'true';

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <ErrorBoundary>
      {isQuoteWindow ? <QuoteReminderWindow /> : <>
        <NativeWindowFrame />
        <App />
        <NativeModalWindowControls />
      </>}
    </ErrorBoundary>
  </StrictMode>,
)
