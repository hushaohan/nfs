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

/* ---------- car mesh ---------- */
function buildCarMesh(spec) {
  const g = new THREE.Group();
  const body = new THREE.Color(spec.color);
  const dark = new THREE.Color(spec.accent);

  const paintMat = new THREE.MeshStandardMaterial({ color: body, roughness: 0.22, metalness: 0.7 });
  const darkMat  = new THREE.MeshStandardMaterial({ color: dark, roughness: 0.55, metalness: 0.35 });
  const glassMat = new THREE.MeshStandardMaterial({ color: 0x0d1a28, roughness: 0.05, metalness: 0.95 });
  const chromeMat = new THREE.MeshStandardMaterial({ color: 0xc8ccd4, roughness: 0.25, metalness: 0.95 });

  // axle positions: spec stores cgFront as a fraction of the wheelbase
  const cgToFront = spec.wheelbase * spec.cgFront;
  const cgToRear = spec.wheelbase - cgToFront;

  /* ---- main body: sculpted side profile, extruded across the width ---- */
  const hullProfile = [
    [ 2.30, 0.30],  // front lower lip
    [ 2.44, 0.44],  // nose tip
    [ 2.05, 0.56],  // hood leading edge
    [ 0.85, 0.66],  // hood
    [ 0.30, 0.78],  // cowl / beltline peak
    [-1.15, 0.80],  // rear deck
    [-2.05, 0.86],  // ducktail kick
    [-2.32, 0.62],  // tail face
    [-2.30, 0.30],  // rear lower
  ];
  g.add(extrudeProfile(hullProfile, 1.42, 0.17, paintMat));

  /* ---- greenhouse: fastback glass canopy ---- */
  const canopyProfile = [
    [ 0.78, 0.74],  // windshield base
    [ 0.22, 1.20],  // roof front
    [-0.62, 1.21],  // roof rear
    [-1.62, 0.80],  // fastback tail
  ];
  g.add(extrudeProfile(canopyProfile, 1.02, 0.10, glassMat));

  /* ---- fender arches over each wheel ---- */
  const archR = spec.wheelRadius + 0.16;
  const archGeo = new THREE.TorusGeometry(archR, 0.10, 6, 14, Math.PI);
  archGeo.rotateY(Math.PI / 2); // arc plane → ZY (length × height)
  const archPositions = [cgToFront, -cgToRear];
  const archX = spec.trackWidth / 2;
  for (const az of archPositions) {
    for (const sx of [-archX, archX]) {
      const arch = new THREE.Mesh(archGeo, paintMat);
      arch.position.set(sx, spec.wheelRadius * 0.95, az);
      arch.scale.set(1.15, 1.0, 1.0);
      arch.castShadow = true;
      g.add(arch);
    }
  }

  /* ---- side skirts ---- */
  for (const sx of [-0.90, 0.90]) {
    const skirt = new THREE.Mesh(new THREE.BoxGeometry(0.14, 0.18, 2.6), darkMat);
    skirt.position.set(sx, 0.24, -0.05);
    g.add(skirt);
  }

  /* ---- front splitter + intake ---- */
  const splitter = new THREE.Mesh(new THREE.BoxGeometry(1.82, 0.10, 0.55), darkMat);
  splitter.position.set(0, 0.18, 2.50);
  g.add(splitter);
  const intake = new THREE.Mesh(new THREE.BoxGeometry(1.15, 0.20, 0.12), darkMat);
  intake.position.set(0, 0.42, 2.53);
  g.add(intake);

  /* ---- hood vents ---- */
  for (const sx of [-0.34, 0.34]) {
    const vent = new THREE.Mesh(new THREE.BoxGeometry(0.30, 0.05, 0.62), darkMat);
    vent.position.set(sx, 0.78, 1.35);
    vent.rotation.x = -0.06;
    g.add(vent);
  }

  /* ---- side mirrors ---- */
  for (const sx of [-0.86, 0.86]) {
    const stalk = new THREE.Mesh(new THREE.BoxGeometry(0.16, 0.05, 0.05), darkMat);
    stalk.position.set(sx, 0.86, 0.62);
    g.add(stalk);
    const mir = new THREE.Mesh(new THREE.BoxGeometry(0.09, 0.11, 0.18), paintMat);
    mir.position.set(sx + Math.sign(sx) * 0.10, 0.90, 0.60);
    g.add(mir);
  }

  /* ---- rear wing on struts ---- */
  const wing = new THREE.Mesh(new THREE.BoxGeometry(1.78, 0.06, 0.44), darkMat);
  wing.position.set(0, 1.12, -2.18);
  wing.rotation.x = -0.10;
  wing.castShadow = true;
  g.add(wing);
  for (const sx of [-0.62, 0.62]) {
    const strut = new THREE.Mesh(new THREE.BoxGeometry(0.07, 0.30, 0.12), darkMat);
    strut.position.set(sx, 0.95, -2.14);
    g.add(strut);
  }

  /* ---- rear diffuser + exhausts ---- */
  const diffuser = new THREE.Mesh(new THREE.BoxGeometry(1.6, 0.16, 0.4), darkMat);
  diffuser.position.set(0, 0.22, -2.42);
  g.add(diffuser);
  for (const sx of [-0.42, 0.42]) {
    const exhaust = new THREE.Mesh(new THREE.CylinderGeometry(0.075, 0.09, 0.22, 10), chromeMat);
    exhaust.rotation.x = Math.PI / 2;
    exhaust.position.set(sx, 0.36, -2.48);
    g.add(exhaust);
  }

  /* ---- headlights (angled slits) ---- */
  const lightMat = new THREE.MeshBasicMaterial({ color: 0xfff6d8 });
  for (const sx of [-0.58, 0.58]) {
    const hl = new THREE.Mesh(new THREE.BoxGeometry(0.44, 0.09, 0.10), lightMat);
    hl.position.set(sx, 0.50, 2.53);
    hl.rotation.x = 0.18;
    g.add(hl);
  }

  /* ---- full-width tail light bar (brake glow) ---- */
  const tailMat = new THREE.MeshBasicMaterial({ color: 0x550000 });
  const tailBar = new THREE.Mesh(new THREE.BoxGeometry(1.55, 0.09, 0.06), tailMat);
  tailBar.position.set(0, 0.66, -2.47);
  g.add(tailBar);
  g.userData.tailMat = tailMat;

  /* ---- wheels: tire + spoked rim + brake disc ---- */
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

    // children[0]: rotating assembly (tire + rim + spokes + hub)
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

    // children[1]: brake disc (also spins)
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
