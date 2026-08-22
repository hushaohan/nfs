/* =====================================================================
 * effects.js — Car mesh builder + particle effects
 *   • buildCarMesh: sculpted sports car (extruded body profile,
 *     fastback canopy, fender arches, spoked wheels, aero kit)
 *   • ParticleSystem: pooled quads for smoke / sparks / nitro flames
 * ===================================================================== */
"use strict";

/* helper: extrude a side-profile shape (x = car length axis, y = height)
 * into a centered body piece whose length runs along +Z.               */
function extrudeProfile(points, depth, bevel, mat) {
  const shape = new THREE.Shape();
  shape.moveTo(points[0][0], points[0][1]);
  for (let i = 1; i < points.length; i++) shape.lineTo(points[i][0], points[i][1]);
  shape.closePath();
  const geo = new THREE.ExtrudeGeometry(shape, {
    depth, bevelEnabled: true, bevelThickness: bevel, bevelSize: bevel * 0.8,
    bevelSegments: 3, curveSegments: 6,
  });
  // shape-x → world-z (front), extrusion → world-x, centered
  // (bevel extends the extrusion by bevelThickness on each side, so the
  //  pre-translation x-range is [-(depth+bevel), +bevel]; +depth/2 centers it)
  geo.rotateY(-Math.PI / 2);
  geo.translate(depth / 2, 0, 0);
  geo.computeVertexNormals();
  const mesh = new THREE.Mesh(geo, mat);
  mesh.castShadow = true;
  return mesh;
}

/* ---------- car mesh ----------
 * Three genuinely different body designs, selected by spec.design:
 *   brute — FALCON GT: long-hood muscle coupe, ducktail, quad lamps
 *   hyper — VIPER X:   low wedge supercar, teardrop canopy, big wing
 *   hatch — KITSUNE RS: cab-forward drift hatch, flares, roof fins
 * Shared contract: userData.wheels (4 groups; children[0]=spinner,
 * children[1]=brake disc), userData.tailMat, userData.spec.          */
