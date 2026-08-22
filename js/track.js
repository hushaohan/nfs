/* =====================================================================
 * track.js — Track generation: spline circuit, road mesh, barriers,
 * scenery (trees, buildings, streetlights), and spatial queries used
 * by the AI and the game logic.
 * ===================================================================== */
"use strict";

class Track {
  constructor(scene, opts = {}) {
    this.scene = scene;
    this.width = opts.width || 14;          // road half-width * 2
    this.halfW = this.width / 2;
    this.barrierDist = this.halfW + 1.2;    // distance of barriers from center
    this.samples = [];                      // dense sampled points
    this.length = 0;                        // total track length (m)
    this.group = new THREE.Group();
    scene.add(this.group);

    this._buildControlPoints();
    this._sampleSpline();
    this._buildRoad();
    this._buildBarriers();
    this._buildStartLine();
    this._buildScenery();
  }

  /* ---------- control points for a varied street circuit ---------- */
  _buildControlPoints() {
    // hand-tuned circuit: long straights, hairpins, sweepers, chicane
    const P = [
      [   0,    0], [ 120,    0], [ 220,   10], [ 300,   60],
      [ 330,  150], [ 300,  230], [ 210,  260], [ 120,  240],
      [  60,  290], [  90,  370], [ 180,  400], [ 280,  380],
      [ 360,  420], [ 380,  510], [ 320,  580], [ 210,  600],
      [ 100,  570], [  20,  490], [ -60,  430], [-150,  420],
      [-230,  360], [-260,  260], [-230,  160], [-150,  100],
      [ -80,   50],
    ];
    this.controlPoints = P.map(p => new THREE.Vector3(p[0], 0, p[1]));
    this.curve = new THREE.CatmullRomCurve3(this.controlPoints, true, "catmullrom", 0.5);
  }

  /* ---------- dense sampling with arc-length table ---------- */
  _sampleSpline() {
    const N = 1400;
    this.samples = [];
    let acc = 0;
    let prev = null;
    for (let i = 0; i < N; i++) {
      const t = i / N;
      const p = this.curve.getPointAt(t);
      const tan = this.curve.getTangentAt(t);
      tan.y = 0; tan.normalize();
      if (prev) acc += p.distanceTo(prev);
      this.samples.push({
        pos: p, tan,
        // left normal (perpendicular)
        nx: -tan.z, nz: tan.x,
        dist: acc, t,
      });
      prev = p;
    }
    this.length = acc + this.samples[0].pos.distanceTo(prev);
  }

  /* nearest sample index to a world point (coarse→fine) */
  nearestIndex(x, z, hint = -1) {
    let best = 0, bestD = Infinity;
    if (hint >= 0) {
      // local search around hint
      const N = this.samples.length;
      for (let k = -40; k <= 40; k++) {
        const i = (hint + k + N) % N;
        const s = this.samples[i];
        const dx = s.pos.x - x, dz = s.pos.z - z;
        const d = dx * dx + dz * dz;
        if (d < bestD) { bestD = d; best = i; }
      }
      return best;
    }
    for (let i = 0; i < this.samples.length; i += 4) {
      const s = this.samples[i];
      const dx = s.pos.x - x, dz = s.pos.z - z;
      const d = dx * dx + dz * dz;
      if (d < bestD) { bestD = d; best = i; }
    }
    // refine
    const N = this.samples.length;
    for (let k = -4; k <= 4; k++) {
      const i = (best + k + N) % N;
      const s = this.samples[i];
      const dx = s.pos.x - x, dz = s.pos.z - z;
      const d = dx * dx + dz * dz;
      if (d < bestD) { bestD = d; best = i; }
    }
    return best;
  }

  /* signed lateral offset from centerline (+ = left of direction) */
  lateralOffset(x, z, idx) {
    const s = this.samples[idx];
    return (x - s.pos.x) * s.nx + (z - s.pos.z) * s.nz;
  }

  /* point at normalized distance t (0..1) with lateral offset */
  pointAt(t, lateral = 0) {
    const N = this.samples.length;
    const i = ((t % 1) + 1) % 1 * N | 0;
    const s = this.samples[i % N];
    return {
      x: s.pos.x + s.nx * lateral,
      z: s.pos.z + s.nz * lateral,
      tan: s.tan, idx: i % N,
    };
  }

