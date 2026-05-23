import { useEffect, useRef, useState } from 'react'
import { getFXSettings, subscribeFXSettings } from '../../fx/settings'

// Fullscreen WebGL canvas that draws subtle CRT scanlines + animated
// noise specks + soft vignette over the whole page. Transparent + pointer
// -events:none, so it only adds the visual veneer — clicks fall through
// to the React UI and the board canvas underneath.

const VERT_SRC = `
attribute vec2 a_pos;
void main() {
  gl_Position = vec4(a_pos, 0.0, 1.0);
}
`

// Output is RGBA premultiplied by alpha — most of the screen stays clear
// (alpha 0), with scanline rows and occasional specks darkening the page
// underneath. Vignette gently dims the corners.
const FRAG_SRC = `
precision mediump float;
uniform float u_time;
uniform vec2 u_resolution;

float hash(vec2 p) {
  return fract(sin(dot(p, vec2(12.9898, 78.233))) * 43758.5453);
}

void main() {
  vec2 frag = gl_FragCoord.xy;
  vec2 uv = frag / u_resolution.xy;

  // Horizontal scanlines, ~2px period. Even rows are clear, odd rows get
  // a faint black overlay.
  float scan = step(1.0, mod(frag.y, 2.0));
  float scanAlpha = scan * 0.05;

  // Animated grain: hash on (frag, seed) where seed is time-quantized so
  // the pattern reseeds at ~5Hz. Slow + sparse so it sits behind the
  // image rather than fighting it.
  float seed = floor(u_time * 5.0);
  float n = hash(frag + vec2(seed * 0.31, seed * 0.17));
  // Dark specks — top ~1.5% of the noise distribution.
  float dark = step(0.985, n) * (n - 0.985) * 8.0;
  // Bright flecks — top ~1%.
  float light = step(0.99, 1.0 - n) * (0.01 - n) * -8.0;

  // Soft vignette — dims the corners so the screen feels framed.
  float d = distance(uv, vec2(0.5));
  float vig = smoothstep(0.45, 1.05, d);
  float vigAlpha = vig * 0.22;

  float blackAlpha = clamp(scanAlpha + dark * 0.12 + vigAlpha, 0.0, 0.45);
  // Light flecks contribute a small white add over the darkened pixel.
  vec3 rgb = vec3(light * 0.22);
  float a = blackAlpha + light * 0.15;
  // Premultiply so the canvas composites correctly with the page below.
  gl_FragColor = vec4(rgb * a, a);
}
`

function compile(
  gl: WebGLRenderingContext,
  type: number,
  src: string,
): WebGLShader | null {
  const sh = gl.createShader(type)
  if (!sh) return null
  gl.shaderSource(sh, src)
  gl.compileShader(sh)
  if (!gl.getShaderParameter(sh, gl.COMPILE_STATUS)) {
    console.warn('crt-overlay shader compile failed', gl.getShaderInfoLog(sh))
    gl.deleteShader(sh)
    return null
  }
  return sh
}

export function CRTOverlay() {
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const [enabled, setEnabled] = useState(() => getFXSettings().crt)

  useEffect(() => subscribeFXSettings((s) => setEnabled(s.crt)), [])

  useEffect(() => {
    if (!enabled) return
    const canvas = canvasRef.current
    if (!canvas) return
    const gl = canvas.getContext('webgl', {
      antialias: false,
      alpha: true,
      premultipliedAlpha: true,
      preserveDrawingBuffer: false,
      powerPreference: 'low-power',
    })
    if (!gl) return

    const vs = compile(gl, gl.VERTEX_SHADER, VERT_SRC)
    const fs = compile(gl, gl.FRAGMENT_SHADER, FRAG_SRC)
    if (!vs || !fs) return
    const prog = gl.createProgram()
    if (!prog) return
    gl.attachShader(prog, vs)
    gl.attachShader(prog, fs)
    gl.linkProgram(prog)
    if (!gl.getProgramParameter(prog, gl.LINK_STATUS)) {
      console.warn('crt-overlay link failed', gl.getProgramInfoLog(prog))
      return
    }
    gl.useProgram(prog)
    gl.enable(gl.BLEND)
    gl.blendFunc(gl.ONE, gl.ONE_MINUS_SRC_ALPHA)

    const buf = gl.createBuffer()
    gl.bindBuffer(gl.ARRAY_BUFFER, buf)
    gl.bufferData(
      gl.ARRAY_BUFFER,
      new Float32Array([-1, -1, 1, -1, -1, 1, -1, 1, 1, -1, 1, 1]),
      gl.STATIC_DRAW,
    )
    const aPos = gl.getAttribLocation(prog, 'a_pos')
    gl.enableVertexAttribArray(aPos)
    gl.vertexAttribPointer(aPos, 2, gl.FLOAT, false, 0, 0)
    const uTime = gl.getUniformLocation(prog, 'u_time')
    const uRes = gl.getUniformLocation(prog, 'u_resolution')

    // Half-res internal — scanlines + grain look identical at 0.5 because
    // the shader pattern scales with frag coord; halving saves ~75% on a
    // 4K display and the upscale is invisible.
    const RENDER_SCALE = 0.5
    const resize = () => {
      const w = Math.max(1, Math.floor(window.innerWidth * RENDER_SCALE))
      const h = Math.max(1, Math.floor(window.innerHeight * RENDER_SCALE))
      if (canvas.width !== w || canvas.height !== h) {
        canvas.width = w
        canvas.height = h
        gl.viewport(0, 0, w, h)
      }
    }
    resize()
    window.addEventListener('resize', resize)

    const reducedMotion = window.matchMedia(
      '(prefers-reduced-motion: reduce)',
    ).matches
    const start = performance.now()
    let raf = 0
    // 30Hz — grain reseeds at 14Hz which is already below this, and the
    // visual difference between 30/60 is invisible. Matches ArcaneBackground.
    const FRAME_MIN_MS = 1000 / 30
    let lastDraw = 0
    const draw = (now: number) => {
      if (!reducedMotion) raf = requestAnimationFrame(draw)
      if (!reducedMotion && now - lastDraw < FRAME_MIN_MS) return
      lastDraw = now
      const t = reducedMotion ? 0 : (now - start) / 1000
      gl.uniform1f(uTime, t)
      gl.uniform2f(uRes, canvas.width, canvas.height)
      gl.drawArrays(gl.TRIANGLES, 0, 6)
    }
    if (reducedMotion) {
      draw(start)
    } else {
      raf = requestAnimationFrame(draw)
    }

    return () => {
      cancelAnimationFrame(raf)
      window.removeEventListener('resize', resize)
      gl.deleteProgram(prog)
      gl.deleteShader(vs)
      gl.deleteShader(fs)
      gl.deleteBuffer(buf)
    }
  }, [enabled])

  if (!enabled) return null
  return <canvas ref={canvasRef} className="crt-overlay" aria-hidden />
}
