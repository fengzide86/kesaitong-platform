export type AuthVariant = 'consumer' | 'admin'

type Point = readonly [number, number]
type Curve = readonly [Point, Point, Point, Point]
type RibbonController = {
  setVariant(variant: AuthVariant): void
  dispose(): void
}
type RibbonResources = {
  program: WebGLProgram
  buffer: WebGLBuffer
  size: WebGLUniformLocation
  time: WebGLUniformLocation
  admin: WebGLUniformLocation
  vertexCount: number
}

// Keep the approved study's geometry and material together. Side arcs remain static SVG.
const banks: readonly (readonly Curve[])[] = [
  [[[340, 990], [680, 860], [919, 694], [907, 535]], [[907, 535], [897, 424], [676, 407], [683, 285]], [[683, 285], [690, 165], [865, 109], [1114, 70]]],
  [[[340, 990], [754, 946], [1087, 733], [1046, 513]], [[1046, 513], [1026, 398], [810, 351], [800, 281]], [[800, 281], [792, 203], [929, 149], [1114, 70]]],
]

function point(bank: readonly Curve[], t: number): Point {
  const section = Math.min(2, Math.floor(t * 3))
  const k = t * 3 - section
  const u = 1 - k
  const [a, b, c, d] = bank[section]!
  const coordinate = (axis: 0 | 1) => u * u * u * a[axis] + 3 * u * u * k * b[axis] + 3 * u * k * k * c[axis] + k * k * k * d[axis]
  return [coordinate(0), coordinate(1)]
}

function mesh(): Float32Array {
  const count = 192
  const cross = 16
  const rows = Array.from({ length: count + 1 }, (_, i) => ({ a: point(banks[0]!, i / count), b: point(banks[1]!, i / count), s: 0 }))
  let total = 0
  for (let i = 1; i <= count; i++) {
    const a = rows[i]!
    const b = rows[i - 1]!
    total += Math.hypot((a.a[0] + a.b[0] - b.a[0] - b.b[0]) / 2, (a.a[1] + a.b[1] - b.a[1] - b.b[1]) / 2)
    a.s = total
  }
  const out: number[] = []
  function add(i: number, j: number): void {
    const row = rows[i]!
    const n = j / cross
    out.push(row.a[0] + (row.b[0] - row.a[0]) * n, row.a[1] + (row.b[1] - row.a[1]) * n, n, row.s / total)
  }
  for (let i = 0; i < count; i++) {
    for (let j = 0; j < cross; j++) {
      add(i, j)
      add(i + 1, j)
      add(i, j + 1)
      add(i, j + 1)
      add(i + 1, j)
      add(i + 1, j + 1)
    }
  }
  return new Float32Array(out)
}

const vertex = `
attribute vec2 a_position;
attribute vec2 a_uv;
uniform vec2 u_size;
varying vec2 v_uv;
void main() {
  float scale = max(u_size.x / 1440.0, u_size.y / 900.0);
  vec2 p = (a_position - vec2(720.0,450.0))*scale + u_size*.5;
  gl_Position=vec4(p.x/u_size.x*2.0-1.0,1.0-p.y/u_size.y*2.0,0.0,1.0);
  v_uv=a_uv;
}`
const fragment = `
precision highp float;
varying vec2 v_uv;
uniform float u_time;
uniform float u_admin;
float hash(vec2 p) { return fract(sin(dot(p,vec2(127.1,311.7)))*43758.5453123); }
float noise(vec2 p) {
  vec2 i=floor(p), f=fract(p);
  vec2 w=f*f*f*(f*(f*6.0-15.0)+10.0);
  return mix(mix(hash(i),hash(i+vec2(1,0)),w.x),mix(hash(i+vec2(0,1)),hash(i+vec2(1,1)),w.x),w.y);
}
float fbm(vec2 p) {
  float r=0.0, a=.56;
  mat2 turn=mat2(.8,-.6,.6,.8);
  for(int i=0;i<3;i++) { r+=a*noise(p);p=turn*p*1.93+vec2(3.7,7.1);a*=.37; }
  return r;
}
float surface(vec2 p) {
  vec2 bend=vec2(fbm(p*.66+vec2(5.3,8.1)),fbm(p*.71-vec2(3.1,2.4)))-.5;
  return fbm(p+bend*.65);
}
void main() {
  float n=v_uv.x, s=v_uv.y;
  // All scales share the same advection: details travel together, not boil in place.
  vec2 p=vec2(n*2.3,s*5.8-u_time*.20);
  float h=surface(p);
  float dx=(surface(p+vec2(.035,0.0))-h)/.035;
  float dy=(surface(p+vec2(0.0,.035))-h)/.035;
  float light=clamp(.58+dx*.42-dy*.26,.0,1.0);
  float broad=smoothstep(.18,.68,h);
  float refraction=smoothstep(.34,.94,light)*.35;
  vec3 blue=mix(vec3(.57,.71,.90),vec3(.60,.71,.85),u_admin);
  vec3 color=mix(blue,vec3(.97,.99,1.0),clamp(broad*.6+refraction,0.0,1.0));
  float edge=smoothstep(0.0,.035,n)*(1.0-smoothstep(.965,1.0,n));
  float tip=smoothstep(.0,.055,s)*(1.0-smoothstep(.94,1.0,s));
  // A soft across-width envelope avoids a cut-out tube or sharp chrome edge.
  float weight=.65+.35*sin(n*3.14159265);
  float alpha=edge*tip*weight*mix(.39,.36,u_admin);
  gl_FragColor=vec4(color,alpha);
}`

