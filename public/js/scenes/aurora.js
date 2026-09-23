// Procedural aurora — a hand-written WebGL1 fragment shader on a fullscreen
// triangle, ~60 lines of GLSL, no textures, no libraries. Only the dark
// themes at real Icelandic night get it (AmbienceEngine gates on
// --scene-aurora, sun phase and cloud cover). Frame-capped to ~30fps; if
// WebGL is missing or the context dies, the caller falls back to the CSS
// gradient ribbon (.ice-aurora--css in iceland-scene.css).
const VERT = `
attribute vec2 p;
void main() { gl_Position = vec4(p, 0.0, 1.0); }
`;

const FRAG = `
precision mediump float;
uniform vec2 u_res;
uniform float u_time;

// Hash-based value noise, 2 octaves — enough wobble for a ribbon.
float hash(vec2 v) { return fract(sin(dot(v, vec2(127.1, 311.7))) * 43758.5453); }
float noise(vec2 v) {
  vec2 i = floor(v), f = fract(v);
  vec2 u = f * f * (3.0 - 2.0 * f);
  return mix(mix(hash(i), hash(i + vec2(1, 0)), u.x),
             mix(hash(i + vec2(0, 1)), hash(i + vec2(1, 1)), u.x), u.y);
}
float fbm(vec2 v) { return 0.65 * noise(v) + 0.35 * noise(v * 2.3); }

void main() {
  vec2 uv = gl_FragCoord.xy / u_res;
  // The ribbon's spine wanders slowly across the upper third.
  float spine = 0.68 + 0.10 * fbm(vec2(uv.x * 1.8, u_time * 0.03));
  float band = smoothstep(0.22, 0.0, abs(uv.y - spine));
  // Vertical curtain rays.
  band *= 0.45 + 0.55 * fbm(vec2(uv.x * 34.0, u_time * 0.11));
  // Green core shading into teal-blue at the top.
  vec3 col = mix(vec3(0.16, 0.85, 0.45), vec3(0.18, 0.6, 0.85), (uv.y - spine) * 3.0 + 0.5);
  gl_FragColor = vec4(col, band * 0.5);
}
`;

export class Aurora {
  constructor(canvas) {
    this.canvas = canvas;
    this.gl = canvas.getContext('webgl', { alpha: true, antialias: false, depth: false });
    this._raf = null;
    this._last = 0;
    this._t0 = performance.now();
    this.dead = !this.gl;
    if (this.dead) return;
    this._lost = () => { this.stop(); this.dead = true; };
    canvas.addEventListener('webglcontextlost', this._lost);
    this._build();
  }

  _build() {
    const gl = this.gl;
    const sh = (type, src) => {
      const s = gl.createShader(type);
      gl.shaderSource(s, src);
      gl.compileShader(s);
      if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) throw new Error(gl.getShaderInfoLog(s) || 'shader');
      return s;
    };
    try {
      const prog = gl.createProgram();
      gl.attachShader(prog, sh(gl.VERTEX_SHADER, VERT));
      gl.attachShader(prog, sh(gl.FRAGMENT_SHADER, FRAG));
      gl.linkProgram(prog);
      if (!gl.getProgramParameter(prog, gl.LINK_STATUS)) throw new Error('link');
      gl.useProgram(prog);
      // One triangle that covers the viewport.
      const buf = gl.createBuffer();
      gl.bindBuffer(gl.ARRAY_BUFFER, buf);
      gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 3, -1, -1, 3]), gl.STATIC_DRAW);
      const loc = gl.getAttribLocation(prog, 'p');
      gl.enableVertexAttribArray(loc);
      gl.vertexAttribPointer(loc, 2, gl.FLOAT, false, 0, 0);
      this.uRes = gl.getUniformLocation(prog, 'u_res');
      this.uTime = gl.getUniformLocation(prog, 'u_time');
      gl.enable(gl.BLEND);
      gl.blendFunc(gl.SRC_ALPHA, gl.ONE); // additive — light on the sky
    } catch {
      this.dead = true;
    }
  }

  start() {
    if (this.dead || this._raf) return;
    this.canvas.hidden = false;
    const tick = (now) => {
      this._raf = requestAnimationFrame(tick);
      if (now - this._last < 33) return; // ~30fps is plenty for sky light
      this._last = now;
      const gl = this.gl;
      const w = this.canvas.clientWidth, h = this.canvas.clientHeight;
      if (this.canvas.width !== w || this.canvas.height !== h) {
        this.canvas.width = w; this.canvas.height = h;
        gl.viewport(0, 0, w, h);
      }
      gl.clearColor(0, 0, 0, 0);
      gl.clear(gl.COLOR_BUFFER_BIT);
      gl.uniform2f(this.uRes, w, h);
      gl.uniform1f(this.uTime, (now - this._t0) / 1000);
      gl.drawArrays(gl.TRIANGLES, 0, 3);
    };
    this._raf = requestAnimationFrame(tick);
  }

  stop() {
    if (this._raf) cancelAnimationFrame(this._raf);
    this._raf = null;
    if (this.canvas) this.canvas.hidden = true;
  }

  destroy() {
    this.stop();
    this.canvas?.removeEventListener('webglcontextlost', this._lost);
  }
}
