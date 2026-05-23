import { useEffect, useState } from 'react'
import { isStarted, markStarted, subscribeStarted } from '../splashState'

// Click-to-start splash. Full-viewport overlay sitting on top of the running
// ArcaneBackground so the ambient FBM smoke smolders through behind. The
// click also unlocks the AudioContext: the splash registers its dismiss on
// pointerdown (which the audio-unlock listener in sfx.ts also hears), so by
// the time the board intro fires its drop SFX the context is already
// resumed. iOS requires the resume() call to happen synchronously inside
// a touch handler — `pointerdown` satisfies that on every modern browser.
export function Splash() {
  const [started, setLocal] = useState(isStarted)
  // `leaving` runs the fade-out animation between "user tapped" and "splash
  // unmounts". The board intro starts during this window so the gems pour
  // in exactly as the wordmark dissolves.
  const [leaving, setLeaving] = useState(false)

  useEffect(() => subscribeStarted(setLocal), [])

  if (started && !leaving) return null

  const handleDismiss = () => {
    if (leaving) return
    setLeaving(true)
    // Mark started synchronously inside the gesture so BoardScene's
    // subscribeStarted callback runs in the same task as the audio resume
    // — keeps iOS happy and aligns the intro-fall with the splash fade-out.
    markStarted()
    // Component unmounts after the CSS fade completes (260ms). Doing it
    // here instead of via onAnimationEnd keeps the timing predictable
    // even if the animation gets interrupted.
    window.setTimeout(() => setLocal(true), 260)
  }

  return (
    <div
      className={`splash${leaving ? ' is-leaving' : ''}`}
      onPointerDown={handleDismiss}
      role="button"
      tabIndex={0}
      aria-label="Tap to begin"
      onKeyDown={(e) => {
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault()
          handleDismiss()
        }
      }}
    >
      <div className="splash-inner">
        <h1 className="splash-title">Renzadora</h1>
        <p className="splash-tagline">A chained-match roguelite</p>
        <p className="splash-prompt">Tap to begin</p>
      </div>
    </div>
  )
}
