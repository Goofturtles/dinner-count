// Dinner Count landing: the WebGL stage. Physically based: the Blender table scene with PBR materials,
// an environment map for reflections, one warm key light casting real soft shadows (tiered), baked
// contact-shadow decals, a baked camera scrubbed by progress, steam + motes, then a small post chain
// (depth-of-field from two blur levels, grade, AgX tone mapping, vignette, grain).
// Choreography lives in main.js; this file only draws what the frame state says.
import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { DRACOLoader } from 'three/addons/loaders/DRACOLoader.js';

const FPS = 24;                       // the Blender scene's frame rate (camera clip is 240 frames = 10 s)

// ------------------------------------------------------------------ procedural textures (zero bytes)
function canvasTex(size, draw) {
  const c = document.createElement('canvas'); c.width = c.height = size;
  draw(c.getContext('2d'), size);
  const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace;
  return t;
}
function puffTexture() {
  return canvasTex(128, (g, s) => {
    const r = s / 2;
    for (let i = 0; i < 14; i++) {
      const a = i * 2.4, d = r * .28 * ((i * 7) % 5) / 5;
      const x = r + Math.cos(a) * d, y = r + Math.sin(a) * d * .8;
      const gr = g.createRadialGradient(x, y, 0, x, y, r * (.35 + .25 * ((i * 3) % 4) / 4));
      gr.addColorStop(0, 'rgba(255,255,255,.2)'); gr.addColorStop(1, 'rgba(255,255,255,0)');
      g.fillStyle = gr; g.fillRect(0, 0, s, s);
    }
  });
}
// A tiny studio for reflections: dark room, a warm window, an overhead strip, a warm rim, a wood bounce.
// Built in code and prefiltered once (PMREM), so polished steel and glazed ceramic have something to mirror.
function studioScene() {
  const s = new THREE.Scene();
  const room = new THREE.Mesh(new THREE.BoxGeometry(10, 6, 10), new THREE.MeshBasicMaterial({ color: new THREE.Color('#15110E'), side: THREE.BackSide }));
  room.position.y = 2; s.add(room);
  const panel = (w, h, hex, k, pos, look) => {
    const m = new THREE.Mesh(new THREE.PlaneGeometry(w, h), new THREE.MeshBasicMaterial({ color: new THREE.Color(hex).multiplyScalar(k), side: THREE.DoubleSide }));
    m.position.set(...pos); m.lookAt(...look); s.add(m);
  };
  panel(4.5, 2.6, '#FFE7CF', 8, [-4.8, 2.1, -1.5], [0, 1.2, 0]);   // window, left-back
  panel(3.2, .5, '#FFFFFF', 12, [0, 4.8, -.5], [0, 0, 0]);        // overhead strip
  panel(1.6, 2.4, '#FFB37A', 5, [4.6, 1.6, -3.2], [0, 1, 0]);      // warm rim, right-back
  panel(7, 2.8, '#FFEEDD', 2.6, [0, 1.6, 4.9], [0, 1.2, 0]);       // bright wall behind the camera (what steel mirrors)
  panel(1.4, 1.4, '#FFFFFF', 9, [-1.8, 2.2, 4.8], [0, 1, 0]);       // a softbox catchlight
  panel(10, 10, '#5A3A22', .9, [0, -.95, 0], [0, 1, 0]);           // table bounce
  return s;
}
function dotTexture() {
  return canvasTex(64, (g, s) => {
    const gr = g.createRadialGradient(s / 2, s / 2, 0, s / 2, s / 2, s / 2);
    gr.addColorStop(0, 'rgba(255,255,255,1)'); gr.addColorStop(.35, 'rgba(255,255,255,.55)'); gr.addColorStop(1, 'rgba(255,255,255,0)');
    g.fillStyle = gr; g.fillRect(0, 0, s, s);
  });
}

// ------------------------------------------------------------------ shader snippets
const NOISE = /* glsl */`
float dcHash(vec2 p){ p = fract(p*vec2(123.34, 456.21)); p += dot(p, p+45.32); return fract(p.x*p.y); }
float dcNoise(vec2 p){ vec2 i=floor(p), f=fract(p); vec2 u=f*f*(3.-2.*f);
  return mix(mix(dcHash(i),dcHash(i+vec2(1,0)),u.x), mix(dcHash(i+vec2(0,1)),dcHash(i+vec2(1,1)),u.x), u.y); }
float dcFbm(vec2 p){ float v=0., a=.5; for(int i=0;i<5;i++){ v+=a*dcNoise(p); p*=2.03; a*=.5; } return v; }`;
const BG = /* glsl */`
uniform vec3 uBgA, uBgB; uniform vec2 uRes, uBgC;
vec3 bgAt(vec2 frag){ vec2 d = (frag/uRes - uBgC) * vec2(uRes.x/uRes.y, 1.); return mix(uBgA, uBgB, smoothstep(0., 1.05, length(d))); }`;
const FS_VERT = /* glsl */`varying vec2 vUv; void main(){ vUv = uv; gl_Position = vec4(position.xy, 0., 1.); }`;

