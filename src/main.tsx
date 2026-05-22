import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { flushSync } from 'react-dom'
import './index.css'
import './content/cascade'
import { App, BOARD_MOUNT_ID } from './ui/App'
import { BoardScene } from './pixi/BoardScene'
import { OverlayScene } from './pixi/OverlayScene'
import { installSfxBindings } from './audio/sfx'

installSfxBindings()

const rootEl = document.getElementById('root')
if (!rootEl) throw new Error('#root not found')

const root = createRoot(rootEl)
flushSync(() => {
  root.render(
    <StrictMode>
      <App />
    </StrictMode>,
  )
})

const mountEl = document.getElementById(BOARD_MOUNT_ID)
if (!mountEl) throw new Error(`#${BOARD_MOUNT_ID} not found`)

const overlay = new OverlayScene()
const scene = new BoardScene(mountEl)
scene.setOverlay(overlay)
void Promise.all([overlay.init(), scene.init()])

if (import.meta.hot) {
  import.meta.hot.dispose(() => {
    scene.destroy()
    overlay.destroy()
  })
}