function buildCarMesh(spec) {
  const g = new THREE.Group();
  const paintMat = new THREE.MeshStandardMaterial({ color: new THREE.Color(spec.color), roughness: 0.22, metalness: 0.7 });
  const darkMat  = new THREE.MeshStandardMaterial({ color: new THREE.Color(spec.accent), roughness: 0.55, metalness: 0.35 });
  const glassMat = new THREE.MeshStandardMaterial({ color: 0x0d1a28, roughness: 0.05, metalness: 0.95 });
  const chromeMat = new THREE.MeshStandardMaterial({ color: 0xc8ccd4, roughness: 0.25, metalness: 0.95 });

  // axle positions: spec stores cgFront as a fraction of the wheelbase
  const cgToFront = spec.wheelbase * spec.cgFront;
  const cgToRear = spec.wheelbase - cgToFront;
  const ctx = { paintMat, darkMat, glassMat, chromeMat, cgToFront, cgToRear };

  if (spec.design === "hyper") _carBodyViper(g, spec, ctx);
  else if (spec.design === "hatch") _carBodyKitsune(g, spec, ctx);
  else _carBodyFalcon(g, spec, ctx);

  /* ---- fender arches over each wheel ---- */
  const archR = spec.wheelRadius + 0.16;
  const archGeo = new THREE.TorusGeometry(archR, 0.10, 6, 14, Math.PI);
  archGeo.rotateY(Math.PI / 2);
  const archX = spec.trackWidth / 2;
  for (const az of [cgToFront, -cgToRear]) {
    for (const sx of [-archX, archX]) {
      const arch = new THREE.Mesh(archGeo, paintMat);
      arch.position.set(sx, spec.wheelRadius * 0.95, az);
      arch.scale.set(1.15, 1.0, 1.0);
      arch.castShadow = true;
      g.add(arch);
    }
  }

  /* ---- wheels: tire + rim + brake disc ---- */
  const r = spec.wheelRadius;
  const tireMat = new THREE.MeshStandardMaterial({ color: 0x101010, roughness: 0.92 });
  const rimMat  = new THREE.MeshStandardMaterial({ color: 0xd6dae2, roughness: 0.2, metalness: 0.9 });
  const discMat = new THREE.MeshStandardMaterial({ color: 0x7a7f88, roughness: 0.35, metalness: 0.85 });

  const tireGeo = new THREE.TorusGeometry(r - 0.085, 0.085, 10, 20);
  tireGeo.rotateY(Math.PI / 2);
  const barrelGeo = new THREE.CylinderGeometry(r * 0.60, r * 0.60, 0.20, 14, 1, true);
  barrelGeo.rotateZ(Math.PI / 2);
  const spokeGeo = new THREE.BoxGeometry(0.055, r * 0.58, 0.10);
  const hubGeo = new THREE.CylinderGeometry(0.075, 0.075, 0.24, 8);
  hubGeo.rotateZ(Math.PI / 2);
  const discGeo = new THREE.CylinderGeometry(r * 0.42, r * 0.42, 0.035, 18);
  discGeo.rotateZ(Math.PI / 2);

  const wheels = [];
  const positions = [
    [-spec.trackWidth / 2, r,  cgToFront],
    [ spec.trackWidth / 2, r,  cgToFront],
    [-spec.trackWidth / 2, r, -cgToRear],
    [ spec.trackWidth / 2, r, -cgToRear],
  ];
  for (const p of positions) {
    const wg = new THREE.Group();
    const spin = new THREE.Group();
    const tire = new THREE.Mesh(tireGeo, tireMat);
    tire.castShadow = true;
    spin.add(tire);
    spin.add(new THREE.Mesh(barrelGeo, rimMat));
    for (let sIdx = 0; sIdx < 6; sIdx++) {
      const spoke = new THREE.Mesh(spokeGeo, rimMat);
      const a = (sIdx / 6) * Math.PI * 2;
      spoke.position.set(0, Math.cos(a) * r * 0.30, Math.sin(a) * r * 0.30);
      spoke.rotation.x = a;
      spin.add(spoke);
    }
    spin.add(new THREE.Mesh(hubGeo, rimMat));
    const disc = new THREE.Mesh(discGeo, discMat);
    wg.add(spin, disc);
    wg.position.set(p[0], p[1], p[2]);
    g.add(wg);
    wheels.push(wg);
  }
  g.userData.wheels = wheels;
  g.userData.spec = spec;
  return g;
}

function _box(g, w, h, d, mat, x, y, z, rx) {
  const m = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), mat);
  m.position.set(x, y, z);
  if (rx) m.rotation.x = rx;
  m.castShadow = true;
  g.add(m);
  return m;
}