// Physical defaults, used when the GLB carries no materials of its own.
const DEFAULTS = {
  ceramic: () => new THREE.MeshPhysicalMaterial({ color: '#F2EEE7', roughness: .3, clearcoat: .5, clearcoatRoughness: .07, envMapIntensity: 1.3 }),
  steel: () => new THREE.MeshPhysicalMaterial({ color: '#E9E5DF', metalness: 1, roughness: .2, envMapIntensity: 2.6 }),
  pasta: () => new THREE.MeshStandardMaterial({ color: '#E0A456', roughness: .55 }),
  rice: () => new THREE.MeshStandardMaterial({ color: '#F3EFE6', roughness: .6 }),
};
const KIND = (n) => /^plate|bowl/.test(n) ? 'ceramic' : /^pot/.test(n) ? 'steel' : n === 'pasta' ? 'pasta' : n === 'rice' ? 'rice' : null;

export class Stage {
  constructor(canvas) {
    this.canvas = canvas;
    const r = this.renderer = new THREE.WebGLRenderer({ canvas, antialias: false, alpha: false, powerPreference: 'high-performance', stencil: false });
    r.outputColorSpace = THREE.SRGBColorSpace;
    r.toneMapping = THREE.AgXToneMapping;
    r.toneMappingExposure = 1;
    r.shadowMap.enabled = true;
    r.shadowMap.type = THREE.VSMShadowMap;   // soft, blurred key-light shadows
    r.setClearColor(0x14110e, 1);
    this.scene = new THREE.Scene();
    this.camera = new THREE.PerspectiveCamera(31.4, 1.6, 0.01, 30);
    this.scene.add(this.camera);
    this.objects = {}; this.decals = {};
    this.tier = { dpr: Math.min(devicePixelRatio || 1, 2), blur: true, grain: true, msaa: 4, shadow: 2048 };
    this.U = {
      uBgA: { value: new THREE.Color('#F6EBDA') }, uBgB: { value: new THREE.Color('#C9AD8C') },
      uRes: { value: new THREE.Vector2(1, 1) }, uBgC: { value: new THREE.Vector2(.5, .56) },
      uFade: { value: new THREE.Vector4(0, 0, 1, 2) },
      uSh: { value: Array.from({ length: 6 }, () => new THREE.Vector4(0, 0, .1, 0)) },
    };
    // environment: a procedural studio (zero bytes); a real HDR can replace it later
    const pmrem = new THREE.PMREMGenerator(r);
    this.envRoom = pmrem.fromScene(studioScene(), 0.02).texture;
    pmrem.dispose();
    this.scene.environment = this.envRoom;
    this._buildBackground();
    this._buildLights();
    this._buildAtmosphere();
    this._buildPost();
  }

  // ---------------------------------------------------------------- scene pieces
  _buildBackground() {
    const m = new THREE.ShaderMaterial({
      uniforms: this.U, depthTest: false, depthWrite: false,
      vertexShader: `void main(){ gl_Position = vec4(position.xy, .9999, 1.); }`,
      fragmentShader: BG + `void main(){ gl_FragColor = vec4(bgAt(gl_FragCoord.xy), 1.); }`,
    });
    const q = new THREE.Mesh(new THREE.PlaneGeometry(2, 2), m);
    q.frustumCulled = false; q.renderOrder = -100;
    this.scene.add(q);
  }

  _buildLights() {
    const key = this.key = new THREE.DirectionalLight('#FFE2C0', 3);
    key.castShadow = true;
    key.shadow.mapSize.set(2048, 2048);
    const sc = key.shadow.camera;
    sc.left = -0.95; sc.right = 0.95; sc.top = 0.95; sc.bottom = -0.95; sc.near = 0.2; sc.far = 6;
    key.shadow.bias = -0.0004; key.shadow.normalBias = 0.002; key.shadow.radius = 7; key.shadow.blurSamples = 12;
    key.target.position.set(0, 0, -0.02);
    this.scene.add(key, key.target);
    // a pendant over whatever the act is about (night acts); no shadows, the key does those
    const pend = this.pend = new THREE.SpotLight('#FFD2A0', 0, 3, Math.PI / 7, .7, 2);
    pend.position.set(0, 1.1, 0);
    this.scene.add(pend, pend.target);
  }

  _makeTable() {
    // Procedural varnished walnut until a textured `table` mesh arrives in the GLB.
    const m = new THREE.MeshPhysicalMaterial({ color: '#FFFFFF', roughness: .5, clearcoat: .35, clearcoatRoughness: .28 });
    this._fadeInto(m, true);
    const t = new THREE.Mesh(new THREE.PlaneGeometry(7, 7), m);
    t.rotation.x = -Math.PI / 2; t.position.y = -0.0004;
    t.receiveShadow = true;
    t.name = 'table';
    return t;
  }