  /* ---------- road ribbon mesh ---------- */
  _buildRoad() {
    const N = this.samples.length;
    const positions = [];
    const uvs = [];
    const indices = [];
    const hw = this.halfW;

    for (let i = 0; i <= N; i++) {
      const s = this.samples[i % N];
      const l = i / N * this.length;
      // left & right edge
      positions.push(s.pos.x + s.nx * hw, 0.02, s.pos.z + s.nz * hw);
      positions.push(s.pos.x - s.nx * hw, 0.02, s.pos.z - s.nz * hw);
      uvs.push(0, l / 8); uvs.push(1, l / 8);
      if (i < N) {
        const a = i * 2, b = i * 2 + 1, c = i * 2 + 2, d = i * 2 + 3;
        indices.push(a, b, c, b, d, c);
      }
    }

    const geo = new THREE.BufferGeometry();
    geo.setAttribute("position", new THREE.Float32BufferAttribute(positions, 3));
    geo.setAttribute("uv", new THREE.Float32BufferAttribute(uvs, 2));
    geo.setIndex(indices);
    geo.computeVertexNormals();

    const tex = this._makeRoadTexture();
    const mat = new THREE.MeshStandardMaterial({
      map: tex, roughness: 0.92, metalness: 0.05, color: 0x9a9a9a,
    });
    const road = new THREE.Mesh(geo, mat);
    road.receiveShadow = true;
    this.group.add(road);

    // ground plane
    const groundGeo = new THREE.PlaneGeometry(2400, 2400);
    const groundMat = new THREE.MeshStandardMaterial({ color: 0x1c2a1e, roughness: 1 });
    const ground = new THREE.Mesh(groundGeo, groundMat);
    ground.rotation.x = -Math.PI / 2;
    ground.position.set(60, -0.05, 300);
    ground.receiveShadow = true;
    this.group.add(ground);
  }

  _makeRoadTexture() {
    const c = document.createElement("canvas");
    c.width = 256; c.height = 256;
    const g = c.getContext("2d");
    // asphalt base
    g.fillStyle = "#2b2d31";
    g.fillRect(0, 0, 256, 256);
    // noise
    for (let i = 0; i < 2600; i++) {
      const v = 38 + Math.random() * 26 | 0;
      g.fillStyle = `rgb(${v},${v},${v + 2})`;
      g.fillRect(Math.random() * 256, Math.random() * 256, 2, 2);
    }
    // edge lines
    g.fillStyle = "#d8d8d0";
    g.fillRect(6, 0, 5, 256);
    g.fillRect(245, 0, 5, 256);
    // dashed center line
    g.fillStyle = "#e8c840";
    for (let y = 0; y < 256; y += 64) g.fillRect(125, y, 6, 34);
    const tex = new THREE.CanvasTexture(c);
    tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
    tex.anisotropy = 4;
    return tex;
  }

  /* ---------- barriers (red/white curbs + walls) ---------- */
  _buildBarriers() {
    const N = this.samples.length;
    const step = 3; // every 3rd sample
    const wallGeo = new THREE.BoxGeometry(1, 1, 1);
    const matRed = new THREE.MeshStandardMaterial({ color: 0xd0342c, roughness: 0.7 });
    const matWhite = new THREE.MeshStandardMaterial({ color: 0xe8e8e8, roughness: 0.7 });
    const matCurbR = new THREE.MeshStandardMaterial({ color: 0xd0342c, roughness: 0.8 });
    const matCurbW = new THREE.MeshStandardMaterial({ color: 0xf0f0f0, roughness: 0.8 });

    const walls = [];
    const curbs = [];
    for (let i = 0; i < N; i += step) {
      const s = this.samples[i];
      const next = this.samples[(i + step) % N];
      const segLen = s.pos.distanceTo(next.pos) * 1.15;
      const mx = (s.pos.x + next.pos.x) / 2, mz = (s.pos.z + next.pos.z) / 2;
      const ang = Math.atan2(next.pos.x - s.pos.x, next.pos.z - s.pos.z);
      const alt = (i / step) % 2 === 0;

      for (const side of [1, -1]) {
        const bx = mx + s.nx * side * this.barrierDist;
        const bz = mz + s.nz * side * this.barrierDist;
        walls.push({ x: bx, z: bz, ang, len: segLen, mat: alt ? matRed : matWhite });
        // curbs just inside the barrier
        const cx = mx + s.nx * side * (this.halfW + 0.35);
        const cz = mz + s.nz * side * (this.halfW + 0.35);
        curbs.push({ x: cx, z: cz, ang, len: segLen, mat: alt ? matCurbR : matCurbW });
      }
    }

    // merge via InstancedMesh for performance
    const wallMesh = new THREE.InstancedMesh(wallGeo, matRed, walls.length);
    const dummy = new THREE.Object3D();
    const color = new THREE.Color();
    walls.forEach((w, i) => {
      dummy.position.set(w.x, 0.55, w.z);
      dummy.rotation.set(0, w.ang, 0);
      dummy.scale.set(0.5, 1.1, w.len);
      dummy.updateMatrix();
      wallMesh.setMatrixAt(i, dummy.matrix);
      wallMesh.setColorAt(i, color.setHex(w.mat === matRed ? 0xd0342c : 0xe8e8e8));
    });
    wallMesh.instanceMatrix.needsUpdate = true;
    wallMesh.castShadow = true;
    this.group.add(wallMesh);

    const curbMesh = new THREE.InstancedMesh(wallGeo, matCurbR, curbs.length);
    curbs.forEach((w, i) => {
      dummy.position.set(w.x, 0.06, w.z);
      dummy.rotation.set(0, w.ang, 0);
      dummy.scale.set(1.1, 0.12, w.len);
      dummy.updateMatrix();
      curbMesh.setMatrixAt(i, dummy.matrix);
      curbMesh.setColorAt(i, color.setHex(w.mat === matCurbR ? 0xd0342c : 0xf0f0f0));
    });
    curbMesh.instanceMatrix.needsUpdate = true;
    this.group.add(curbMesh);
  }