/* ================= FALCON GT — brute muscle coupe ================= */
function _carBodyFalcon(g, spec, ctx) {
  const { paintMat, darkMat, glassMat, chromeMat } = ctx;

  // long hood, set-back cabin, wide haunches, kicked ducktail
  g.add(extrudeProfile([
    [ 2.34, 0.30], [ 2.50, 0.46], [ 2.10, 0.60], [ 0.95, 0.72],
    [ 0.35, 0.84], [-1.05, 0.88], [-1.95, 1.00], [-2.28, 0.92],
    [-2.42, 0.62], [-2.36, 0.30],
  ], 1.46, 0.17, paintMat));

  g.add(extrudeProfile([
    [ 0.55, 0.80], [ 0.05, 1.26], [-0.75, 1.27], [-1.70, 0.86],
  ], 1.04, 0.10, glassMat));

  // hood scoop
  _box(g, 0.52, 0.10, 0.70, darkMat, 0, 0.90, 1.15);
  // twin racing stripes down hood + deck
  for (const sx of [-0.20, 0.20]) {
    _box(g, 0.14, 0.03, 1.55, darkMat, sx, 0.845, 1.25).rotation.x = -0.075;
    _box(g, 0.14, 0.03, 1.10, darkMat, sx, 0.985, -1.45).rotation.x = -0.065;
  }
  // side skirts + side-exit exhaust pipes (3 per side)
  for (const sx of [-0.92, 0.92]) {
    _box(g, 0.14, 0.18, 2.6, darkMat, sx, 0.24, -0.05);
    for (let i = 0; i < 3; i++) {
      const pipe = new THREE.Mesh(new THREE.CylinderGeometry(0.055, 0.055, 0.34, 8), chromeMat);
      pipe.rotation.x = Math.PI / 2;
      pipe.position.set(sx, 0.30, -0.4 - i * 0.42);
      g.add(pipe);
    }
  }
  // front splitter + mesh-grille bar
  _box(g, 1.86, 0.10, 0.55, darkMat, 0, 0.18, 2.48);
  _box(g, 1.30, 0.24, 0.10, darkMat, 0, 0.40, 2.54);
  // quad round headlights (two per side)
  const lightMat = new THREE.MeshBasicMaterial({ color: 0xfff6d8 });
  for (const sx of [-0.60, -0.34, 0.34, 0.60]) {
    const lamp = new THREE.Mesh(new THREE.CylinderGeometry(0.085, 0.085, 0.08, 12), lightMat);
    lamp.rotation.x = Math.PI / 2;
    lamp.position.set(sx, 0.56, 2.56);
    g.add(lamp);
  }
  // ducktail lip spoiler
  _box(g, 1.66, 0.06, 0.30, darkMat, 0, 1.06, -2.22, 0.28);
  // rear diffuser + dual round exhausts
  _box(g, 1.6, 0.16, 0.4, darkMat, 0, 0.22, -2.42);
  for (const sx of [-0.42, 0.42]) {
    const exhaust = new THREE.Mesh(new THREE.CylinderGeometry(0.075, 0.09, 0.22, 10), chromeMat);
    exhaust.rotation.x = Math.PI / 2;
    exhaust.position.set(sx, 0.36, -2.48);
    g.add(exhaust);
  }
  // mirrors
  _mirrorPair(g, paintMat, darkMat, 0.86, 0.88, 0.55);
  // tail light bar
  const tailMat = new THREE.MeshBasicMaterial({ color: 0x550000 });
  _box(g, 1.58, 0.09, 0.06, tailMat, 0, 0.72, -2.47);
  g.userData.tailMat = tailMat;
}

