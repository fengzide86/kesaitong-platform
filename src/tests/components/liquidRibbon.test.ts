import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createLiquidRibbon } from '@/components/auth/liquidRibbon'

function mockWebGL() {
  const loseContext = vi.fn()
  return {
    VERTEX_SHADER: 35633, FRAGMENT_SHADER: 35632, COMPILE_STATUS: 35713, LINK_STATUS: 35714,
    ARRAY_BUFFER: 34962, STATIC_DRAW: 35044, FLOAT: 5126, COLOR_BUFFER_BIT: 16384, TRIANGLES: 4,
    createShader: vi.fn(() => ({})), shaderSource: vi.fn(), compileShader: vi.fn(),
    getShaderParameter: vi.fn(() => true), deleteShader: vi.fn(),
    createProgram: vi.fn(() => ({})), attachShader: vi.fn(), linkProgram: vi.fn(),
    getProgramParameter: vi.fn(() => true), useProgram: vi.fn(), deleteProgram: vi.fn(),
    getUniformLocation: vi.fn((_program: unknown, name: string) => ({ name })),
    getAttribLocation: vi.fn(() => 0), createBuffer: vi.fn(() => ({})),
    bindBuffer: vi.fn(), bufferData: vi.fn(), deleteBuffer: vi.fn(),
    enableVertexAttribArray: vi.fn(), vertexAttribPointer: vi.fn(), clearColor: vi.fn(),
    clear: vi.fn(), uniform2f: vi.fn(), uniform1f: vi.fn(), drawArrays: vi.fn(),
    viewport: vi.fn(), isContextLost: vi.fn(() => false),
    getExtension: vi.fn(() => ({ loseContext })), loseContext,
  }
}

let reduced: boolean
let hidden: boolean
let media: MediaQueryList
let frames: Map<number, FrameRequestCallback>
let observers: Array<{ callback: ResizeObserverCallback; observe: ReturnType<typeof vi.fn>; disconnect: ReturnType<typeof vi.fn> }>
let controllers: Array<ReturnType<typeof createLiquidRibbon>>

beforeEach(() => {
  reduced = false
  hidden = false
  frames = new Map()
  observers = []
  controllers = []
  let frameId = 0
  const mediaTarget = new EventTarget()
  Object.defineProperty(mediaTarget, 'matches', { get: () => reduced })
  media = mediaTarget as MediaQueryList
  vi.spyOn(media, 'addEventListener')
  vi.spyOn(media, 'removeEventListener')
  vi.stubGlobal('matchMedia', vi.fn(() => media))
  vi.stubGlobal('requestAnimationFrame', vi.fn((callback: FrameRequestCallback) => {
    frames.set(++frameId, callback)
    return frameId
  }))
  vi.stubGlobal('cancelAnimationFrame', vi.fn((id: number) => frames.delete(id)))
  vi.stubGlobal('ResizeObserver', class {
    callback: ResizeObserverCallback
    observe = vi.fn()
    disconnect = vi.fn()
    constructor(callback: ResizeObserverCallback) {
      this.callback = callback
      observers.push(this)
    }
  })
  vi.spyOn(document, 'hidden', 'get').mockImplementation(() => hidden)
})

afterEach(() => {
  for (const controller of controllers) controller.dispose()
  vi.restoreAllMocks()
  vi.unstubAllGlobals()
})

function createScene(gl: ReturnType<typeof mockWebGL> | null = mockWebGL()) {
  const canvas = document.createElement('canvas')
  let width = 1440
  let height = 900
  Object.defineProperties(canvas, {
    clientWidth: { get: () => width },
    clientHeight: { get: () => height },
  })
  vi.spyOn(canvas, 'getContext').mockReturnValue(gl as unknown as WebGLRenderingContext | null)
  const onReady = vi.fn()
  const controller = createLiquidRibbon(canvas, 'consumer', onReady)
  controllers.push(controller)
  return {
    canvas, gl, onReady, controller,
    resize(nextWidth: number, nextHeight: number) {
      width = nextWidth
      height = nextHeight
      window.dispatchEvent(new Event('resize'))
    },
  }
}

