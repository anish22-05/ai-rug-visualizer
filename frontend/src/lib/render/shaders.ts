/**
 * GLSL (WebGL2) programs.
 *
 * All geometry is specified in *image pixel* coordinates. The vertex shader maps
 * the visible image rectangle (uView = x, y, w, h) to clip space, so panning and
 * zooming is just a different uView.
 */

export const VERTEX = /* glsl */ `#version 300 es
in vec2 aPos;           // image pixels
uniform vec4 uView;     // visible image rect: x, y, w, h
out vec2 vImg;
void main() {
  vImg = aPos;
  vec2 ndc = (aPos - uView.xy) / uView.zw * 2.0 - 1.0;
  gl_Position = vec4(ndc.x, -ndc.y, 0.0, 1.0);
}`

export const ROOM_FRAGMENT = /* glsl */ `#version 300 es
precision highp float;
in vec2 vImg;
uniform sampler2D uRoom;
uniform vec2 uImageSize;
out vec4 outColor;
void main() {
  outColor = texture(uRoom, vImg / uImageSize);
}`

/**
 * Rug: perspective-correct texture mapping via the inverse homography.
 * For each pixel p (image px), uv = H⁻¹·p maps back into the rug texture's unit square.
 * This is exact. Interpolating uv across two triangles (affine) would show a visible
 * seam along the diagonal.
 */
export const RUG_FRAGMENT = /* glsl */ `#version 300 es
precision highp float;
in vec2 vImg;
uniform mat3 uInvH;          // image px -> rug uv
uniform sampler2D uTex;      // rug texture (premultiplied alpha)
uniform sampler2D uMask;     // soft occlusion alpha (1 = floor, rug visible)
uniform sampler2D uLight;    // floor shading / uLightScale
uniform float uLightScale;
uniform vec3 uIlluminant;    // scene light colour (linear, mean 1)
uniform vec2 uImageSize;
uniform float uOpacity;
uniform float uUseMask;
uniform float uLightStrength;
out vec4 outColor;

vec3 toLinear(vec3 c) { return mix(c / 12.92, pow((c + 0.055) / 1.055, vec3(2.4)), step(0.04045, c)); }
vec3 toSrgb(vec3 c) { return mix(c * 12.92, 1.055 * pow(c, vec3(1.0 / 2.4)) - 0.055, step(0.0031308, c)); }

void main() {
  // Rugs only exist inside the photo: never paint onto the letterbox around it.
  if (any(lessThan(vImg, vec2(0.0))) || any(greaterThan(vImg, uImageSize))) discard;
  vec3 q = uInvH * vec3(vImg, 1.0);
  vec2 uv = q.xy / q.z;
  if (q.z <= 0.0 || uv.x < 0.0 || uv.x > 1.0 || uv.y < 0.0 || uv.y > 1.0) discard;
  vec4 c = texture(uTex, uv);

  // Lighting, in linear light: albedo · floor shading · scene illuminant.
  // The texture is premultiplied, so un-premultiply around the transfer curve.
  vec2 st = vImg / uImageSize;
  float shade = texture(uLight, st).r * uLightScale;
  vec3 gain = mix(vec3(1.0), shade * uIlluminant, uLightStrength);
  vec3 albedo = c.a > 0.0 ? c.rgb / c.a : vec3(0.0);
  c.rgb = toSrgb(clamp(toLinear(albedo) * gain, 0.0, 1.0)) * c.a;

  // Occlusion: furniture standing on the floor is "not floor" in the alpha, so the
  // rug disappears behind stool legs, table bases, sofa skirts, etc. The backend has
  // already edge-snapped (guided filter) and tightened the alpha: sample it directly.
  float floorMask = mix(1.0, texture(uMask, st).r, uUseMask);
  outColor = c * (uOpacity * floorMask);
}`

/** Soft contact shadow: a feathered dark quad slightly larger than the rug. */
export const SHADOW_FRAGMENT = /* glsl */ `#version 300 es
precision highp float;
in vec2 vImg;
uniform mat3 uInvH;          // image px -> shadow unit square
uniform sampler2D uMask;
uniform vec2 uImageSize;
uniform vec2 uSoft;          // feather width in uv units (x, y)
uniform float uRound;        // 1 for round rugs
uniform float uStrength;
uniform float uUseMask;
out vec4 outColor;
void main() {
  if (any(lessThan(vImg, vec2(0.0))) || any(greaterThan(vImg, uImageSize))) discard;
  vec3 q = uInvH * vec3(vImg, 1.0);
  vec2 uv = q.xy / q.z;
  if (q.z <= 0.0) discard;
  float a;
  if (uRound > 0.5) {
    float r = length(uv - 0.5) * 2.0;
    a = 1.0 - smoothstep(1.0 - 2.0 * uSoft.x, 1.0, r);
  } else {
    vec2 d = min(uv, 1.0 - uv);
    a = smoothstep(0.0, uSoft.x, d.x) * smoothstep(0.0, uSoft.y, d.y);
  }
  float floorMask = mix(1.0, texture(uMask, vImg / uImageSize).r, uUseMask);
  outColor = vec4(0.0, 0.0, 0.0, a * uStrength * floorMask);
}`