/* ================= VIPER X — hyper wedge ================= */
function _carBodyViper(g, spec, ctx) {
  const { paintMat, darkMat, glassMat, chromeMat } = ctx;

  // knife-edge nose rising into high haunches, long tapering tail
  g.add(extrudeProfile([
    [ 2.55, 0.18], [ 2.66, 0.34], [ 2.30, 0.44], [ 1.20, 0.52],
    [ 0.45, 0.74], [-0.90, 0.78], [-1.85, 0.82], [-2.30, 0.86],
    [-2.48, 0.56], [-2.40, 0.24],
  ], 1.38, 0.15, paintMat));

  // teardrop canopy pushed far forward
  g.add(extrudeProfile([
    [ 0.95, 0.68], [ 0.35, 1.06], [-0.35, 1.08], [-1.30, 0.76],
  ], 0.96, 0.09, glassMat));

  // shark fin on the deck
  const fin = new THREE.Mesh(new THREE.BoxGeometry(0.05, 0.22, 0.9), paintMat);
  fin.position.set(0, 0.94, -1.55);
  fin.rotation.x = 0.18;
  g.add(fin);

  // side skirts, deep
  for (const sx of [-0.88, 0.88]) _box(g, 0.13, 0.22, 2.7, darkMat, sx, 0.22, -0.05);

  // front: ultra-low splitter with canards
  _box(g, 1.80, 0.08, 0.62, darkMat, 0, 0.13, 2.58);
  for (const sx of [-0.80, 0.80]) {
    const canard = _box(g, 0.30, 0.04, 0.22, darkMat, sx, 0.30, 2.44);
    canard.rotation.z = sx > 0 ? -0.35 : 0.35;
  }

  // angled LED slit headlights
  const lightMat = new THREE.MeshBasicMaterial({ color: 0xeaf6ff });
  for (const sx of [-0.55, 0.55]) {
    const hl = new THREE.Mesh(new THREE.BoxGeometry(0.50, 0.055, 0.09), lightMat);
    hl.position.set(sx, 0.42, 2.60);
    hl.rotation.x = 0.30;
    hl.rotation.y = sx > 0 ? -0.22 : 0.22;
    g.add(hl);
  }

  // huge two-element rear wing on twin pylons + endplates
  _box(g, 1.84, 0.05, 0.42, darkMat, 0, 1.30, -2.10, -0.16);
  _box(g, 1.84, 0.05, 0.30, darkMat, 0, 1.18, -2.32, -0.30);
  for (const sx of [-0.78, 0.78]) {
    _box(g, 0.06, 0.26, 0.46, darkMat, sx, 1.24, -2.18);           // endplate
    _box(g, 0.07, 0.42, 0.12, darkMat, sx * 0.55, 1.02, -2.12);    // pylon
  }

  // diffuser with vertical strakes + center cannon exhaust
  _box(g, 1.62, 0.18, 0.44, darkMat, 0, 0.20, -2.46);
  for (const sx of [-0.4, 0, 0.4]) _box(g, 0.04, 0.20, 0.42, darkMat, sx, 0.32, -2.44);
  const cannon = new THREE.Mesh(new THREE.CylinderGeometry(0.11, 0.13, 0.26, 12), chromeMat);
  cannon.rotation.x = Math.PI / 2;
  cannon.position.set(0, 0.44, -2.52);
  g.add(cannon);

  // mirrors on slim stalks
  _mirrorPair(g, paintMat, darkMat, 0.82, 0.80, 0.85);
  // thin full-width tail light strip
  const tailMat = new THREE.MeshBasicMaterial({ color: 0x550000 });
  _box(g, 1.50, 0.05, 0.06, tailMat, 0, 0.74, -2.53);
  g.userData.tailMat = tailMat;
}