  /* ---------- start / finish line ---------- */
  _buildStartLine() {
    const s = this.samples[0];
    const c = document.createElement("canvas");
    c.width = 128; c.height = 32;
    const g = c.getContext("2d");
    for (let x = 0; x < 16; x++) for (let y = 0; y < 4; y++) {
      g.fillStyle = (x + y) % 2 ? "#111" : "#eee";
      g.fillRect(x * 8, y * 8, 8, 8);
    }
    const tex = new THREE.CanvasTexture(c);
    const geo = new THREE.PlaneGeometry(this.width, 3);
    const mat = new THREE.MeshStandardMaterial({ map: tex, roughness: 0.8 });
    const line = new THREE.Mesh(geo, mat);
    line.rotation.x = -Math.PI / 2;
    line.position.set(s.pos.x, 0.035, s.pos.z);
    line.rotation.z = Math.atan2(s.tan.x, s.tan.z);
    this.group.add(line);

    // gantry
    const gMat = new THREE.MeshStandardMaterial({ color: 0x30343c, roughness: 0.5, metalness: 0.6 });
    const postGeo = new THREE.BoxGeometry(0.5, 7, 0.5);
    for (const side of [1, -1]) {
      const post = new THREE.Mesh(postGeo, gMat);
      post.position.set(s.pos.x + s.nx * side * (this.halfW + 2), 3.5, s.pos.z + s.nz * side * (this.halfW + 2));
      post.castShadow = true;
      this.group.add(post);
    }
    const beam = new THREE.Mesh(new THREE.BoxGeometry(this.width + 5, 1.2, 0.6), gMat);
    beam.position.set(s.pos.x, 6.6, s.pos.z);
    beam.rotation.y = Math.atan2(s.nx, s.nz);
    beam.castShadow = true;
    this.group.add(beam);
  }