function compile(gl: WebGLRenderingContext, type: number, source: string): WebGLShader {
  const shader = gl.createShader(type)
  if (!shader) throw new Error('Liquid ribbon shader unavailable')
  gl.shaderSource(shader, source)
  gl.compileShader(shader)
  if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) {
    gl.deleteShader(shader)
    throw new Error('Liquid ribbon shader compilation failed')
  }
  return shader
}

function createResources(gl: WebGLRenderingContext): RibbonResources {
  let vertexShader: WebGLShader | null = null
  let fragmentShader: WebGLShader | null = null
  let program: WebGLProgram | null = null
  let buffer: WebGLBuffer | null = null
  try {
    vertexShader = compile(gl, gl.VERTEX_SHADER, vertex)
    fragmentShader = compile(gl, gl.FRAGMENT_SHADER, fragment)
    program = gl.createProgram()
    if (!program) throw new Error('Liquid ribbon program unavailable')
    gl.attachShader(program, vertexShader)
    gl.attachShader(program, fragmentShader)
    gl.linkProgram(program)
    if (!gl.getProgramParameter(program, gl.LINK_STATUS)) throw new Error('Liquid ribbon linking failed')
    gl.useProgram(program)
    const size = gl.getUniformLocation(program, 'u_size')
    const time = gl.getUniformLocation(program, 'u_time')
    const admin = gl.getUniformLocation(program, 'u_admin')
    const pos = gl.getAttribLocation(program, 'a_position')
    const uv = gl.getAttribLocation(program, 'a_uv')
    if (size === null || time === null || admin === null || pos < 0 || uv < 0) throw new Error('Liquid ribbon bindings unavailable')
    const vertices = mesh()
    buffer = gl.createBuffer()
    if (!buffer) throw new Error('Liquid ribbon buffer unavailable')
    gl.bindBuffer(gl.ARRAY_BUFFER, buffer)
    gl.bufferData(gl.ARRAY_BUFFER, vertices, gl.STATIC_DRAW)
    gl.enableVertexAttribArray(pos)
    gl.vertexAttribPointer(pos, 2, gl.FLOAT, false, 16, 0)
    gl.enableVertexAttribArray(uv)
    gl.vertexAttribPointer(uv, 2, gl.FLOAT, false, 16, 8)
    gl.clearColor(0, 0, 0, 0)
    return { program, buffer, size, time, admin, vertexCount: vertices.length / 4 }
  } catch (error) {
    if (buffer) gl.deleteBuffer(buffer)
    if (program) gl.deleteProgram(program)
    throw error
  } finally {
    if (vertexShader) gl.deleteShader(vertexShader)
    if (fragmentShader) gl.deleteShader(fragmentShader)
  }
}

