import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'
import { QueryClientProvider } from '@tanstack/react-query'
import { queryClient } from './query-client'
import { router } from './routes'
import { RouterProvider } from '@tanstack/react-router'
import { registerSW } from 'virtual:pwa-register'

/**
 * Registers the PWA service worker and keeps it up to date automatically.
 */
registerSW({ immediate: true })

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <QueryClientProvider client={queryClient}>
      <RouterProvider router={router} />
    </QueryClientProvider>
  </StrictMode>,
)