  /* ---------- scenery: trees, buildings, streetlights ---------- */
  _buildScenery() {
    const N = this.samples.length;

    // trees (instanced: trunk + canopy)
    const treePos = [];
    for (let i = 0; i < N; i += 22) {
      const s = this.samples[i];
      for (const side of [1, -1]) {
        if (Math.random() < 0.55) {
          const d = this.barrierDist + 6 + Math.random() * 26;
          treePos.push({ x: s.pos.x + s.nx * side * d, z: s.pos.z + s.nz * side * d, s: 0.8 + Math.random() * 0.9 });
        }
      }
    }
    const trunkGeo = new THREE.CylinderGeometry(0.22, 0.34, 2.4, 6);
    const trunkMat = new THREE.MeshStandardMaterial({ color: 0x5a4632, roughness: 1 });
    const canopyGeo = new THREE.ConeGeometry(1.9, 4.6, 7);
    const canopyMat = new THREE.MeshStandardMaterial({ color: 0x2e6b34, roughness: 1 });
    const trunks = new THREE.InstancedMesh(trunkGeo, trunkMat, treePos.length);
    const canopies = new THREE.InstancedMesh(canopyGeo, canopyMat, treePos.length);
    const dummy = new THREE.Object3D();
    const col = new THREE.Color();
    treePos.forEach((t, i) => {
      dummy.position.set(t.x, 1.2 * t.s, t.z);
      dummy.scale.setScalar(t.s);
      dummy.rotation.set(0, Math.random() * 6.28, 0);
      dummy.updateMatrix();
      trunks.setMatrixAt(i, dummy.matrix);
      dummy.position.set(t.x, (2.4 + 2.0) * t.s, t.z);
      dummy.updateMatrix();
      canopies.setMatrixAt(i, dummy.matrix);
      canopies.setColorAt(i, col.setHSL(0.32 + Math.random() * 0.06, 0.5, 0.28 + Math.random() * 0.12));
    });
    trunks.castShadow = canopies.castShadow = true;
    this.group.add(trunks, canopies);

    // city buildings clustered near the first sector
    const bGeo = new THREE.BoxGeometry(1, 1, 1);
    const bMat = new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.85 });
    const buildings = [];
    for (let i = 0; i < N; i += 30) {
      const s = this.samples[i];
      if (Math.random() < 0.4) {
        const side = Math.random() < 0.5 ? 1 : -1;
        const d = this.barrierDist + 18 + Math.random() * 30;
        const w = 8 + Math.random() * 14;
        const h = 10 + Math.random() * 42;
        buildings.push({ x: s.pos.x + s.nx * side * d, z: s.pos.z + s.nz * side * d, w, h, d: w, hue: Math.random() });
      }
    }
    const bMesh = new THREE.InstancedMesh(bGeo, bMat, buildings.length);
    buildings.forEach((b, i) => {
      dummy.position.set(b.x, b.h / 2, b.z);
      dummy.scale.set(b.w, b.h, b.d);
      dummy.rotation.set(0, Math.random() * 0.4, 0);
      dummy.updateMatrix();
      bMesh.setMatrixAt(i, dummy.matrix);
      const l = 0.16 + b.hue * 0.2;
      bMesh.setColorAt(i, col.setHSL(0.6, 0.12, l));
    });
    bMesh.castShadow = true;
    this.group.add(bMesh);

    // streetlights along the track
    const poleGeo = new THREE.CylinderGeometry(0.09, 0.12, 5.4, 6);
    const poleMat = new THREE.MeshStandardMaterial({ color: 0x3a3f48, metalness: 0.7, roughness: 0.4 });
    const lampGeo = new THREE.SphereGeometry(0.28, 8, 8);
    const lampMat = new THREE.MeshBasicMaterial({ color: 0xffe9b0 });
    const poles = [];
    for (let i = 0; i < N; i += 46) {
      const s = this.samples[i];
      const side = (i / 46) % 2 === 0 ? 1 : -1;
      poles.push({ x: s.pos.x + s.nx * side * (this.barrierDist + 2.2), z: s.pos.z + s.nz * side * (this.barrierDist + 2.2) });
    }
    const poleMesh = new THREE.InstancedMesh(poleGeo, poleMat, poles.length);
    const lampMesh = new THREE.InstancedMesh(lampGeo, lampMat, poles.length);
    poles.forEach((p, i) => {
      dummy.position.set(p.x, 2.7, p.z);
      dummy.scale.setScalar(1);
      dummy.rotation.set(0, 0, 0);
      dummy.updateMatrix();
      poleMesh.setMatrixAt(i, dummy.matrix);
      dummy.position.set(p.x, 5.5, p.z);
      dummy.updateMatrix();
      lampMesh.setMatrixAt(i, dummy.matrix);
    });
    this.group.add(poleMesh, lampMesh);
  }

  /* ---------- collision: keep a point inside the barriers ----------
   * Returns corrected {x, z, hitNormal:{x,z}, hit:boolean}            */
  collide(x, z, hintIdx) {
    const idx = this.nearestIndex(x, z, hintIdx);
    const s = this.samples[idx];
    const lat = this.lateralOffset(x, z, idx);
    const limit = this.barrierDist - 0.9;
    if (Math.abs(lat) > limit) {
      const over = Math.abs(lat) - limit;
      const side = tsign(lat);
      return {
        x: x - s.nx * side * over,
        z: z - s.nz * side * over,
        nx: -s.nx * side, nz: -s.nz * side,
        hit: true, idx,
      };
    }
    return { x, z, nx: 0, nz: 0, hit: false, idx };
  }
}

function tsign(v) { return v > 0 ? 1 : v < 0 ? -1 : 0; }