  // Inject (optional) procedural wood and a screen-space fade to the background gradient into a PBR material.
  _fadeInto(mat, wood) {
    const U = this.U;
    mat.onBeforeCompile = (sh) => {
      Object.assign(sh.uniforms, U);
      sh.vertexShader = sh.vertexShader
        .replace('#include <common>', '#include <common>\nvarying vec3 vDcW;')
        .replace('#include <project_vertex>', '#include <project_vertex>\nvDcW = (modelMatrix * vec4(transformed, 1.0)).xyz;');
      sh.fragmentShader = sh.fragmentShader
        .replace('#include <common>', '#include <common>\nvarying vec3 vDcW;\nuniform vec4 uFade; uniform vec4 uSh[6];\n' + NOISE + BG)
        .replace('#include <map_fragment>', '#include <map_fragment>\n' + (wood ? `
          vec2 wp = vDcW.xz;
          float plank = floor(wp.y * 5.2 + .5);
          float warp = dcFbm(wp * vec2(1.2, 5.) + plank * 3.1) * 2.2;
          float grain = dcFbm(vec2(wp.x * 1.4 + plank * 7.3, wp.y * 52. + warp));
          float fine = dcNoise(vec2(wp.x * 9., wp.y * 420. + warp * 6.));
          float tone = .82 + .18 * dcHash(vec2(plank, 3.7));
          vec3 wA = vec3(.40, .21, .105), wB = vec3(.16, .075, .035);
          vec3 woodCol = mix(wB, wA, clamp(grain * 1.1 + fine * .12, 0., 1.)) * tone;
          float seam = smoothstep(0., .012, abs(fract(wp.y * 5.2 + .5) - .5) * 2.);
          diffuseColor.rgb = woodCol * mix(.55, 1., seam);` : ''))
        .replace('#include <roughnessmap_fragment>', '#include <roughnessmap_fragment>\n' + (wood ? 'roughnessFactor = clamp(.42 + (grain - .5) * .35 + fine * .08, .25, .8);' : ''))
        .replace('#include <dithering_fragment>', `#include <dithering_fragment>
          float dcSh = 1.;
          for (int i = 0; i < 6; i++) { vec4 s = uSh[i]; float d = length(vDcW.xz - s.xy);
            dcSh *= 1. - s.w * (1. - smoothstep(s.z * .78, s.z * 1.12, d)); }
          gl_FragColor.rgb *= dcSh;
          float dcF = smoothstep(uFade.z, uFade.w, length(vDcW.xz - uFade.xy));
          gl_FragColor.rgb = mix(gl_FragColor.rgb, bgAt(gl_FragCoord.xy), dcF);`);
    };
    mat.customProgramCacheKey = () => 'dc-fade-' + (wood ? 'wood' : 'tex');
  }

  _buildAtmosphere() {
    const puff = puffTexture();
    this.steam = [];
    for (let i = 0; i < 16; i++) {
      const s = new THREE.Sprite(new THREE.SpriteMaterial({ map: puff, color: 0xfff8ee, transparent: true, opacity: 0, depthWrite: false }));
      s.userData = { ph: i / 16, sx: (Math.random() - .5) * .06, sz: (Math.random() - .5) * .06, sp: .8 + Math.random() * .5 };
      this.scene.add(s); this.steam.push(s);
    }
    this.curtain = [];
    for (let i = 0; i < 22; i++) {
      const s = new THREE.Sprite(new THREE.SpriteMaterial({ map: puff, color: 0xffffff, transparent: true, opacity: 0, depthWrite: false }));
      const a = i / 22 * Math.PI * 2 + Math.random() * .3, d = .05 + Math.random() * .16;
      s.userData = { a, d, z: -.22 - Math.random() * .25, sc: .28 + Math.random() * .3, rot: Math.random() * 6 };
      this.camera.add(s); this.curtain.push(s);
    }
    const N = 220, pos = new Float32Array(N * 3); this.moteSeed = new Float32Array(N * 4);
    for (let i = 0; i < N; i++) this.moteSeed.set([(Math.random() - .5) * 1.8, Math.random() * .55 + .03, (Math.random() - .5) * 1.2, Math.random() * 6.28], i * 4);
    const g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    this.motes = new THREE.Points(g, new THREE.PointsMaterial({ map: dotTexture(), size: .006, sizeAttenuation: true, color: 0xffe6c4,
      transparent: true, opacity: 0, depthWrite: false, blending: THREE.AdditiveBlending }));
    this.motes.frustumCulled = false;
    this.scene.add(this.motes);
  }

