/**
 * WebGL2 compositor: room photo + rugs (+ shadows), in back-to-front order.
 *
 * One instance drives the on-screen canvas; a second, temporary instance renders
 * the export at full resolution. Coordinates are always image pixels, so the same
 * scene description renders identically in both.
 */
import type { Corners, Mat3 } from '../../types'

import { imageToTexture } from '../geometry/rugGeometry'
import { ROOM_FRAGMENT, RUG_FRAGMENT, SHADOW_FRAGMENT, VERTEX } from './shaders'

export interface RenderRug {
  textureKey: string
  corners: Corners // image px
  shadowCorners: Corners // image px (expanded quad)
  shadowSoft: [number, number]
  round: boolean
  opacity: number
}

/** Floor lighting from the backend (`analysis.lighting`), decoded. */
export interface Lighting {
  /** Shading map; texel value / 255 · `scale` = shading factor (1 = typical floor light). */
  shading: TexImageSource
  scale: number
  /** Scene light colour, linear RGB, mean 1. */
  illuminant: [number, number, number]
}

export interface RenderOptions {
  shadows: boolean
  lighting: boolean
  occlusion: boolean
}

export interface View {
  x: number
  y: number
  w: number
  h: number
}

type Program = { program: WebGLProgram; uniforms: Map<string, WebGLUniformLocation | null> }

export class Compositor {
  readonly gl: WebGL2RenderingContext
  private room: Program
  private rug: Program
  private shadow: Program
  private vao: WebGLVertexArrayObject
  private vbo: WebGLBuffer
  private roomTex: WebGLTexture | null = null
  private maskTex: WebGLTexture
  private lightTex: WebGLTexture
  private lightScale = 1
  private illuminant: [number, number, number] = [1, 1, 1]
  private rugTextures = new Map<string, WebGLTexture>()
  private imageSize: [number, number] = [1, 1]
  private hasMask = false
  private anisotropy: { ext: EXT_texture_filter_anisotropic; max: number } | null = null

  constructor(canvas: HTMLCanvasElement, opts: { preserveDrawingBuffer?: boolean } = {}) {
    const gl = canvas.getContext('webgl2', {
      premultipliedAlpha: true,
      antialias: true,
      preserveDrawingBuffer: opts.preserveDrawingBuffer ?? false,
    })
    if (!gl) throw new Error('WebGL2 is not supported on this device')
    this.gl = gl

    this.room = this.createProgram(VERTEX, ROOM_FRAGMENT)
    this.rug = this.createProgram(VERTEX, RUG_FRAGMENT)
    this.shadow = this.createProgram(VERTEX, SHADOW_FRAGMENT)

    this.vbo = gl.createBuffer()!
    this.vao = gl.createVertexArray()!
    gl.bindVertexArray(this.vao)
    gl.bindBuffer(gl.ARRAY_BUFFER, this.vbo)
    gl.bufferData(gl.ARRAY_BUFFER, 12 * 4, gl.DYNAMIC_DRAW)
    for (const p of [this.room, this.rug, this.shadow]) {
      const loc = gl.getAttribLocation(p.program, 'aPos')
      gl.enableVertexAttribArray(loc)
      gl.vertexAttribPointer(loc, 2, gl.FLOAT, false, 0, 0)
    }

    const ext = gl.getExtension('EXT_texture_filter_anisotropic')
    if (ext) this.anisotropy = { ext, max: Math.min(8, gl.getParameter(ext.MAX_TEXTURE_MAX_ANISOTROPY_EXT)) }

    // 1x1 defaults so samplers are always valid.
    this.maskTex = this.createScalarTexture(new Uint8Array([255]), 1, 1)
    this.lightTex = this.createScalarTexture(new Uint8Array([255]), 1, 1)
  }

  // ----------------------------------------------------------------- resources

