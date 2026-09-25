import { useState } from 'react'
import { DashboardHeader, type DashboardMode } from './components/DashboardHeader.tsx'
import { HistoryPanel } from './components/HistoryPanel.tsx'
import { LivePanel } from './components/LivePanel.tsx'
import { useLiveGame } from './hooks/useLiveGame.ts'
import './App.css'

function App() {
  const [mode, setMode] = useState<DashboardMode>('live')
  const live = useLiveGame()

  return (
    <div className="app-shell">
      <DashboardHeader mode={mode} onModeChange={setMode} connectionState={live.connectionState} />
      <main className="dashboard-main">
        {mode === 'live' ? <LivePanel key={live.sessionId ?? 'inactive'} live={live} /> : <HistoryPanel />}
      </main>
    </div>
  )
}

export default App
