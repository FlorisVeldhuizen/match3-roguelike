import { useEffect, useState } from 'react'
import { getVolume, setVolume, subscribeVolume } from '../../audio/sfx'

// Range slider bound to the master gain. Stays in sync with external
// changes (subscribeVolume) so any future programmatic volume change
// reflects in the UI.
export function VolumeSlider() {
  const [value, setLocal] = useState(getVolume)

  useEffect(() => subscribeVolume(setLocal), [])

  return (
    <label
      className="volume-slider"
      aria-label={`Sound volume ${Math.round(value * 100)}%`}
      title={`Volume ${Math.round(value * 100)}%`}
    >
      <input
        type="range"
        min={0}
        max={1}
        step={0.01}
        value={value}
        onChange={(e) => setVolume(Number(e.target.value))}
      />
    </label>
  )
}
