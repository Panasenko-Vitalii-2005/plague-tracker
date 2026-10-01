import { useEffect, useState } from 'react'
import type { LiveSnapshot } from '../api/types.ts'
import { copyTextFor, formatCopyNews, formatCopySnapshot, type CopySource, type CopyTarget } from '../domain/copyView.ts'
import { writeCopyText } from '../domain/copyClipboard.ts'
import './CopyView.css'

type Feedback = CopyTarget | 'error' | null

export function CopyView({ snapshot, source, onSourceChange }: {
  snapshot: LiveSnapshot | null
  source: CopySource
  onSourceChange(source: CopySource): void
}) {
  const [feedback, setFeedback] = useState<Feedback>(null)

  useEffect(() => {
    if (feedback === null) return
    const timer = window.setTimeout(() => setFeedback(null), 2200)
    return () => window.clearTimeout(timer)
  }, [feedback])

  const copy = async (target: CopyTarget) => {
    if (snapshot === null) return
    const success = await writeCopyText(copyTextFor(snapshot, target))
    setFeedback(success ? target : 'error')
  }

  return <CopyViewContent snapshot={snapshot} source={source} feedback={feedback} onCopy={copy}
    onSourceChange={(next) => { setFeedback(null); onSourceChange(next) }} />
}

export function CopyViewContent({ snapshot, source, feedback, onCopy, onSourceChange }: {
  snapshot: LiveSnapshot | null
  source: CopySource
  feedback: Feedback
  onCopy(target: CopyTarget): void
  onSourceChange(source: CopySource): void
}) {
  return <div className="dashboard-view copy-view" aria-label="Copy View">
    <div className="view-heading"><div><span className="eyebrow">PLAIN TEXT</span>
      <h1>Copy View</h1></div><span className="view-note">Select text or use a copy button</span></div>
    <div className="copy-toolbar">
      <div className="copy-source" role="group" aria-label="Copy source">
        <button type="button" className={source === 'live' ? 'is-active' : ''}
          aria-pressed={source === 'live'} onClick={() => onSourceChange('live')}>LIVE</button>
        <button type="button" className={source === 'history' ? 'is-active' : ''}
          aria-pressed={source === 'history'} onClick={() => onSourceChange('history')}>HISTORY</button>
      </div>
      <button type="button" className="secondary-button" disabled={snapshot === null}
        onClick={() => onCopy('everything')}>Copy everything</button>
      <span className="copy-feedback" role="status" aria-live="polite">
        {feedback === 'error' ? 'Clipboard unavailable — select text and press Ctrl+C'
          : feedback !== null ? 'Copied' : ''}
      </span>
    </div>

    {snapshot === null ? <p className="surface copy-empty">No game snapshot available.</p> : <>
      <section className="surface copy-section" aria-label="Copyable snapshot">
        <div className="copy-section-heading"><h2>Snapshot</h2>
          <button type="button" className="secondary-button" onClick={() => onCopy('snapshot')}>Copy snapshot</button></div>
        <pre className="copy-text">{formatCopySnapshot(snapshot)}</pre>
      </section>
      <section className="surface copy-section" aria-label="Copyable outbreak news">
        <div className="copy-section-heading"><h2>Outbreak news</h2>
          <button type="button" className="secondary-button" onClick={() => onCopy('news')}>Copy news</button></div>
        <pre className="copy-text">{formatCopyNews(snapshot)}</pre>
      </section>
    </>}
  </div>
}