/** Owns only the decorative canvas; it never accesses login fields, routing or APIs. */
export function createLiquidRibbon(
  canvas: HTMLCanvasElement,
  variant: AuthVariant,
  onReady: (ready: boolean) => void,
): RibbonController {
  const reduce = typeof window.matchMedia === 'function' ? window.matchMedia('(prefers-reduced-motion: reduce)') : null
  let reduced = reduce?.matches ?? false
  let currentVariant = variant
  let gl: WebGLRenderingContext | null = null
  let resources: RibbonResources | null = null
  let disposed = false
  let contextLost = false
  let ready = false
  let reportedReady = false
  let raf = 0
  let last = 0
  let time = 18.4
  let width = 0
  let height = 0

  function reportReady(next: boolean): void {
    canvas.dataset.renderer = next ? 'webgl' : 'static-svg'
    if (!reportedReady || ready !== next) {
      ready = next
      reportedReady = true
      onReady(next)
    }
  }

  function updateMotion(): void {
    const motion = disposed || contextLost || !ready ? 'stopped' : reduced ? 'reduced' : document.hidden ? 'hidden' : 'running'
    if (canvas.dataset.motion !== motion) canvas.dataset.motion = motion
  }

  function stop(): void {
    if (raf) cancelAnimationFrame(raf)
    raf = 0
    last = 0
    updateMotion()
  }

  function canDraw(): boolean {
    return !disposed && !contextLost && resources !== null && gl !== null && !gl.isContextLost() && width > 0 && height > 0
  }

  function draw(): boolean {
    if (!canDraw() || !gl || !resources) return false
    gl.clear(gl.COLOR_BUFFER_BIT)
    gl.uniform2f(resources.size, width, height)
    gl.uniform1f(resources.time, time)
    gl.uniform1f(resources.admin, currentVariant === 'admin' ? 1 : 0)
    gl.drawArrays(gl.TRIANGLES, 0, resources.vertexCount)
    return true
  }

  function canAnimate(): boolean {
    return canDraw() && !reduced && !document.hidden
  }

  function loop(now: number): void {
    raf = 0
    if (!canAnimate()) {
      last = 0
      updateMotion()
      return
    }
    const delta = last ? Math.min((now - last) / 1000, .05) : 1 / 60
    last = now
    time += delta
    draw()
    raf = requestAnimationFrame(loop)
  }

  function wake(): void {
    if (!raf && canAnimate()) raf = requestAnimationFrame(loop)
    updateMotion()
  }

  function resize(): void {
    if (disposed || contextLost || !gl || !resources || gl.isContextLost()) return
    width = canvas.clientWidth
    height = canvas.clientHeight
    if (width <= 0 || height <= 0) {
      reportReady(false)
      stop()
      return
    }
    const ratio = Math.min(window.devicePixelRatio || 1, 1.5)
    const pixelWidth = Math.round(width * ratio)
    const pixelHeight = Math.round(height * ratio)
    // Reassigning unchanged dimensions clears the drawing buffer unnecessarily.
    if (canvas.width !== pixelWidth) canvas.width = pixelWidth
    if (canvas.height !== pixelHeight) canvas.height = pixelHeight
    gl.viewport(0, 0, canvas.width, canvas.height)
    if (draw()) reportReady(true)
    wake()
  }

  function freeResources(): void {
    if (gl && resources) {
      gl.deleteBuffer(resources.buffer)
      gl.deleteProgram(resources.program)
    }
    resources = null
  }

  function initialize(): void {
    if (disposed) return
    stop()
    freeResources()
    try {
      gl = canvas.getContext('webgl', {
        alpha: true,
        antialias: true,
        premultipliedAlpha: false,
        preserveDrawingBuffer: true,
        powerPreference: 'low-power',
      })
      if (!gl || gl.isContextLost()) {
        reportReady(false)
        updateMotion()
        return
      }
      resources = createResources(gl)
      resize()
    } catch {
      freeResources()
      reportReady(false)
      stop()
    }
  }

  function onReducedChange(): void {
    if (disposed) return
    reduced = reduce?.matches ?? false
    if (reduced) {
      stop()
      draw()
    } else wake()
  }

  function onVisibilityChange(): void {
    if (document.hidden) stop()
    else resize()
  }

  function onContextLost(event: Event): void {
    if (disposed) return
    event.preventDefault()
    contextLost = true
    // The browser invalidates GPU objects on loss. Restoration creates all of them anew.
    resources = null
    reportReady(false)
    stop()
  }

  function onContextRestored(): void {
    if (disposed) return
    contextLost = false
    initialize()
  }

  reportReady(false)
  updateMotion()
  canvas.addEventListener('webglcontextlost', onContextLost)
  canvas.addEventListener('webglcontextrestored', onContextRestored)
  reduce?.addEventListener('change', onReducedChange)
  document.addEventListener('visibilitychange', onVisibilityChange)
  window.addEventListener('resize', resize)
  const observer = typeof ResizeObserver === 'undefined' ? null : new ResizeObserver(resize)
  observer?.observe(canvas)
  initialize()

  return {
    setVariant(next: AuthVariant): void {
      if (disposed || currentVariant === next) return
      currentVariant = next
      draw()
    },
    dispose(): void {
      if (disposed) return
      disposed = true
      stop()
      observer?.disconnect()
      reduce?.removeEventListener('change', onReducedChange)
      document.removeEventListener('visibilitychange', onVisibilityChange)
      window.removeEventListener('resize', resize)
      canvas.removeEventListener('webglcontextlost', onContextLost)
      canvas.removeEventListener('webglcontextrestored', onContextRestored)
      freeResources()
      // Remove listeners first: releasing this component's context must not trigger restoration.
      gl?.getExtension('WEBGL_lose_context')?.loseContext()
      gl = null
      reportReady(false)
      updateMotion()
    },
  }
}