  _buildPost() {
    const type = THREE.HalfFloatType;
    const opt = { type, depthBuffer: false, stencilBuffer: false, magFilter: THREE.LinearFilter, minFilter: THREE.LinearFilter };
    this.rtScene = new THREE.WebGLRenderTarget(1, 1, { type, samples: this.tier.msaa, stencilBuffer: false, depthTexture: new THREE.DepthTexture(1, 1) });
    this.rtH = [new THREE.WebGLRenderTarget(1, 1, opt), new THREE.WebGLRenderTarget(1, 1, opt)];
    this.rtQ = [new THREE.WebGLRenderTarget(1, 1, opt), new THREE.WebGLRenderTarget(1, 1, opt)];
    this.fsCam = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);
    this.fsQuad = new THREE.Mesh(new THREE.PlaneGeometry(2, 2));
    this.fsQuad.frustumCulled = false;
    this.fsScene = new THREE.Scene(); this.fsScene.add(this.fsQuad);
    this.matCoc = new THREE.ShaderMaterial({
      uniforms: { tSrc: { value: null }, tDepth: { value: null }, uTexel: { value: new THREE.Vector2() }, uNear: { value: .01 }, uFar: { value: 30 },
        uFocus: { value: .6 }, uRange: { value: .12 }, uMaxCoc: { value: .55 }, uReveal: { value: 1 } }, vertexShader: FS_VERT, toneMapped: false,
      fragmentShader: `uniform sampler2D tSrc, tDepth; uniform vec2 uTexel; uniform float uNear, uFar, uFocus, uRange, uMaxCoc, uReveal; varying vec2 vUv;
        float lin(float d){ float z = d*2.-1.; return 2.*uNear*uFar/(uFar+uNear - z*(uFar-uNear)); }
        vec4 tap(vec2 uv){ float z = lin(texture2D(tDepth, uv).x);
          float coc = max(clamp((abs(z - uFocus) - uRange*.4) / uRange, 0., 1.) * uMaxCoc, (1. - uReveal) * .85);
          float w = max(coc, .002); return vec4(texture2D(tSrc, uv).rgb * w, w); }
        void main(){ vec2 o = uTexel*.5; gl_FragColor = .25*(tap(vUv+vec2(-o.x,-o.y))+tap(vUv+vec2(o.x,-o.y))+tap(vUv+vec2(-o.x,o.y))+tap(vUv+vec2(o.x,o.y))); }`,
    });
    this.matDown = new THREE.ShaderMaterial({
      uniforms: { tSrc: { value: null }, uTexel: { value: new THREE.Vector2() } }, vertexShader: FS_VERT, toneMapped: false,
      fragmentShader: `uniform sampler2D tSrc; uniform vec2 uTexel; varying vec2 vUv;
        void main(){ vec2 o = uTexel*.5; gl_FragColor = .25*(texture2D(tSrc,vUv+vec2(-o.x,-o.y))+texture2D(tSrc,vUv+vec2(o.x,-o.y))+texture2D(tSrc,vUv+vec2(-o.x,o.y))+texture2D(tSrc,vUv+vec2(o.x,o.y))); }`,
    });
    this.matBlur = new THREE.ShaderMaterial({
      uniforms: { tSrc: { value: null }, uDir: { value: new THREE.Vector2() } }, vertexShader: FS_VERT, toneMapped: false,
      fragmentShader: `uniform sampler2D tSrc; uniform vec2 uDir; varying vec2 vUv;
        void main(){ vec4 c = texture2D(tSrc,vUv)*.2270270270;
          c += (texture2D(tSrc,vUv+uDir*1.3846153846)+texture2D(tSrc,vUv-uDir*1.3846153846))*.3162162162;
          c += (texture2D(tSrc,vUv+uDir*3.2307692308)+texture2D(tSrc,vUv-uDir*3.2307692308))*.0702702703;
          gl_FragColor = c; }`,
    });
    this.post = {
      tSharp: { value: null }, tHalf: { value: null }, tQuarter: { value: null }, tDepth: { value: null },
      uNear: { value: .01 }, uFar: { value: 30 }, uFocus: { value: .6 }, uRange: { value: .12 }, uBlurOn: { value: 1 }, uMaxCoc: { value: .55 },
      uReveal: { value: 0 }, uGrain: { value: .04 }, uTime: { value: 0 }, uVig: { value: .55 },
      uGain: { value: new THREE.Color(1, 1, 1) }, uLift: { value: new THREE.Color(0, 0, 0) }, uFlash: { value: 0 }, uSat: { value: 1.1 },
    };
    this.matComp = new THREE.ShaderMaterial({
      uniforms: this.post, vertexShader: FS_VERT,
      fragmentShader: `
        uniform sampler2D tSharp, tHalf, tQuarter, tDepth;
        uniform float uNear, uFar, uFocus, uRange, uBlurOn, uMaxCoc, uReveal, uGrain, uTime, uVig, uFlash, uSat;
        uniform vec3 uGain, uLift; varying vec2 vUv;
        float lin(float d){ float z = d*2.-1.; return 2.*uNear*uFar/(uFar+uNear - z*(uFar-uNear)); }
        float h12(vec2 p){ vec3 q = fract(vec3(p.xyx)*.1031); q += dot(q, q.yzx+33.33); return fract((q.x+q.y)*q.z); }
        void main(){
          vec3 c = texture2D(tSharp, vUv).rgb;
          if (uBlurOn > .5) {
            float z = lin(texture2D(tDepth, vUv).x);
            float coc = clamp((abs(z - uFocus) - uRange*.4) / uRange, 0., 1.) * uMaxCoc;
            coc = max(coc, (1. - uReveal) * .85);
            vec4 hp = texture2D(tHalf, vUv), qp = texture2D(tQuarter, vUv);
            vec3 h = hp.rgb / max(hp.a, 1e-4), q = qp.rgb / max(qp.a, 1e-4);
            c = coc < .5 ? mix(c, h, coc*2.) : mix(h, q, coc*2. - 1.);
          }
          c = c*uGain + uLift;
          vec2 v = vUv - .5; c *= clamp(1. - uVig*dot(v, v)*1.9, 0., 1.);
          gl_FragColor = vec4(max(c, 0.), 1.);
          #include <tonemapping_fragment>
          float l = dot(gl_FragColor.rgb, vec3(.2126, .7152, .0722));
          gl_FragColor.rgb = clamp(mix(vec3(l), gl_FragColor.rgb, uSat), 0., 1.);
          #include <colorspace_fragment>
          gl_FragColor.rgb = mix(gl_FragColor.rgb, vec3(1.), uFlash);
          gl_FragColor.rgb += (h12(gl_FragCoord.xy + fract(uTime*7.13)*vec2(157., 311.)) - .5) * uGrain;
        }`,
    });
  }

  // ---------------------------------------------------------------- loading
  async load(onItem) {
    const draco = new DRACOLoader().setDecoderPath('/vendor/three-addons/libs/draco/gltf/');
    const gltf = new GLTFLoader().setDRACOLoader(draco);
    const [scene, cam] = await Promise.all([
      gltf.loadAsync('/assets/scene.glb').then((g) => { onItem(); return g; }),
      gltf.loadAsync('/assets/camera.glb').then((g) => { onItem(); return g; }),
    ]);
    this.gltfLoader = gltf;
    this._adopt(scene.scene);
    if (!this.objects.table) { const t = this._makeTable(); this.scene.add(t); this.objects.table = t; }

    this.bakedCam = cam.cameras[0] || null;
    if (this.bakedCam && cam.animations[0]) {
      this.mixer = new THREE.AnimationMixer(cam.scene);
      this.mixer.clipAction(cam.animations[0]).play();
      this.clipDur = cam.animations[0].duration || 10;
      this.baseFov = this.bakedCam.fov; this.baseAspect = this.bakedCam.aspect || 1.6;
    } else { this.baseFov = 31.4; this.baseAspect = 1.6; this.clipDur = 10; }
    cam.scene.updateMatrixWorld(true);
    this.camScene = cam.scene;
    this.resize();
    await this.renderer.compileAsync(this.scene, this.camera);
    onItem(); onItem(); onItem();
  }

  // Pot, pasta, bowl and rice arrive in a second file after the first screen is up.
  async loadLate() {
    if (this.objects.pot) return;
    const g = await this.gltfLoader.loadAsync('/assets/scene-late.glb');
    this._adopt(g.scene);
    await this.renderer.compileAsync(this.scene, this.camera);
  }

  // Take over GLB meshes: keep their PBR materials when they have them, otherwise use physical defaults.
  _adopt(root) {
    const mats = this.mats = this.mats || {};
    root.traverse((o) => {
      if (!o.isMesh) return;
      const n = o.name;
      if (/^shadow_/.test(n)) {
        const m = o.material;
        m.transparent = true; m.depthWrite = false; m.polygonOffset = true; m.polygonOffsetFactor = -1; o.renderOrder = 1;
        // denser core, same soft edge: raise the baked alpha by a gamma
        m.onBeforeCompile = (sh) => { sh.fragmentShader = sh.fragmentShader.replace('#include <alphamap_fragment>', '#include <alphamap_fragment>\n diffuseColor.a = pow(diffuseColor.a, .62);'); };
        m.customProgramCacheKey = () => 'dc-decal';
        o.castShadow = o.receiveShadow = false;
        // the table's own AO already holds the pot and bowl contact shadows: never double them
        if (n === 'shadow_pot' || n === 'shadow_bowl') o.visible = false;
        this.decals[n] = { mesh: o, base: m.opacity ?? 1, pos: o.position.clone() };
        return;
      }
      const kind = KIND(n);
      const glbMat = o.material && o.material.name ? o.material : null;
      let m;
      if (n === 'table') {
        m = glbMat || new THREE.MeshPhysicalMaterial({ color: '#6B4428', roughness: .5 });
        this._fadeInto(m, !glbMat || !glbMat.map);
        o.receiveShadow = true; o.castShadow = false;
      } else if (glbMat) {
        m = glbMat;
        if (kind === 'ceramic') {   // glaze: a thin clear coat over the ceramic
          if (!m.isMeshPhysicalMaterial) { const p = new THREE.MeshPhysicalMaterial(); THREE.MeshStandardMaterial.prototype.copy.call(p, m); m = p; }
          m.clearcoat = .45; m.clearcoatRoughness = .08; m.envMapIntensity = 1.2;
        }
        if (kind === 'steel') m.envMapIntensity = 2.2;
      } else {
        m = mats['k_' + kind] || (mats['k_' + kind] = (DEFAULTS[kind] || DEFAULTS.ceramic)());
      }
      if (n === 'plate_3' || n === 'plate_4') m = m.clone();
      if (n === 'plate_4') m.transparent = true;
      o.material = m;
      if (n !== 'table') { o.castShadow = true; o.receiveShadow = true; }
      this.objects[n] = o;
      o.userData.base = { p: o.position.clone(), r: o.rotation.clone(), s: o.scale.clone() };
      o.userData.color = m.color ? m.color.clone() : null;
    });
    this.scene.add(root);
    const pd = this.decals.shadow_pasta, pa = this.objects.pasta;
    if (pd && pa && pd.mesh.parent !== pa) { root.updateMatrixWorld(true); pa.attach(pd.mesh); }   // scales with the heap
  }

  // A real HDRI (env.exr, ~185 KB) after first paint; the procedural studio stays if it is absent.
  async upgradeEnvironment(url, rotY = 0) {
    try {
      const { EXRLoader } = await import('three/addons/loaders/EXRLoader.js');
      const hdr = await new EXRLoader().loadAsync(url);
      hdr.mapping = THREE.EquirectangularReflectionMapping;
      this.scene.environmentRotation.set(0, rotY, 0);
      const pmrem = new THREE.PMREMGenerator(this.renderer);
      const env = pmrem.fromEquirectangular(hdr).texture;
      hdr.dispose(); pmrem.dispose();
      const old = this.scene.environment;
      this.scene.environment = env;
      if (old && old !== env) old.dispose();   // never pile up PMREM targets on repeat calls
      if (old === this.envRoom) this.envRoom = null;
      return true;
    } catch { return false; }
  }

  // ---------------------------------------------------------------- quality
  setTier(t) {
    const prev = this.tier;
    this.tier = { ...t };
    if (t.msaa !== prev.msaa) { this.rtScene.dispose(); this.rtScene.samples = t.msaa; }
    const shadowOn = t.shadow > 0;
    if (shadowOn !== this.renderer.shadowMap.enabled || t.shadow !== prev.shadow) {
      this.renderer.shadowMap.enabled = shadowOn;
      this.key.castShadow = shadowOn;
      if (shadowOn) this.key.shadow.mapSize.set(t.shadow, t.shadow);
      if (this.key.shadow.map) { this.key.shadow.map.dispose(); this.key.shadow.map = null; }
      this.scene.traverse((o) => { if (o.material) [].concat(o.material).forEach((m) => { m.needsUpdate = true; }); });
    }
    this.resize();
  }

  resize() {
    const w = this.canvas.clientWidth || innerWidth, h = this.canvas.clientHeight || innerHeight;
    const dpr = this.tier.dpr;
    this.renderer.setPixelRatio(dpr);
    this.renderer.setSize(w, h, false);
    const W = Math.max(1, Math.round(w * dpr)), H = Math.max(1, Math.round(h * dpr));
    this.rtScene.setSize(W, H);
    this.rtH.forEach((rt) => rt.setSize(Math.max(1, W >> 1), Math.max(1, H >> 1)));
    this.rtQ.forEach((rt) => rt.setSize(Math.max(1, W >> 2), Math.max(1, H >> 2)));
    this.size = { w, h, W, H };
    this.U.uRes.value.set(W, H);
  }

  // ---------------------------------------------------------------- per-frame state
  update(f) {
    const { w, h } = this.size;
    const aspect = w / h;
    const cam = this.camera;
    // 1) baked camera at the requested frame
    if (this.mixer) { this.mixer.setTime(Math.min(f.frame / FPS, this.clipDur - 1e-4)); this.camScene.updateMatrixWorld(true); }
    if (this.bakedCam) { this.bakedCam.getWorldPosition(cam.position); this.bakedCam.getWorldQuaternion(cam.quaternion); }
    // 2) fit the frame to this screen: keep ~the horizontal view on narrow screens, dolly back when the fov caps
    const tanV = Math.tan(THREE.MathUtils.degToRad(this.baseFov) / 2);
    const tanH = tanV * this.baseAspect;                  // tan(24.25 deg): the Blender 40 mm lens
    let fovTan = Math.max(tanV, tanH / aspect);
    const capTan = Math.tan(THREE.MathUtils.degToRad(aspect < 1 ? 72 : 50) / 2);
    const baseDist = cam.position.distanceTo(f.subject);
    let dolly = 0;
    if (fovTan > capTan) { dolly = (fovTan / capTan - 1) * baseDist; fovTan = capTan; }
    cam.fov = THREE.MathUtils.radToDeg(Math.atan(fovTan) * 2);
    cam.aspect = aspect;
    cam.translateZ(dolly + f.dolly);
    cam.translateX(f.parallax.x * .012); cam.translateY(f.parallax.y * .008);
    cam.updateProjectionMatrix();
    cam.projectionMatrix.elements[8] = -f.shift.x;   // lens shift (NDC): copy and subject share the frame
    cam.projectionMatrix.elements[9] = -f.shift.y;
    cam.projectionMatrixInverse.copy(cam.projectionMatrix).invert();
    cam.updateMatrixWorld(true);

    // 3) mood: background, lights, environment, grade
    const M = f.mood;
    this.U.uBgA.value.copy(M.bgA); this.U.uBgB.value.copy(M.bgB);
    this.U.uFade.value.set(f.pool.x * .5, f.pool.z * .5, f.fade[0], f.fade[1]);
    this.key.color.copy(M.keyCol); this.key.intensity = M.key;
    this.key.position.copy(M.keyDir).normalize().multiplyScalar(2.5).add(this.key.target.position);
    this.pend.color.copy(M.keyCol); this.pend.intensity = M.pend;
    this.pend.position.set(f.pool.x, 1.05, f.pool.z); this.pend.target.position.set(f.pool.x, 0, f.pool.z);
    this.pend.target.updateMatrixWorld();
    this.scene.environmentIntensity = M.env;
    this.renderer.toneMappingExposure = M.exposure;
    this.post.uGain.value.copy(M.gain); this.post.uLift.value.copy(M.lift);

    // 4) objects
    const O = this.objects, D = this.decals;
    if (O.plate_4) {
      const a = f.plateOut, b = O.plate_4.userData.base;
      O.plate_4.position.set(b.p.x - .05 * a, b.p.y + .34 * a * a + .03 * Math.min(1, a * 4), b.p.z - .12 * a);
      O.plate_4.rotation.set(-.5 * a, 0, .35 * a);
      O.plate_4.material.opacity = 1 - THREE.MathUtils.smoothstep(a, .45, 1);
      O.plate_4.visible = a < .999;
      O.plate_4.castShadow = a < .6;
      if (D.shadow_plate_4) {
        D.shadow_plate_4.mesh.material.opacity = D.shadow_plate_4.base * (1 - Math.min(1, a * 3));
        D.shadow_plate_4.mesh.visible = a < .33;
      }
    }
    if (O.plate_3) {
      const a = f.plateSaved, b = O.plate_3.userData.base, s = f.savedSpot;
      const lift = Math.sin(Math.PI * a) * .09;
      O.plate_3.position.set(THREE.MathUtils.lerp(b.p.x, s.x, a), THREE.MathUtils.lerp(b.p.y, 0, a) + lift, THREE.MathUtils.lerp(b.p.z, s.z, a));
      O.plate_3.rotation.set(0, a * .6, Math.sin(Math.PI * a) * .12);
      if (O.plate_3.userData.color) O.plate_3.material.color.copy(O.plate_3.userData.color).lerp(f.brass, a * .5);
      const dd = D.shadow_plate_3;
      if (dd) {
        // the decal leaves the stack with its plate and lands on the table (y) under the saved spot
        dd.mesh.position.set(THREE.MathUtils.lerp(dd.pos.x, s.x, a), THREE.MathUtils.lerp(dd.pos.y, 0.0005, a), THREE.MathUtils.lerp(dd.pos.z, s.z, a));
        dd.mesh.material.opacity = dd.base * (a < .25 ? 1 - a / .25 : a > .85 ? (a - .85) / .15 : 0);
        dd.mesh.visible = dd.mesh.material.opacity > .01;
      }
    }
    if (O.pasta) O.pasta.scale.setScalar(f.pastaScale);
    // analytic contact shadows (soft AO discs) until the baked decals take over
    const sh = this.U.uSh.value, k = Object.keys(D).length ? 0 : 1;
    const sp = O.plate_3 ? O.plate_3.position : null;
    sh[0].set(-.42, -.02, .142, .5); sh[1].set(-.02, -.10, .16, .55 * k); sh[2].set(.17, .12, .12 * f.pastaScale, .4 * k);
    sh[3].set(.40, -.03, .075, .55 * k);
    if (sp) sh[4].set(sp.x, sp.z, .142, .5 * (f.plateSaved > .98 ? 1 : Math.max(0, 1 - sp.y * 12) * f.plateSaved));
    if (O.rice) {
      const b = O.rice.userData.base, k = 1 - f.riceScale;
      O.rice.scale.set(1 - k * .55, 1 - k * 1.3, 1 - k * .55);
      O.rice.position.y = b.p.y - k * .03;
    }
    if (O.pot_lid) {
      const b = O.pot_lid.userData.base, l = f.lid;
      O.pot_lid.position.set(b.p.x + .03 * l, b.p.y + .045 * l, b.p.z);
      O.pot_lid.rotation.set(0, 0, -.32 * l);
    }

    // 5) atmosphere
    const t = f.time;
    this.steam.forEach((s, i) => {
      const u = s.userData, k = (t * .16 * u.sp + u.ph) % 1;
      s.position.set(-.02 + u.sx + Math.sin(t * .7 + i) * .02 * k, .16 + k * .32, -.10 + u.sz);
      const sc = .08 + k * .22; s.scale.set(sc, sc, 1);
      s.material.opacity = f.steam * Math.sin(Math.PI * k) * .5;
      s.material.rotation = u.ph * 6 + k;
      s.visible = s.material.opacity > .002;
    });
    this.curtain.forEach((s) => {
      const u = s.userData, part = f.curtainPart;
      const d = u.d + part * (.25 + u.d);
      s.position.set(Math.cos(u.a) * d, Math.sin(u.a) * d * .8, u.z);
      const sc = u.sc * (1 + part * .6); s.scale.set(sc, sc, 1);
      s.material.opacity = f.curtain * (1 - part) * .72;
      s.material.rotation = u.rot + t * .05;
      s.visible = s.material.opacity > .002;
    });
    const mp = this.motes.geometry.attributes.position, sd = this.moteSeed;
    for (let i = 0; i < mp.count; i++) {
      const x = sd[i * 4], y = sd[i * 4 + 1], z = sd[i * 4 + 2], ph = sd[i * 4 + 3];
      mp.setXYZ(i, x + Math.sin(t * .13 + ph) * .04, y + ((t * .012 + ph) % .6) * .15, z + Math.cos(t * .11 + ph * 1.3) * .04);
    }
    mp.needsUpdate = true;
    this.motes.material.opacity = f.motes;
    this.motes.material.size = f.moteSize;
    this.motes.material.color.copy(f.moteColor);

    // 6) post
    const focus = cam.position.distanceTo(f.subject);
    this.post.uFocus.value = focus;
    this.post.uRange.value = f.focusRange * focus;
    this.post.uReveal.value = f.reveal;
    this.post.uGrain.value = this.tier.grain ? f.grain : 0;
    this.post.uTime.value = f.reducedGrain ? 0 : t;
    this.post.uVig.value = M.vig;
    this.post.uFlash.value = f.flash;
  }

  project(v, out) { return out.copy(v).project(this.camera); }

  render() {
    const r = this.renderer, P = this.post;
    r.setRenderTarget(this.rtScene); r.render(this.scene, this.camera);
    P.tSharp.value = this.rtScene.texture; P.tDepth.value = this.rtScene.depthTexture;
    P.uNear.value = this.camera.near; P.uFar.value = this.camera.far;
    const blurOn = this.tier.blur;
    P.uBlurOn.value = blurOn ? 1 : 0;
    if (blurOn) {
      const pass = (mat, src, dst) => { this.fsQuad.material = mat; mat.uniforms.tSrc.value = src.texture; r.setRenderTarget(dst); r.render(this.fsScene, this.fsCam); };
      const [h0, h1] = this.rtH, [q0, q1] = this.rtQ;
      const cu = this.matCoc.uniforms;
      cu.tDepth.value = this.rtScene.depthTexture; cu.uTexel.value.set(1 / this.size.W, 1 / this.size.H);
      cu.uNear.value = P.uNear.value; cu.uFar.value = P.uFar.value; cu.uFocus.value = P.uFocus.value;
      cu.uRange.value = P.uRange.value; cu.uMaxCoc.value = P.uMaxCoc.value; cu.uReveal.value = P.uReveal.value;
      pass(this.matCoc, this.rtScene, h0);
      this.matBlur.uniforms.uDir.value.set(1 / h0.width, 0); pass(this.matBlur, h0, h1);
      this.matBlur.uniforms.uDir.value.set(0, 1 / h0.height); pass(this.matBlur, h1, h0);
      this.matDown.uniforms.uTexel.value.set(1 / h0.width, 1 / h0.height);
      pass(this.matDown, h0, q0);
      this.matBlur.uniforms.uDir.value.set(1.5 / q0.width, 0); pass(this.matBlur, q0, q1);
      this.matBlur.uniforms.uDir.value.set(0, 1.5 / q0.height); pass(this.matBlur, q1, q0);
      P.tHalf.value = h0.texture; P.tQuarter.value = q0.texture;
    }
    this.fsQuad.material = this.matComp;
    r.setRenderTarget(null); r.render(this.fsScene, this.fsCam);
  }
}
