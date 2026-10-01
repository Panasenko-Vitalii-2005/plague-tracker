import { useState } from 'react'
import { DashboardHeader, type DashboardMode } from './components/DashboardHeader.tsx'
import { CopyView } from './components/CopyView.tsx'
import { HistoryPanel } from './components/HistoryPanel.tsx'
import { LivePanel } from './components/LivePanel.tsx'
import { useLiveGame } from './hooks/useLiveGame.ts'
import { useHistoryWorkspace, type HistoryWorkspace } from './hooks/useHistoryWorkspace.ts'
import { selectCopySnapshot, type CopySource } from './domain/copyView.ts'
import './App.css'

function ConnectedHeader({ mode, onModeChange }: {
  mode: DashboardMode
  onModeChange(mode: DashboardMode): void
}) {
  const live = useLiveGame()
  return <DashboardHeader mode={mode} onModeChange={onModeChange} connectionState={live.connectionState} />
}

function ConnectedLivePanel() {
  const live = useLiveGame()
  return <LivePanel key={live.sessionId ?? 'inactive'} live={live} />
}

function ConnectedCopyView({ history, source, onSourceChange }: {
  history: HistoryWorkspace
  source: CopySource
  onSourceChange(source: CopySource): void
}) {
  const live = useLiveGame()
  const historicalSnapshot = history.replay.snapshot.status === 'success' ? history.replay.snapshot.data : null
  const snapshot = selectCopySnapshot(source, live.snapshot, historicalSnapshot)
  return <CopyView snapshot={snapshot} source={source} onSourceChange={onSourceChange} />
}

function App() {
  const [mode, setMode] = useState<DashboardMode>('live')
  const [copySource, setCopySource] = useState<CopySource>('live')
  const history = useHistoryWorkspace()

  const navigate = (next: DashboardMode) => {
    if (mode === 'history' && next !== 'history' && history.replay.isPlaying) history.replay.togglePlay()
    if (next === 'copy' && mode !== 'copy') setCopySource(mode === 'history' ? 'history' : 'live')
    setMode(next)
  }

  return (
    <div className="app-shell">
      <ConnectedHeader mode={mode} onModeChange={navigate} />
      <main className="dashboard-main">
        {mode === 'live' ? <ConnectedLivePanel />
          : mode === 'history' ? <HistoryPanel workspace={history} />
            : <ConnectedCopyView history={history} source={copySource} onSourceChange={setCopySource} />}
      </main>
    </div>
  )
}

export default App