  private createProgram(vs: string, fs: string): Program {
    const gl = this.gl
    const compile = (type: number, src: string) => {
      const s = gl.createShader(type)!
      gl.shaderSource(s, src)
      gl.compileShader(s)
      if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) throw new Error(gl.getShaderInfoLog(s) ?? 'shader error')
      return s
    }
    const program = gl.createProgram()!
    gl.attachShader(program, compile(gl.VERTEX_SHADER, vs))
    gl.attachShader(program, compile(gl.FRAGMENT_SHADER, fs))
    gl.bindAttribLocation(program, 0, 'aPos')
    gl.linkProgram(program)
    if (!gl.getProgramParameter(program, gl.LINK_STATUS)) throw new Error(gl.getProgramInfoLog(program) ?? 'link error')
    return { program, uniforms: new Map() }
  }

  private loc(p: Program, name: string) {
    if (!p.uniforms.has(name)) p.uniforms.set(name, this.gl.getUniformLocation(p.program, name))
    return p.uniforms.get(name)!
  }

  private createImageTexture(source: TexImageSource, mipmaps: boolean): WebGLTexture {
    const gl = this.gl
    const tex = gl.createTexture()!
    gl.bindTexture(gl.TEXTURE_2D, tex)
    gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, true)
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, source)
    gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, false)
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE)
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE)
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR)
    if (mipmaps) {
      gl.generateMipmap(gl.TEXTURE_2D)
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR_MIPMAP_LINEAR)
      if (this.anisotropy) gl.texParameterf(gl.TEXTURE_2D, this.anisotropy.ext.TEXTURE_MAX_ANISOTROPY_EXT, this.anisotropy.max)
    } else {
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR)
    }
    return tex
  }

  private createScalarTexture(data: Uint8Array, w: number, h: number): WebGLTexture {
    const gl = this.gl
    const tex = gl.createTexture()!
    gl.bindTexture(gl.TEXTURE_2D, tex)
    gl.pixelStorei(gl.UNPACK_ALIGNMENT, 1)
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.R8, w, h, 0, gl.RED, gl.UNSIGNED_BYTE, data)
    gl.pixelStorei(gl.UNPACK_ALIGNMENT, 4)
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR)
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR)
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE)
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE)
    return tex
  }

  /** Room photo. `width`/`height` define the image coordinate space (texture may be larger). */
  setRoom(source: TexImageSource, width: number, height: number) {
    if (this.roomTex) this.gl.deleteTexture(this.roomTex)
    this.roomTex = this.createImageTexture(source, true)
    this.imageSize = [width, height]
  }

  /** Occlusion alpha (floor = 255): rugs and their shadows only show where it is bright. */
  setMask(source: TexImageSource | null) {
    this.gl.deleteTexture(this.maskTex)
    this.hasMask = !!source
    this.maskTex = source ? this.createImageTexture(source, false) : this.createScalarTexture(new Uint8Array([255]), 1, 1)
  }

  /** Floor shading + illuminant. null = neutral light (shading 1, white). */
  setLighting(lighting: Lighting | null) {
    this.gl.deleteTexture(this.lightTex)
    if (lighting) {
      this.lightTex = this.createImageTexture(lighting.shading, false)
      this.lightScale = lighting.scale
      this.illuminant = lighting.illuminant
    } else {
      this.lightTex = this.createScalarTexture(new Uint8Array([255]), 1, 1)
      this.lightScale = 1
      this.illuminant = [1, 1, 1]
    }
  }

  hasRugTexture(key: string) {
    return this.rugTextures.has(key)
  }

  setRugTexture(key: string, source: TexImageSource) {
    const old = this.rugTextures.get(key)
    if (old) this.gl.deleteTexture(old)
    this.rugTextures.set(key, this.createImageTexture(source, true))
  }

  // ----------------------------------------------------------------- drawing

  private drawQuad(c: Corners) {
    const gl = this.gl
    const { topLeft: a, topRight: b, bottomRight: d, bottomLeft: e } = c
    gl.bindBuffer(gl.ARRAY_BUFFER, this.vbo)
    gl.bufferSubData(gl.ARRAY_BUFFER, 0, new Float32Array([a.x, a.y, b.x, b.y, d.x, d.y, a.x, a.y, d.x, d.y, e.x, e.y]))
    gl.drawArrays(gl.TRIANGLES, 0, 6)
  }

  private bindCommon(p: Program, view: View) {
    const gl = this.gl
    gl.useProgram(p.program)
    gl.uniform4f(this.loc(p, 'uView'), view.x, view.y, view.w, view.h)
    gl.uniform2f(this.loc(p, 'uImageSize'), this.imageSize[0], this.imageSize[1])
  }

  private bindTexture(p: Program, name: string, unit: number, tex: WebGLTexture) {
    const gl = this.gl
    gl.activeTexture(gl.TEXTURE0 + unit)
    gl.bindTexture(gl.TEXTURE_2D, tex)
    gl.uniform1i(this.loc(p, name), unit)
  }

  /** Inverse of the unit-square -> image homography, as a row-major mat3 uniform. */
  private setInvH(p: Program, corners: Corners): boolean {
    let inv: Mat3
    try {
      inv = imageToTexture(corners)
    } catch {
      return false // degenerate quad: skip
    }
    this.gl.uniformMatrix3fv(this.loc(p, 'uInvH'), true, new Float32Array(inv))
    return true
  }

  render(rugs: RenderRug[], view: View, options: RenderOptions, background: [number, number, number] = [0.1, 0.1, 0.11]) {
    const gl = this.gl
    const canvas = gl.canvas as HTMLCanvasElement
    gl.viewport(0, 0, canvas.width, canvas.height)
    gl.clearColor(background[0], background[1], background[2], 1)
    gl.clear(gl.COLOR_BUFFER_BIT)
    if (!this.roomTex) return

    gl.bindVertexArray(this.vao)
    gl.enable(gl.BLEND)
    gl.blendFunc(gl.ONE, gl.ONE_MINUS_SRC_ALPHA) // premultiplied alpha

    // 1. Room
    this.bindCommon(this.room, view)
    this.bindTexture(this.room, 'uRoom', 0, this.roomTex)
    const [w, h] = this.imageSize
    this.drawQuad({ topLeft: { x: 0, y: 0 }, topRight: { x: w, y: 0 }, bottomRight: { x: w, y: h }, bottomLeft: { x: 0, y: h } })

    const useMask = options.occlusion && this.hasMask ? 1 : 0

    for (const rug of rugs) {
      // 2. Shadow under this rug (also darkens rugs below it, as a real one would).
      if (options.shadows) {
        this.bindCommon(this.shadow, view)
        if (this.setInvH(this.shadow, rug.shadowCorners)) {
          this.bindTexture(this.shadow, 'uMask', 1, this.maskTex)
          gl.uniform2f(this.loc(this.shadow, 'uSoft'), rug.shadowSoft[0], rug.shadowSoft[1])
          gl.uniform1f(this.loc(this.shadow, 'uRound'), rug.round ? 1 : 0)
          gl.uniform1f(this.loc(this.shadow, 'uStrength'), 0.38 * rug.opacity)
          gl.uniform1f(this.loc(this.shadow, 'uUseMask'), useMask)
          this.drawQuad(rug.shadowCorners)
        }
      }

      // 3. Rug
      const tex = this.rugTextures.get(rug.textureKey)
      if (!tex) continue
      this.bindCommon(this.rug, view)
      if (!this.setInvH(this.rug, rug.corners)) continue
      this.bindTexture(this.rug, 'uTex', 0, tex)
      this.bindTexture(this.rug, 'uMask', 1, this.maskTex)
      this.bindTexture(this.rug, 'uLight', 2, this.lightTex)
      gl.uniform1f(this.loc(this.rug, 'uOpacity'), rug.opacity)
      gl.uniform1f(this.loc(this.rug, 'uUseMask'), useMask)
      gl.uniform1f(this.loc(this.rug, 'uLightStrength'), options.lighting ? 1 : 0)
      gl.uniform1f(this.loc(this.rug, 'uLightScale'), this.lightScale)
      gl.uniform3f(this.loc(this.rug, 'uIlluminant'), ...this.illuminant)
      this.drawQuad(rug.corners)
    }
  }

  dispose() {
    const gl = this.gl
    for (const t of this.rugTextures.values()) gl.deleteTexture(t)
    if (this.roomTex) gl.deleteTexture(this.roomTex)
    gl.deleteTexture(this.maskTex)
    gl.deleteTexture(this.lightTex)
    gl.deleteBuffer(this.vbo)
    gl.deleteVertexArray(this.vao)
    for (const p of [this.room, this.rug, this.shadow]) gl.deleteProgram(p.program)
  }
}
