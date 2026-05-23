import { useEffect, useState } from 'react'
import { isStarted, markStarted, subscribeStarted } from '../splashState'
import { unlockAudio } from '../../audio/sfx'

// Click-to-start splash. Full-viewport overlay sitting on top of the running
// ArcaneBackground so the ambient FBM smoke smolders through behind. The
// click also unlocks the AudioContext: the splash registers its dismiss on
// pointerdown (which the audio-unlock listener in sfx.ts also hears), so by
// the time the board intro fires its drop SFX the context is already
// resumed. iOS requires the resume() call to happen synchronously inside
// a touch handler — `pointerdown` satisfies that on every modern browser.
// Touch-capable detection. Used to show the iOS silent-switch hint — UA
// sniffing for /iPhone/ would miss iPadOS (which now reports as Mac) and
// would be a false-positive for hybrid touchscreen laptops. maxTouchPoints
// catches every device that can plausibly have a hardware mute switch
// affecting WebAudio. Android users get the hint too, which is harmless —
// the wording is iPhone-specific so they'll just skim past.
function isTouchCapable(): boolean {
  if (typeof navigator === 'undefined') return false
  return navigator.maxTouchPoints > 0
}

export function Splash() {
  const [started, setLocal] = useState(isStarted)
  // `leaving` runs the fade-out animation between "user tapped" and "splash
  // unmounts". The board intro starts during this window so the gems pour
  // in exactly as the wordmark dissolves.
  const [leaving, setLeaving] = useState(false)
  // Computed once on mount — touch capability doesn't change at runtime.
  const [showSilentHint] = useState(isTouchCapable)

  useEffect(() => subscribeStarted(setLocal), [])

  if (started && !leaving) return null

  const handleDismiss = () => {
    if (leaving) return
    // Unlock audio FIRST, synchronously inside the gesture handler. iOS
    // requires the AudioContext to be created (and a sound played) in the
    // same task as the user gesture — calling this before any React state
    // updates keeps the call inside that window even after React batches.
    unlockAudio()
    setLeaving(true)
    // Mark started so BoardScene's subscribeStarted callback runs and the
    // intro-fall aligns with the splash fade-out.
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
        {showSilentHint && (
          <p className="splash-hint">turn off silent mode to hear sound</p>
        )}
      </div>
    </div>
  )
}