/* ================= KITSUNE RS — drift hatch ================= */
function _carBodyKitsune(g, spec, ctx) {
  const { paintMat, darkMat, glassMat, chromeMat } = ctx;

  // blunt upright nose, cab-forward windshield, tall hatch tail
  g.add(extrudeProfile([
    [ 1.95, 0.34], [ 2.12, 0.52], [ 1.75, 0.64], [ 0.80, 0.70],
    [ 0.25, 0.82], [-0.90, 0.86], [-1.72, 1.02], [-2.00, 1.04],
    [-2.14, 0.66], [-2.06, 0.32],
  ], 1.36, 0.15, paintMat));

  // fast-raked cab-forward canopy landing on the hatch
  g.add(extrudeProfile([
    [ 0.85, 0.76], [ 0.28, 1.26], [-0.55, 1.28], [-1.45, 1.06],
  ], 1.00, 0.10, glassMat));

  // boxy fender flares over all four corners
  const fx = spec.trackWidth / 2 + 0.06;
  for (const az of [ctx.cgToFront, -ctx.cgToRear]) {
    for (const sx of [-fx, fx]) _box(g, 0.16, 0.20, 1.05, paintMat, sx, spec.wheelRadius + 0.18, az);
  }

  // three vortex fins on the roof tail
  for (const sx of [-0.30, 0, 0.30]) {
    const vf = new THREE.Mesh(new THREE.BoxGeometry(0.04, 0.14, 0.26), darkMat);
    vf.position.set(sx, 1.34, -0.62);
    vf.rotation.x = 0.5;
    g.add(vf);
  }
  // high hatch roof spoiler
  _box(g, 1.42, 0.06, 0.34, darkMat, 0, 1.38, -1.62, -0.22);

  // side skirts + mud flaps behind wheels
  for (const sx of [-0.86, 0.86]) {
    _box(g, 0.13, 0.16, 2.3, darkMat, sx, 0.24, -0.05);
    for (const az of [ctx.cgToFront - 0.65, -ctx.cgToRear - 0.65]) {
      const flap = _box(g, 0.05, 0.16, 0.22, darkMat, sx, 0.22, az);
      flap.rotation.x = 0.35;
    }
  }

  // blocky front bumper w/ tow-eye notch + rectangular lamps & yellow fogs
  _box(g, 1.74, 0.14, 0.40, darkMat, 0, 0.24, 2.30);
  const lightMat = new THREE.MeshBasicMaterial({ color: 0xfff6d8 });
  const fogMat = new THREE.MeshBasicMaterial({ color: 0xffd24a });
  for (const sx of [-0.52, 0.52]) {
    _box(g, 0.34, 0.11, 0.08, lightMat, sx, 0.58, 2.20);
    _box(g, 0.16, 0.08, 0.07, fogMat, sx, 0.38, 2.26);
  }
  // single large offset exhaust
  const exhaust = new THREE.Mesh(new THREE.CylinderGeometry(0.10, 0.12, 0.26, 12), chromeMat);
  exhaust.rotation.x = Math.PI / 2;
  exhaust.position.set(-0.55, 0.34, -2.20);
  g.add(exhaust);

  // roof antenna
  const ant = new THREE.Mesh(new THREE.CylinderGeometry(0.015, 0.015, 0.34, 5), darkMat);
  ant.position.set(0.30, 1.40, 0.05);
  ant.rotation.x = -0.5;
  g.add(ant);

  _mirrorPair(g, paintMat, darkMat, 0.84, 0.94, 0.72);
  // tall hatch tail light panel
  const tailMat = new THREE.MeshBasicMaterial({ color: 0x550000 });
  _box(g, 1.30, 0.16, 0.06, tailMat, 0, 0.88, -2.17);
  g.userData.tailMat = tailMat;
}

function _mirrorPair(g, paintMat, darkMat, x, y, z) {
  for (const sx of [-x, x]) {
    const stalk = new THREE.Mesh(new THREE.BoxGeometry(0.16, 0.05, 0.05), darkMat);
    stalk.position.set(sx, y, z);
    g.add(stalk);
    const mir = new THREE.Mesh(new THREE.BoxGeometry(0.09, 0.11, 0.18), paintMat);
    mir.position.set(sx + Math.sign(sx) * 0.10, y + 0.04, z - 0.02);
    g.add(mir);
  }
}

/* ---------- car select turntable preview ----------
 * Standalone mini-renderer on its own canvas: studio lighting, a dark
 * pedestal disc with an accent ring tinted by the car color, slow
 * rotation. Runs its own rAF loop only while visible.               */