function advanceFrame(now: number) {
  expect(frames.size).toBe(1)
  const [id, callback] = [...frames.entries()][0]!
  frames.delete(id)
  callback(now)
}

describe('liquidRibbon lifecycle', () => {
  it('无 WebGL 时保持静态 SVG 后备，不申请动画帧', () => {
    const { canvas, onReady, controller } = createScene(null)
    expect(onReady.mock.calls).toEqual([[false]])
    expect(canvas.dataset.renderer).toBe('static-svg')
    expect(frames.size).toBe(0)
    controller.setVariant('admin')
    controller.dispose()
    controller.dispose()
    expect(frames.size).toBe(0)
  })

  it('shader 编译失败时释放资源并保持静态，不把初始化失败报告为就绪', () => {
    const gl = mockWebGL()
    gl.getShaderParameter.mockReturnValue(false)
    const { onReady, canvas } = createScene(gl)
    expect(gl.deleteShader).toHaveBeenCalledTimes(1)
    expect(onReady.mock.calls).toEqual([[false]])
    expect(canvas.dataset.renderer).toBe('static-svg')
    expect(frames.size).toBe(0)
  })

  it('首帧绘制成功后才报告就绪，循环只保留一个 RAF 且材料时间向前推进', () => {
    const { gl, canvas, onReady } = createScene()
    expect(onReady.mock.calls).toEqual([[false], [true]])
    expect(gl!.drawArrays).toHaveBeenCalledTimes(1)
    expect(canvas.dataset.renderer).toBe('webgl')
    expect(canvas.dataset.motion).toBe('running')
    advanceFrame(1000)
    advanceFrame(1040)
    expect(frames.size).toBe(1)
    const times = gl!.uniform1f.mock.calls.filter(([location]) => location.name === 'u_time').map(([, value]) => value)
    expect(times[1]).toBeGreaterThan(times[0])
    expect(times[2]).toBeGreaterThan(times[1])
  })

  it('端类型变化仅更新 shader 参数，不重新创建程序或动画循环', () => {
    const { gl, controller } = createScene()
    controller.setVariant('admin')
    expect(gl!.uniform1f).toHaveBeenLastCalledWith({ name: 'u_admin' }, 1)
    const draws = gl!.drawArrays.mock.calls.length
    controller.setVariant('admin')
    expect(gl!.drawArrays).toHaveBeenCalledTimes(draws)
    controller.setVariant('consumer')
    expect(gl!.uniform1f).toHaveBeenLastCalledWith({ name: 'u_admin' }, 0)
    expect(gl!.createProgram).toHaveBeenCalledTimes(1)
    expect(frames.size).toBe(1)
  })

  it('初始 reduced-motion 只绘制静态一帧，不启动 RAF', () => {
    reduced = true
    const { gl, canvas } = createScene()
    expect(gl!.drawArrays).toHaveBeenCalledTimes(1)
    expect(canvas.dataset.motion).toBe('reduced')
    expect(frames.size).toBe(0)
    expect(requestAnimationFrame).not.toHaveBeenCalled()
  })

  it('系统偏好切到 reduce 时立即停帧，恢复偏好后只启动一个循环', () => {
    const { canvas } = createScene()
    reduced = true
    media.dispatchEvent(new Event('change'))
    expect(frames.size).toBe(0)
    expect(cancelAnimationFrame).toHaveBeenCalledTimes(1)
    expect(canvas.dataset.motion).toBe('reduced')
    reduced = false
    media.dispatchEvent(new Event('change'))
    media.dispatchEvent(new Event('change'))
    expect(frames.size).toBe(1)
    expect(canvas.dataset.motion).toBe('running')
  })

  it('隐藏页面暂停循环，再次可见时恢复但不会补算后台经过的时间', () => {
    const { canvas, gl } = createScene()
    advanceFrame(1000)
    hidden = true
    document.dispatchEvent(new Event('visibilitychange'))
    expect(frames.size).toBe(0)
    expect(canvas.dataset.motion).toBe('hidden')
    hidden = false
    document.dispatchEvent(new Event('visibilitychange'))
    advanceFrame(60_000)
    const times = gl!.uniform1f.mock.calls.filter(([location]) => location.name === 'u_time').map(([, value]) => value)
    expect(times.at(-1)! - times.at(-2)!).toBeCloseTo(1 / 60)
    expect(frames.size).toBe(1)
  })

  it('context lost 立即退回 SVG，恢复后重建 GPU 资源和单个循环', () => {
    const { canvas, gl, onReady } = createScene()
    const lost = new Event('webglcontextlost', { cancelable: true })
    canvas.dispatchEvent(lost)
    expect(lost.defaultPrevented).toBe(true)
    expect(onReady).toHaveBeenLastCalledWith(false)
    expect(canvas.dataset.renderer).toBe('static-svg')
    expect(frames.size).toBe(0)
    canvas.dispatchEvent(new Event('webglcontextrestored'))
    expect(gl!.createProgram).toHaveBeenCalledTimes(2)
    expect(onReady).toHaveBeenLastCalledWith(true)
    expect(frames.size).toBe(1)
  })

  it('画布为零尺寸时停帧，恢复尺寸后重绘，并限制高 DPR 像素开销', () => {
    vi.spyOn(window, 'devicePixelRatio', 'get').mockReturnValue(3)
    const scene = createScene()
    expect(scene.canvas.width).toBe(2160)
    expect(scene.canvas.height).toBe(1350)
    scene.resize(0, 0)
    expect(frames.size).toBe(0)
    expect(scene.onReady).toHaveBeenLastCalledWith(false)
    scene.resize(1024, 640)
    expect(scene.canvas.width).toBe(1536)
    expect(scene.canvas.height).toBe(960)
    expect(scene.onReady).toHaveBeenLastCalledWith(true)
    expect(frames.size).toBe(1)
  })

  it('dispose 幂等释放 RAF、监听器、观察器及 GPU，卸载后的事件不重新绘制', () => {
    const docRemove = vi.spyOn(document, 'removeEventListener')
    const winRemove = vi.spyOn(window, 'removeEventListener')
    const { canvas, gl, controller } = createScene()
    const canvasRemove = vi.spyOn(canvas, 'removeEventListener')
    const draws = gl!.drawArrays.mock.calls.length
    controller.dispose()
    controller.dispose()
    expect(frames.size).toBe(0)
    expect(observers[0]!.disconnect).toHaveBeenCalledTimes(1)
    expect(media.removeEventListener).toHaveBeenCalledWith('change', expect.any(Function))
    expect(docRemove).toHaveBeenCalledWith('visibilitychange', expect.any(Function))
    expect(winRemove).toHaveBeenCalledWith('resize', expect.any(Function))
    expect(canvasRemove).toHaveBeenCalledWith('webglcontextlost', expect.any(Function))
    expect(canvasRemove).toHaveBeenCalledWith('webglcontextrestored', expect.any(Function))
    expect(gl!.deleteBuffer).toHaveBeenCalledTimes(1)
    expect(gl!.deleteProgram).toHaveBeenCalledTimes(1)
    expect(gl!.loseContext).toHaveBeenCalledTimes(1)
    media.dispatchEvent(new Event('change'))
    document.dispatchEvent(new Event('visibilitychange'))
    window.dispatchEvent(new Event('resize'))
    canvas.dispatchEvent(new Event('webglcontextrestored'))
    controller.setVariant('admin')
    expect(gl!.drawArrays).toHaveBeenCalledTimes(draws)
    expect(gl!.createProgram).toHaveBeenCalledTimes(1)
    expect(frames.size).toBe(0)
  })
})
