import { QueryClientProvider } from '@tanstack/react-query'
import { EventList } from './event-list'
import { t } from './i18n'
import { queryClient } from './trpc'

/**
 * The dashboard shell.
 *
 * Deliberately almost nothing. Chapter 26's four layers and the "needs you"
 * overview are real requirements, and they are not built here — the data path
 * had to be proved first, and a navigation frame around one screen would be
 * scaffolding shaped by guesses about screens that do not exist.
 *
 * Reference: docs/01-bible/26-dashboard-architecture.md
 */
export function App(): React.JSX.Element {
  return (
    <QueryClientProvider client={queryClient}>
      <main>
        <h1>{t('app.title')}</h1>
        <h2>{t('events.heading')}</h2>
        <EventList />
      </main>
    </QueryClientProvider>
  )
}