class CarPreview {
  constructor(canvas) {
    this.canvas = canvas;
    this.renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: true });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
    this.scene = new THREE.Scene();
    this.camera = new THREE.PerspectiveCamera(36, 16 / 9, 0.1, 60);
    this.camera.position.set(4.9, 2.0, 5.4);
    this.camera.lookAt(0, 0.55, 0);

    this.scene.add(new THREE.HemisphereLight(0x9fb4e8, 0x14161c, 0.95));
    const key = new THREE.DirectionalLight(0xffffff, 1.7);
    key.position.set(4, 7, 3);
    this.scene.add(key);
    const rim = new THREE.DirectionalLight(0x66aaff, 1.0);
    rim.position.set(-5, 3, -4);
    this.scene.add(rim);

    const disc = new THREE.Mesh(
      new THREE.CylinderGeometry(2.7, 2.85, 0.16, 48),
      new THREE.MeshStandardMaterial({ color: 0x10131b, roughness: 0.35, metalness: 0.6 })
    );
    disc.position.y = -0.08;
    this.scene.add(disc);
    this.ringMat = new THREE.MeshBasicMaterial({ color: 0xff3b30 });
    const ring = new THREE.Mesh(new THREE.TorusGeometry(2.66, 0.03, 8, 64), this.ringMat);
    ring.rotation.x = Math.PI / 2;
    ring.position.y = 0.01;
    this.scene.add(ring);

    this.car = null;
    this.angle = 0.65;
    this.running = false;
    this._loop = this._tick.bind(this);
  }

  setSpec(spec) {
    if (this.car) {
      this.car.traverse((o) => {
        if (o.isMesh) {
          o.geometry.dispose();
          if (Array.isArray(o.material)) o.material.forEach((m) => m.dispose());
          else o.material.dispose();
        }
      });
      this.scene.remove(this.car);
    }
    this.car = buildCarMesh(spec);
    this.scene.add(this.car);
    this.ringMat.color.setHex(spec.color);
  }

  show() {
    if (this.running) return;
    this.running = true;
    requestAnimationFrame(this._loop);
  }

  hide() { this.running = false; }

  _tick() {
    if (!this.running) return;
    requestAnimationFrame(this._loop);
    // keep the drawing buffer matched to the CSS size
    const w = this.canvas.clientWidth || 640, h = this.canvas.clientHeight || 360;
    if (this.canvas.width !== Math.round(w * this.renderer.getPixelRatio()) ) {
      this.renderer.setSize(w, h, false);
      this.camera.aspect = w / h;
      this.camera.updateProjectionMatrix();
    }
    this.angle += 0.008;
    if (this.car) this.car.rotation.y = this.angle;
    this.renderer.render(this.scene, this.camera);
  }
}

/* ---------- pooled particle system ---------- */
class ParticleSystem {
  constructor(scene, max = 900) {
    this.max = max;
    this.count = 0;
    this.data = new Array(max).fill(null).map(() => ({
      alive: false, x: 0, y: 0, z: 0, vx: 0, vy: 0, vz: 0,
      life: 0, maxLife: 1, size: 1, grow: 0, r: 1, g: 1, b: 1, a: 1,
    }));
    this.positions = new Float32Array(max * 3);
    this.colors = new Float32Array(max * 4);
    this.sizes = new Float32Array(max);

    const geo = new THREE.BufferGeometry();
    geo.setAttribute("position", new THREE.BufferAttribute(this.positions, 3));
    geo.setAttribute("color", new THREE.BufferAttribute(this.colors, 4));
    geo.setAttribute("size", new THREE.BufferAttribute(this.sizes, 1));

    const mat = new THREE.ShaderMaterial({
      transparent: true,
      depthWrite: false,
      blending: THREE.NormalBlending,
      vertexShader: `
        attribute float size;
        attribute vec4 color;
        varying vec4 vColor;
        void main() {
          vColor = color;
          vec4 mv = modelViewMatrix * vec4(position, 1.0);
          gl_PointSize = size * (240.0 / -mv.z);
          gl_Position = projectionMatrix * mv;
        }`,
      fragmentShader: `
        varying vec4 vColor;
        void main() {
          vec2 uv = gl_PointCoord - 0.5;
          float d = length(uv);
          float alpha = smoothstep(0.5, 0.12, d) * vColor.a;
          gl_FragColor = vec4(vColor.rgb, alpha);
        }`,
    });

    this.points = new THREE.Points(geo, mat);
    this.points.frustumCulled = false;
    scene.add(this.points);
    this._cursor = 0;
  }

