import { useEffect, useState } from 'react'
import { isMuted, setMuted, subscribeMuted } from '../../audio/sfx'

export function MuteToggle() {
  const [muted, setLocalMuted] = useState(isMuted)

  useEffect(() => subscribeMuted(setLocalMuted), [])

  return (
    <button
      type="button"
      className="mute-toggle"
      aria-label={muted ? 'Unmute sound effects' : 'Mute sound effects'}
      aria-pressed={muted}
      onClick={() => setMuted(!muted)}
    >
      <span aria-hidden>{muted ? '🔇' : '🔊'}</span>
    </button>
  )
}