  spawn(p) {
    // find a slot (ring cursor)
    let d = null;
    for (let tries = 0; tries < 8; tries++) {
      const i = this._cursor;
      this._cursor = (this._cursor + 1) % this.max;
      if (!this.data[i].alive) { d = this.data[i]; break; }
    }
    if (!d) { d = this.data[this._cursor]; this._cursor = (this._cursor + 1) % this.max; }
    d.alive = true;
    d.x = p.x; d.y = p.y; d.z = p.z;
    d.vx = p.vx || 0; d.vy = p.vy || 0; d.vz = p.vz || 0;
    d.life = 0; d.maxLife = p.life || 1;
    d.size = p.size || 1; d.grow = p.grow || 0;
    d.r = p.r !== undefined ? p.r : 1;
    d.g = p.g !== undefined ? p.g : 1;
    d.b = p.b !== undefined ? p.b : 1;
    d.a = p.a !== undefined ? p.a : 1;
    d.drag = p.drag !== undefined ? p.drag : 0.9;
    d.gravity = p.gravity || 0;
  }

  update(dt) {
    const pos = this.positions, col = this.colors, sz = this.sizes;
    for (let i = 0; i < this.max; i++) {
      const d = this.data[i];
      if (!d.alive) { sz[i] = 0; col[i * 4 + 3] = 0; continue; }
      d.life += dt;
      if (d.life >= d.maxLife) { d.alive = false; sz[i] = 0; col[i * 4 + 3] = 0; continue; }
      const drag = Math.pow(d.drag, dt * 60);
      d.vx *= drag; d.vy *= drag; d.vz *= drag;
      d.vy += d.gravity * dt;
      d.x += d.vx * dt; d.y += d.vy * dt; d.z += d.vz * dt;
      const t = d.life / d.maxLife;
      pos[i * 3] = d.x; pos[i * 3 + 1] = Math.max(d.y, 0.05); pos[i * 3 + 2] = d.z;
      col[i * 4] = d.r; col[i * 4 + 1] = d.g; col[i * 4 + 2] = d.b;
      col[i * 4 + 3] = d.a * (1 - t);
      sz[i] = d.size + d.grow * t * d.maxLife;
    }
    this.points.geometry.attributes.position.needsUpdate = true;
    this.points.geometry.attributes.color.needsUpdate = true;
    this.points.geometry.attributes.size.needsUpdate = true;
  }

  /* convenience emitters */
  smoke(x, y, z, intensity) {
    const n = Math.min(3, Math.ceil(intensity * 3));
    for (let i = 0; i < n; i++) {
      this.spawn({
        x: x + (Math.random() - 0.5) * 0.4, y, z: z + (Math.random() - 0.5) * 0.4,
        vx: (Math.random() - 0.5) * 1.5, vy: 0.8 + Math.random() * 1.2, vz: (Math.random() - 0.5) * 1.5,
        life: 0.7 + Math.random() * 0.6, size: 0.5 + intensity * 0.5, grow: 2.2,
        r: 0.75, g: 0.75, b: 0.78, a: 0.34 * intensity, drag: 0.94,
      });
    }
  }

  sparks(x, y, z, nx, nz, strength) {
    const n = 4 + Math.floor(strength * 8);
    for (let i = 0; i < n; i++) {
      this.spawn({
        x, y: y + Math.random() * 0.4, z,
        vx: nx * (2 + Math.random() * 5) + (Math.random() - 0.5) * 4,
        vy: 1 + Math.random() * 3,
        vz: nz * (2 + Math.random() * 5) + (Math.random() - 0.5) * 4,
        life: 0.25 + Math.random() * 0.3, size: 0.16, grow: 0,
        r: 1, g: 0.75 + Math.random() * 0.2, b: 0.25, a: 0.9,
        drag: 0.96, gravity: -9,
      });
    }
  }

  nitroFlame(x, y, z, hx, hz) {
    for (let i = 0; i < 2; i++) {
      this.spawn({
        x: x + (Math.random() - 0.5) * 0.2, y, z: z + (Math.random() - 0.5) * 0.2,
        vx: hx * (6 + Math.random() * 4), vy: (Math.random() - 0.5) * 0.8, vz: hz * (6 + Math.random() * 4),
        life: 0.14 + Math.random() * 0.12, size: 0.34, grow: -0.4,
        r: 0.3, g: 0.6, b: 1.0, a: 0.85, drag: 0.9,
      });
    }
  }
}
