/* =====================================================================
 * track.js — Track generation: spline circuit, road mesh, barriers,
 * scenery (trees, buildings, streetlights), and spatial queries used
 * by the AI and the game logic.
 * ===================================================================== */
"use strict";

class Track {
  constructor(scene, opts = {}) {
    this.scene = scene;
    this.key = opts.key || "downtown";
    this.name = opts.name || "DOWNTOWN CIRCUIT";
    this.env = opts.env || {};
    this.width = opts.width || 14;          // road half-width * 2
    this.halfW = this.width / 2;
    this.barrierDist = this.halfW + 1.2;    // distance of barriers from center
    this.samples = [];                      // dense sampled points
    this.length = 0;                        // total track length (m)
    this.group = new THREE.Group();
    scene.add(this.group);

    this._buildControlPoints(opts.points);
    this._sampleSpline();
    this._buildRoad();
    this._buildTerrain();
    this._buildBarriers();
    this._buildSigns();
    this._buildStartLine();
    this._buildScenery();
  }

  /* ---------- control points (x, z, elevation y) ---------- */
  _buildControlPoints(points) {
    // default: hand-tuned flat street circuit — long straights, hairpins,
    // sweepers, chicane
    const P = points || [
      [   0,    0, 0], [ 120,    0, 0], [ 220,   10, 0], [ 300,   60, 0],
      [ 330,  150, 0], [ 300,  230, 0], [ 210,  260, 0], [ 120,  240, 0],
      [  60,  290, 0], [  90,  370, 0], [ 180,  400, 0], [ 280,  380, 0],
      [ 360,  420, 0], [ 380,  510, 0], [ 320,  580, 0], [ 210,  600, 0],
      [ 100,  570, 0], [  20,  490, 0], [ -60,  430, 0], [-150,  420, 0],
      [-230,  360, 0], [-260,  260, 0], [-230,  160, 0], [-150,  100, 0],
      [ -80,   50, 0],
    ];
    this.controlPoints = P.map(p => new THREE.Vector3(p[0], p[2] || 0, p[1]));
    // lift the whole loop so the lowest point sits just above the flat
    // terrain plane — otherwise downhill sections get buried under it
    const minY = Math.min(...this.controlPoints.map(p => p.y));
    if (minY < 1) {
      const lift = 1 - minY;
      for (const p of this.controlPoints) p.y += lift;
    }
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
      y: s.pos.y,
      z: s.pos.z + s.nz * lateral,
      tan: s.tan, idx: i % N,
    };
  }

  /* road surface height at a world point (nearest sample) */
  heightAt(x, z, hint = -1) {
    return this.samples[this.nearestIndex(x, z, hint)].pos.y;
  }

  /* track gradient dh/dd at sample idx (positive = climbing) */
  slopeAt(idx) {
    const N = this.samples.length;
    const a = this.samples[((idx - 3) % N + N) % N].pos.y;
    const b = this.samples[(idx + 3) % N].pos.y;
    const d = (this.length / N) * 6;   // arc length between the two probes
    return (b - a) / d;
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
      positions.push(s.pos.x + s.nx * hw, s.pos.y + 0.02, s.pos.z + s.nz * hw);
      positions.push(s.pos.x - s.nx * hw, s.pos.y + 0.02, s.pos.z - s.nz * hw);
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

    /* optional neon edge strips (night tracks): unlit glowing rails that
     * trace the road so it reads clearly against a dark world */
    const eg = this.env.roadEdgeGlow;
    if (eg) {
      const N3 = Math.ceil(N / 3);
      const mkSide = (colorHex, sideSign) => {
        const mesh = new THREE.InstancedMesh(
          new THREE.BoxGeometry(1, 1, 1),
          new THREE.MeshBasicMaterial({ color: colorHex }),
          N3
        );
        const dummy = new THREE.Object3D();
        let k = 0;
        for (let i = 0; i < N; i += 3) {
          const s = this.samples[i];
          const next = this.samples[(i + 3) % N];
          const segLen = s.pos.distanceTo(next.pos) * 1.12;
          dummy.position.set(
            s.pos.x + s.nx * sideSign * (this.halfW + 0.85),
            s.pos.y + 0.10,
            s.pos.z + s.nz * sideSign * (this.halfW + 0.85)
          );
          dummy.rotation.set(0, Math.atan2(next.pos.x - s.pos.x, next.pos.z - s.pos.z), 0);
          dummy.scale.set(0.14, 0.05, segLen);
          dummy.updateMatrix();
          mesh.setMatrixAt(k++, dummy.matrix);
        }
        mesh.instanceMatrix.needsUpdate = true;
        this.group.add(mesh);
      };
      mkSide(eg[0], 1);    // left edge
      mkSide(eg[1], -1);   // right edge
    }
  }

  /* ---------- embankment skirts: drop the road edges to the ground so
   * hilly sections look like solid earthworks instead of floating ribbons */
  /* ---------- rolling terrain that hugs the road ----------
   * A heightfield over the track bounds. Near the road it matches the
   * road elevation exactly (the landscape rises into the roadbed); with
   * distance it falls off into procedural grass hills. This replaces
   * the old flat ground plane so hilly tracks look like real hills.   */
  _buildTerrain() {
    const N = this.samples.length;

    // bounds + margin
    let minX = Infinity, maxX = -Infinity, minZ = Infinity, maxZ = -Infinity;
    for (const s of this.samples) {
      minX = Math.min(minX, s.pos.x); maxX = Math.max(maxX, s.pos.x);
      minZ = Math.min(minZ, s.pos.z); maxZ = Math.max(maxZ, s.pos.z);
    }
    const M = 150;
    minX -= M; minZ -= M; maxX += M; maxZ += M;
    const sx = maxX - minX, sz = maxZ - minZ;

    // spatial hash of samples for fast nearest-road queries
    const CS = 30;
    const buckets = new Map();
    this.samples.forEach((s, i) => {
      const k = Math.floor(s.pos.x / CS) + "_" + Math.floor(s.pos.z / CS);
      if (!buckets.has(k)) buckets.set(k, []);
      buckets.get(k).push(i);
    });
    const nearest = (x, z) => {
      const bx = Math.floor(x / CS), bz = Math.floor(z / CS);
      let best = -1, bd = Infinity;
      for (let ox = -2; ox <= 2; ox++) for (let oz = -2; oz <= 2; oz++) {
        const arr = buckets.get((bx + ox) + "_" + (bz + oz));
        if (!arr) continue;
        for (const i of arr) {
          const s = this.samples[i];
          const dx = s.pos.x - x, dz = s.pos.z - z;
          const d = dx * dx + dz * dz;
          if (d < bd) { bd = d; best = i; }
        }
      }
      if (best < 0) {  // far outside coverage: coarse scan
        for (let i = 0; i < N; i += 4) {
          const s = this.samples[i];
          const dx = s.pos.x - x, dz = s.pos.z - z;
          const d = dx * dx + dz * dz;
          if (d < bd) { bd = d; best = i; }
        }
      }
      return { d: Math.sqrt(bd), y: this.samples[best].pos.y };
    };

    // blend: road height near the road → procedural hills far away
    const inner = this.barrierDist + 5;
    const outer = inner + 62;
    const height = (x, z) => {
      const { d, y } = nearest(x, z);
      const road = y - 0.06;                       // tuck under the ribbon
      if (d <= inner) return road;
      // fade procedural hills toward the field border so no cliff shows
      const ex = Math.min(x - minX, maxX - x) / 120;
      const ez = Math.min(z - minZ, maxZ - z) / 120;
      const ef = 0.06 + 0.94 * Math.min(1, Math.max(0, Math.min(ex, ez)) * Math.min(1, Math.min(ex, ez)) * (3 - 2 * Math.min(1, Math.min(ex, ez))));
      const hills = Math.max(0.35, this._hillNoise(x, z)) * ef;
      if (d >= outer) return hills;
      const t = (d - inner) / (outer - inner);
      const sBlend = t * t * (3 - 2 * t);          // smoothstep
      return road * (1 - sBlend) + hills * sBlend;
    };
    this._terrainHeight = height;

    // grid mesh (+ UVs and per-vertex tinting: slopes turn to rock,
    // high altitudes pick up snow where the environment defines a line)
    const cell = 3.4;
    const nx = Math.max(8, Math.min(250, Math.round(sx / cell)));
    const nz = Math.max(8, Math.min(250, Math.round(sz / cell)));
    const positions = [];
    const uvs = [];
    const indices = [];
    for (let r = 0; r <= nz; r++) {
      for (let c = 0; c <= nx; c++) {
        const x = minX + sx * c / nx;
        const z = minZ + sz * r / nz;
        positions.push(x, height(x, z), z);
        uvs.push(c / nx, r / nz);
      }
    }
    for (let r = 0; r < nz; r++) {
      for (let c = 0; c < nx; c++) {
        const a = r * (nx + 1) + c, b = a + 1, d = a + nx + 1, e = d + 1;
        indices.push(a, d, b, b, d, e);
      }
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute("position", new THREE.Float32BufferAttribute(positions, 3));
    geo.setAttribute("uv", new THREE.Float32BufferAttribute(uvs, 2));
    geo.setIndex(indices);
    geo.computeVertexNormals();

    // per-vertex tint from local slope (rocky) and altitude (snowline)
    {
      const hAt = (r, c) => positions[(r * (nx + 1) + c) * 3 + 1];
      const rockTint = new THREE.Color(this.env.rockTint !== undefined ? this.env.rockTint : 0x8a8578);
      const snowTint = new THREE.Color(0xf2f7fd);
      const snowAbove = this.env.snowAbove !== undefined ? this.env.snowAbove : null;
      const base = new THREE.Color(0xffffff);
      const cols = new Float32Array((nx + 1) * (nz + 1) * 3);
      const dxStep = sx / nx, dzStep = sz / nz;
      let vi = 0;
      for (let r = 0; r <= nz; r++) {
        for (let c = 0; c <= nx; c++) {
          const cl = Math.max(0, c - 1), cr = Math.min(nx, c + 1);
          const rl = Math.max(0, r - 1), ru = Math.min(nz, r + 1);
          const gx = (hAt(r, cr) - hAt(r, cl)) / ((cr - cl) * dxStep || 1);
          const gz = (hAt(ru, c) - hAt(rl, c)) / ((ru - rl) * dzStep || 1);
          const slope = Math.sqrt(gx * gx + gz * gz);
          const y = hAt(r, c);
          const col = base.clone();
          // steep → exposed rock
          const rocky = Math.min(1, Math.max(0, (slope - 0.55) / 0.85));
          col.lerp(rockTint, rocky * 0.85);
          // altitude → snow cap
          if (snowAbove !== null) {
            const sn = Math.min(1, Math.max(0, (y - snowAbove) / 7));
            col.lerp(snowTint, sn * (1 - rocky * 0.4));
          }
          cols[vi++] = col.r; cols[vi++] = col.g; cols[vi++] = col.b;
        }
      }
      geo.setAttribute("color", new THREE.BufferAttribute(cols, 3));
    }

    const gTex = TEX.ground(this.env.groundTex || "grass");
    gTex.repeat.set(sx / 9, sz / 9);
    const mat = new THREE.MeshStandardMaterial({
      map: gTex,
      color: this.env.terrainTint !== undefined ? this.env.terrainTint : 0xffffff,
      roughness: 1,
      vertexColors: true,
    });
    const terrain = new THREE.Mesh(geo, mat);
    terrain.receiveShadow = true;
    this.group.add(terrain);

    // distant backdrop floor beyond the heightfield (fog hides the seam)
    const fTex = TEX.ground(this.env.groundTex || "grass");
    fTex.repeat.set(90, 90);
    const ground = new THREE.Mesh(
      new THREE.PlaneGeometry(4000, 4000),
      new THREE.MeshStandardMaterial({
        map: fTex,
        color: this.env.terrainTint !== undefined
          ? new THREE.Color(this.env.terrainTint).multiplyScalar(0.5)
          : 0x777777,
        roughness: 1,
      })
    );
    ground.rotation.x = -Math.PI / 2;
    ground.position.set((minX + maxX) / 2, -0.4, (minZ + maxZ) / 2);
    ground.receiveShadow = true;
    this.group.add(ground);
  }

  /* smooth procedural hills for the away-from-road terrain */
  _hillNoise(x, z) {
    const amp = this.env.hillAmp !== undefined ? this.env.hillAmp : 1;
    const fr = this.env.hillFreq !== undefined ? this.env.hillFreq : 1;
    return 2.8
      + amp * (1.5 * Math.sin(x * 0.012 * fr + 1.3) * Math.cos(z * 0.010 * fr + 0.7)
             + 1.1 * Math.sin(x * 0.021 * fr + z * 0.017 * fr + 2.1)
             + 0.8 * Math.cos(x * 0.007 * fr - z * 0.008 * fr + 0.4));
  }

  _makeRoadTexture() {
    // rich procedural asphalt: aggregate noise, tire-wear bands, painted
    // edge lines + dashed center, cracks and patch repairs (js/textures.js)
    return TEX.asphalt();
  }

  /* ---------- barriers (red/white curbs + walls) ---------- */
  _buildBarriers() {
    const N = this.samples.length;
    const step = 3; // every 3rd sample
    const wallGeo = new THREE.BoxGeometry(1, 1, 1);
    // concrete walls with scuffed texture, tinted per environment
    const wallTint = this.env.wallTint !== undefined ? this.env.wallTint : 0xffffff;
    const matRed = new THREE.MeshStandardMaterial({ map: TEX.wall(), color: new THREE.Color(0xd0342c).lerp(new THREE.Color(wallTint), 0.35), roughness: 0.7 });
    const matWhite = new THREE.MeshStandardMaterial({ map: TEX.wall(), color: new THREE.Color(0xe8e8e8).lerp(new THREE.Color(wallTint), 0.35), roughness: 0.7 });
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
        walls.push({ x: bx, y: s.pos.y + 0.55, z: bz, ang, len: segLen, mat: alt ? matRed : matWhite });
        // curbs just inside the barrier
        const cx = mx + s.nx * side * (this.halfW + 0.35);
        const cz = mz + s.nz * side * (this.halfW + 0.35);
        curbs.push({ x: cx, y: s.pos.y + 0.06, z: cz, ang, len: segLen, mat: alt ? matCurbR : matCurbW });
      }
    }

    // merge via InstancedMesh for performance
    const wallMesh = new THREE.InstancedMesh(wallGeo, matRed, walls.length);
    const dummy = new THREE.Object3D();
    const color = new THREE.Color();
    walls.forEach((w, i) => {
      dummy.position.set(w.x, w.y, w.z);
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
      dummy.position.set(w.x, w.y, w.z);
      dummy.rotation.set(0, w.ang, 0);
      dummy.scale.set(1.1, 0.12, w.len);
      dummy.updateMatrix();
      curbMesh.setMatrixAt(i, dummy.matrix);
      curbMesh.setColorAt(i, color.setHex(w.mat === matCurbR ? 0xd0342c : 0xf0f0f0));
    });
    curbMesh.instanceMatrix.needsUpdate = true;
    this.group.add(curbMesh);
  }

  /* ---------- corner chevron signs ----------
   * Detect sustained curvature, then place arrow boards on the outside of
   * the bend facing the approaching driver. Capped for performance.      */
  _buildSigns() {
    if (this.env.signs === false) return;
    const N = this.samples.length;
    const LOOK = 7;                 // samples ahead for the tangent delta
    const THRESH = 0.045;           // rad per sample-step = notable corner

    // curvature + turn direction per sample
    const curve = new Float32Array(N);
    for (let i = 0; i < N; i++) {
      const t1 = this.samples[i].tan, t2 = this.samples[(i + LOOK) % N].tan;
      const cross = t1.x * t2.z - t1.z * t2.x;   // >0 turning left? (handedness)
      const dot = Math.max(-1, Math.min(1, t1.x * t2.x + t1.z * t2.z));
      curve[i] = Math.sign(cross) * Math.acos(dot);
    }

    // gather placements: run through corners, one board every 9 samples
    const posts = [];
    let sinceLast = 99, count = 0;
    const MAX = 44;
    for (let i = 0; i < N && count < MAX; i++) {
      const k = curve[i];
      if (Math.abs(k) < THRESH) { sinceLast = 99; continue; }
      if (++sinceLast < 9) continue;
      sinceLast = 0;
      const s = this.samples[i];
      // outside of the bend is opposite the turn direction
      const side = -Math.sign(k) || 1;
      const d = this.barrierDist + 1.8;
      posts.push({
        x: s.pos.x + s.nx * side * d,
        z: s.pos.z + s.nz * side * d,
        y: s.pos.y,
        dir: -side,                       // arrows point INTO the turn
        faceAng: Math.atan2(s.tan.x, s.tan.z),   // board faces oncoming cars
      });
      count++;
    }
    if (!posts.length) return;

    const postGeo = new THREE.BoxGeometry(0.09, 1.15, 0.09);
    const postMat = new THREE.MeshStandardMaterial({ color: 0x4a4e55, metalness: 0.6, roughness: 0.5 });
    const boardGeo = new THREE.PlaneGeometry(1.25, 1.25);
    const matL = new THREE.MeshStandardMaterial({
      map: TEX.chevron(-1), roughness: 0.6,
      emissive: 0xffffff, emissiveMap: TEX.chevron(-1), emissiveIntensity: 0.22,
    });
    const matR = new THREE.MeshStandardMaterial({
      map: TEX.chevron(1), roughness: 0.6,
      emissive: 0xffffff, emissiveMap: TEX.chevron(1), emissiveIntensity: 0.22,
    });

    const dummy = new THREE.Object3D();
    const byDir = { "1": [], "-1": [] };
    posts.forEach(p => byDir[String(p.dir)].push(p));
    for (const dir of [1, -1]) {
      const list = byDir[String(dir)];
      if (!list.length) continue;
      const boards = new THREE.InstancedMesh(boardGeo, dir > 0 ? matR : matL, list.length);
      const poles = new THREE.InstancedMesh(postGeo, postMat, list.length);
      list.forEach((p, i) => {
        dummy.position.set(p.x, p.y + 0.55, p.z);
        dummy.rotation.set(0, 0, 0);
        dummy.scale.setScalar(1);
        dummy.updateMatrix();
        poles.setMatrixAt(i, dummy.matrix);
        dummy.position.set(p.x, p.y + 1.35, p.z);
        dummy.rotation.set(0, p.faceAng, 0);
        dummy.updateMatrix();
        boards.setMatrixAt(i, dummy.matrix);
      });
      boards.castShadow = true;
      this.group.add(boards, poles);
    }
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
    line.position.set(s.pos.x, s.pos.y + 0.035, s.pos.z);
    line.rotation.z = Math.atan2(s.tan.x, s.tan.z);
    this.group.add(line);

    // gantry
    const gMat = new THREE.MeshStandardMaterial({ color: 0x30343c, roughness: 0.5, metalness: 0.6 });
    const postGeo = new THREE.BoxGeometry(0.5, 7, 0.5);
    for (const side of [1, -1]) {
      const post = new THREE.Mesh(postGeo, gMat);
      post.position.set(s.pos.x + s.nx * side * (this.halfW + 2), s.pos.y + 3.5, s.pos.z + s.nz * side * (this.halfW + 2));
      post.castShadow = true;
      this.group.add(post);
    }
    const beam = new THREE.Mesh(new THREE.BoxGeometry(this.width + 4, 1.2, 0.6), gMat);
    beam.position.set(s.pos.x, s.pos.y + 6.6, s.pos.z);
    // span ACROSS the road: align the beam's long (local X) axis with the
    // track normal, i.e. orthogonal to the driving direction
    beam.rotation.y = Math.atan2(-s.nz, s.nx);
    beam.castShadow = true;
    this.group.add(beam);
  }

  /* ---------- scenery: flora / buildings / streetlights ----------
   * Everything is driven by this.env so each track gets its own world:
   *   env.flora = null | { type:"pine"|"snowpine"|"cactus"|"rock"|"desert",
   *                        density, color, trunk }
   *   env.city  = null | { glow }          (window-lit buildings)
   *   env.lamps = null | { every, color }  (streetlight spacing/color) */
  _buildScenery() {
    const N = this.samples.length;
    const env = this.env;

    /* ----- flora ----- */
    const flora = env.flora;
    if (flora && flora.type) {
      const stride = Math.max(8, Math.round(22 / (flora.density || 1)));
      const spots = [];
      for (let i = 0; i < N; i += stride) {
        const s = this.samples[i];
        for (const side of [1, -1]) {
          const roll = Math.random();
          if (roll < 0.55) {
            const d = this.barrierDist + 6 + Math.random() * 26;
            spots.push({
              x: s.pos.x + s.nx * side * d,
              z: s.pos.z + s.nz * side * d,
              s: 0.8 + Math.random() * 0.9,
              kind: flora.type === "desert"
                ? (roll < 0.25 ? "rock" : roll < 0.42 ? "cactus" : "scrub")
                : flora.type,
            });
          }
        }
      }

      const dummy = new THREE.Object3D();
      const col = new THREE.Color();
      const gy = (p) => this._terrainHeight(p.x, p.z);

      if (flora.type === "pine" || flora.type === "snowpine") {
        const snowy = flora.type === "snowpine";
        const barkTex = TEX.bark();
        const trunkMat = new THREE.MeshStandardMaterial({ map: barkTex, color: flora.trunk || 0x8a6f52, roughness: 1 });
        const canMat = new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 1 });
        const trunkGeo = new THREE.CylinderGeometry(0.20, 0.34, 2.4, 6);
        // three canopy tiers for a fuller silhouette
        const tierGeo = [
          new THREE.ConeGeometry(1.95, 2.5, 7),
          new THREE.ConeGeometry(1.45, 2.2, 7),
          new THREE.ConeGeometry(0.95, 1.9, 7),
        ];
        const trunks = new THREE.InstancedMesh(trunkGeo, trunkMat, spots.length);
        const tiers = tierGeo.map(g => new THREE.InstancedMesh(g, canMat, spots.length));
        const capGeo = new THREE.ConeGeometry(0.72, 1.25, 7);
        const caps = snowy ? new THREE.InstancedMesh(capGeo, new THREE.MeshStandardMaterial({ color: 0xf2f7fb, roughness: 0.95 }), spots.length) : null;
        // bushes / snow drifts scattered alongside
        const under = [];
        for (let i = 0; i < spots.length; i++) {
          if (Math.random() < 0.6) {
            const s = spots[i];
            under.push({
              x: s.x + (Math.random() - 0.5) * 10,
              z: s.z + (Math.random() - 0.5) * 10,
              s: s.s,
            });
          }
        }
        const bushMat = snowy
          ? new THREE.MeshStandardMaterial({ color: 0xf4f8fd, roughness: 1 })
          : new THREE.MeshStandardMaterial({ color: 0x3a6b30, roughness: 1 });
        const bushGeo = new THREE.IcosahedronGeometry(0.55, 0);
        const bushes = new THREE.InstancedMesh(bushGeo, bushMat, Math.max(under.length, 1));

        const tint = new THREE.Color();
        const baseGreen = new THREE.Color(flora.color || (snowy ? 0x2e5a44 : 0x2e6b34));
        spots.forEach((p, i) => {
          const yBase = this._terrainHeight(p.x, p.z);
          dummy.rotation.set(0, Math.random() * 6.28, 0);
          dummy.scale.set(p.s, p.s * (0.9 + Math.random() * 0.25), p.s);
          dummy.position.set(p.x, yBase + 1.2 * p.s, p.z);
          dummy.updateMatrix();
          trunks.setMatrixAt(i, dummy.matrix);
          const heights = [2.9, 4.35, 5.65];
          tiers.forEach((tier, ti) => {
            dummy.position.set(p.x, yBase + heights[ti] * p.s, p.z);
            dummy.updateMatrix();
            tier.setMatrixAt(i, dummy.matrix);
            // per-tree hue/luminance jitter so the forest isn't cloned
            tint.copy(baseGreen).multiplyScalar(0.82 + Math.random() * 0.36);
            tier.setColorAt(i, tint);
          });
          if (caps) {
            dummy.position.set(p.x, yBase + 6.45 * p.s, p.z);
            dummy.updateMatrix();
            caps.setMatrixAt(i, dummy.matrix);
          }
        });
        under.forEach((u, i) => {
          const yBase = this._terrainHeight(u.x, u.z);
          dummy.position.set(u.x, yBase + 0.22 * u.s, u.z);
          dummy.scale.set(u.s * (0.9 + Math.random()), u.s * 0.55, u.s * (0.9 + Math.random()));
          dummy.rotation.set(0, Math.random() * 6.28, 0);
          dummy.updateMatrix();
          if (i < bushes.count) bushes.setMatrixAt(i, dummy.matrix);
        });
        trunks.castShadow = true;
        tiers.forEach(t => t.castShadow = true);
        this.group.add(trunks, ...tiers);
        if (caps) { caps.castShadow = true; this.group.add(caps); }
        if (under.length) { bushes.castShadow = !snowy; this.group.add(bushes); }

      } else if (flora.type === "cactus") {
        this._scatterCacti(spots, dummy, col, flora);

      } else if (flora.type === "rock") {
        this._scatterRocks(spots, dummy, col, flora);

      } else if (flora.type === "desert") {
        const cacti = spots.filter(p => p.kind === "cactus");
        const rocks = spots.filter(p => p.kind === "rock");
        const scrub = spots.filter(p => p.kind === "scrub");
        this._scatterCacti(cacti, dummy, col, flora);
        this._scatterRocks(rocks, dummy, col, flora);
        this._scatterScrub(scrub, dummy);
      }
    }

    /* ----- city blocks: facade variants, tiers, rooftop props, billboards ----- */
    const city = env.city;
    if (city) {
      const glow = city.glow !== undefined ? city.glow : 0.35;
      const facades = [TEX.facade(0), TEX.facade(1), TEX.facade(2)];
      const mats = facades.map(t => new THREE.MeshStandardMaterial({
        map: t, color: 0xbfc4cc, roughness: 0.85,
        emissive: 0xffffff, emissiveMap: t, emissiveIntensity: glow,
      }));
      const bGeo = new THREE.BoxGeometry(1, 1, 1);
      const buildings = [];
      for (let i = 0; i < N; i += 30) {
        const s = this.samples[i];
        if (Math.random() < 0.4) {
          const side = Math.random() < 0.5 ? 1 : -1;
          const d = this.barrierDist + 18 + Math.random() * 30;
          const w = 8 + Math.random() * 14;
          const h = 10 + Math.random() * 42;
          buildings.push({
            x: s.pos.x + s.nx * side * d, z: s.pos.z + s.nz * side * d,
            w, h, d: w, v: Math.random() * 3 | 0,
            nx: s.nx * side, nz: s.nz * side,   // road-facing normal
            rot: Math.random() * 0.4,
          });
        }
      }
      if (buildings.length) {
        const byVar = [[], [], []];
        buildings.forEach(b => byVar[b.v].push(b));
        const dummy = new THREE.Object3D();
        byVar.forEach((list, v) => {
          if (!list.length) return;
          const mesh = new THREE.InstancedMesh(bGeo, mats[v], list.length);
          list.forEach((b, i) => {
            const gy = this._terrainHeight(b.x, b.z);
            dummy.position.set(b.x, gy + b.h / 2, b.z);
            dummy.scale.set(b.w, b.h, b.d);
            dummy.rotation.set(0, b.rot, 0);
            dummy.updateMatrix();
            mesh.setMatrixAt(i, dummy.matrix);
          });
          mesh.castShadow = true;
          this.group.add(mesh);

          // tiered tops on the taller towers
          const talls = list.filter(b => b.h > 30 && Math.random() < 0.6);
          if (talls.length) {
            const tm = new THREE.InstancedMesh(bGeo, mats[v], talls.length);
            talls.forEach((b, i) => {
              const gy = this._terrainHeight(b.x, b.z);
              dummy.position.set(
                b.x + (Math.random() - 0.5) * b.w * 0.15,
                gy + b.h + b.h * 0.12,
                b.z + (Math.random() - 0.5) * b.d * 0.15);
              dummy.scale.set(b.w * 0.62, b.h * 0.24, b.d * 0.62);
              dummy.rotation.set(0, b.rot, 0);
              dummy.updateMatrix();
              tm.setMatrixAt(i, dummy.matrix);
            });
            tm.castShadow = true;
            this.group.add(tm);
          }

          // rooftop clutter: AC units
          const acGeo = new THREE.BoxGeometry(2.2, 1.1, 1.6);
          const acMat = new THREE.MeshStandardMaterial({ color: 0x565c66, roughness: 0.7, metalness: 0.4 });
          const acs = new THREE.InstancedMesh(acGeo, acMat, list.length);
          list.forEach((b, i) => {
            const gy = this._terrainHeight(b.x, b.z);
            dummy.position.set(
              b.x + (Math.random() - 0.5) * b.w * 0.4,
              gy + b.h + 0.55,
              b.z + (Math.random() - 0.5) * b.d * 0.4);
            dummy.scale.setScalar(0.8 + Math.random() * 0.8);
            dummy.rotation.set(0, Math.random() * 3.14, 0);
            dummy.updateMatrix();
            acs.setMatrixAt(i, dummy.matrix);
          });
          this.group.add(acs);

          // antenna masts with red beacons on the tallest few
          const spires = list.filter(b => b.h > 38).slice(0, 6);
          if (spires.length) {
            const aGeo = new THREE.CylinderGeometry(0.07, 0.12, 1, 5);
            const aMat = new THREE.MeshStandardMaterial({ color: 0x30343a, metalness: 0.7, roughness: 0.4 });
            const ants = new THREE.InstancedMesh(aGeo, aMat, spires.length);
            spires.forEach((b, i) => {
              const gy = this._terrainHeight(b.x, b.z);
              const ah = 4 + Math.random() * 6;
              dummy.position.set(b.x, gy + b.h + ah / 2, b.z);
              dummy.scale.set(1, ah, 1);
              dummy.rotation.set(0, 0, 0);
              dummy.updateMatrix();
              ants.setMatrixAt(i, dummy.matrix);
            });
            this.group.add(ants);
            if (glow >= 0.9) {
              const beaconTex = TEX.glow();
              for (const b of spires) {
                const spr = new THREE.Sprite(new THREE.SpriteMaterial({
                  map: beaconTex, color: 0xff3040,
                  transparent: true, blending: THREE.AdditiveBlending, depthWrite: false,
                }));
                spr.position.set(b.x, this._terrainHeight(b.x, b.z) + b.h + 5, b.z);
                spr.scale.setScalar(2.2);
                this.group.add(spr);
              }
            }
          }

          // glowing billboards mounted road-facing on some blocks
          if (env.billboards) {
            const texts = ["NEON", "TURBO", "DRIFT", "NITRO", "GP-7", "MOTORS"];
            const pairs = [
              ["#0a1020", "#00e5ff"], ["#180620", "#ff2fd6"],
              ["#04140c", "#39ff88"], ["#1c1202", "#ffd21e"],
            ];
            const picks = list.filter((_, i) => i % 4 === 0).slice(0, 8);
            picks.forEach((b, i) => {
              const pair = pairs[i % pairs.length];
              const tex = TEX.billboard(texts[i % texts.length], pair[0], pair[1]);
              const w = Math.min(b.w * 0.85, 11), h = w * 0.42;
              const board = new THREE.Mesh(
                new THREE.PlaneGeometry(w, h),
                new THREE.MeshBasicMaterial({ map: tex })
              );
              const gy = this._terrainHeight(b.x, b.z);
              // hang it on the road-facing wall at ~60% height
              const off = b.d / 2 + 0.15;
              board.position.set(b.x - b.nx * off, gy + b.h * 0.62, b.z - b.nz * off);
              board.rotation.y = Math.atan2(-b.nx, -b.nz);
              this.group.add(board);
            });
          }
        });
      }
    }

    /* ----- streetlights ----- */
    const lamps = env.lamps;
    if (lamps) {
      const poleGeo = new THREE.CylinderGeometry(0.09, 0.12, 5.4, 6);
      const poleMat = new THREE.MeshStandardMaterial({ color: 0x3a3f48, metalness: 0.7, roughness: 0.4 });
      const lampGeo = new THREE.SphereGeometry(0.28, 8, 8);
      const lampMat = new THREE.MeshBasicMaterial({ color: lamps.color || 0xffe9b0 });
      const every = lamps.every || 46;
      const poles = [];
      for (let i = 0; i < N; i += every) {
        const s = this.samples[i];
        const side = (i / every) % 2 === 0 ? 1 : -1;
        poles.push({
          x: s.pos.x + s.nx * side * (this.barrierDist + 2.2),
          z: s.pos.z + s.nz * side * (this.barrierDist + 2.2),
        });
      }
      const poleMesh = new THREE.InstancedMesh(poleGeo, poleMat, poles.length);
      const lampMesh = new THREE.InstancedMesh(lampGeo, lampMat, poles.length);
      const dummy = new THREE.Object3D();
      poles.forEach((p, i) => {
        const gy = this._terrainHeight(p.x, p.z);
        dummy.scale.setScalar(1);
        dummy.rotation.set(0, 0, 0);
        dummy.position.set(p.x, gy + 2.7, p.z);
        dummy.updateMatrix();
        poleMesh.setMatrixAt(i, dummy.matrix);
        dummy.position.set(p.x, gy + 5.5, p.z);
        dummy.updateMatrix();
        lampMesh.setMatrixAt(i, dummy.matrix);
      });
      this.group.add(poleMesh, lampMesh);

      // warm glow halos under each lamp
      const haloTex = TEX.glow();
      poles.forEach(p => {
        const spr = new THREE.Sprite(new THREE.SpriteMaterial({
          map: haloTex, color: lamps.color || 0xffe9b0,
          transparent: true, opacity: 0.55,
          blending: THREE.AdditiveBlending, depthWrite: false,
        }));
        const gy = this._terrainHeight(p.x, p.z);
        spr.position.set(p.x, gy + 5.5, p.z);
        spr.scale.setScalar(4.2);
        this.group.add(spr);
      });
    }

    /* ----- drifting clouds (soft billboard sprites) ----- */
    if (env.clouds) {
      const n = env.clouds.count || 8;
      const cloudTex = TEX.cloud();
      for (let i = 0; i < n; i++) {
        const spr = new THREE.Sprite(new THREE.SpriteMaterial({
          map: cloudTex, transparent: true,
          opacity: 0.38 + Math.random() * 0.22,
          depthWrite: false,
        }));
        const ang = Math.random() * Math.PI * 2;
        const rad = 180 + Math.random() * 420;
        spr.position.set(Math.cos(ang) * rad, (env.clouds.y || 130) + Math.random() * 50, Math.sin(ang) * rad);
        const w = 150 + Math.random() * 190;
        spr.scale.set(w, w * 0.42, 1);
        this.group.add(spr);
      }
    }
  }

  _scatterCacti(spots, dummy, col, flora) {
    if (!spots.length) return;
    const trunkMat = new THREE.MeshStandardMaterial({ color: flora.color || 0x5a7a3a, roughness: 0.85 });
    const bodyGeo = new THREE.CylinderGeometry(0.20, 0.26, 1, 7);   // unit height, scaled
    const armGeo = new THREE.CylinderGeometry(0.11, 0.13, 0.9, 6);
    const bodies = new THREE.InstancedMesh(bodyGeo, trunkMat, spots.length);
    const armsL = new THREE.InstancedMesh(armGeo, trunkMat, spots.length);
    const armsR = new THREE.InstancedMesh(armGeo, trunkMat, spots.length);
    spots.forEach((p, i) => {
      const h = (1.9 + Math.random() * 1.3) * p.s;
      const yBase = this._terrainHeight(p.x, p.z);
      dummy.position.set(p.x, yBase + h / 2, p.z);
      dummy.scale.set(p.s, h, p.s);
      dummy.rotation.set(0, Math.random() * 6.28, 0);
      dummy.updateMatrix();
      bodies.setMatrixAt(i, dummy.matrix);
      // two arms bending upward at mid height
      const ay = yBase + h * 0.45, ao = 0.42 * p.s;
      dummy.scale.set(p.s, 0.9 * p.s, p.s);
      dummy.position.set(p.x - ao, ay + 0.35 * p.s, p.z);
      dummy.rotation.set(0, 0, 0.5);
      dummy.updateMatrix(); armsL.setMatrixAt(i, dummy.matrix);
      dummy.position.set(p.x + ao, ay + 0.15 * p.s, p.z);
      dummy.rotation.set(0, 0, -0.5);
      dummy.updateMatrix(); armsR.setMatrixAt(i, dummy.matrix);
    });
    bodies.castShadow = true;
    this.group.add(bodies, armsL, armsR);
  }

  _scatterRocks(spots, dummy, col, flora) {
    if (!spots.length) return;
    const mat = new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 1 });
    const geo = new THREE.DodecahedronGeometry(1, 0);
    const rocks = new THREE.InstancedMesh(geo, mat, spots.length);
    const tint = new THREE.Color();
    const base = new THREE.Color(flora.trunk || 0xa87d52);
    spots.forEach((p, i) => {
      const sc = (0.9 + Math.random() * 1.7) * p.s;
      const yBase = this._terrainHeight(p.x, p.z);
      dummy.position.set(p.x, yBase + sc * 0.35, p.z);
      dummy.scale.set(sc, sc * (0.4 + Math.random() * 0.35), sc * (0.75 + Math.random() * 0.5));
      dummy.rotation.set(Math.random() * 0.4, Math.random() * 6.28, Math.random() * 0.4);
      dummy.updateMatrix();
      rocks.setMatrixAt(i, dummy.matrix);
      tint.copy(base).multiplyScalar(0.78 + Math.random() * 0.44);
      rocks.setColorAt(i, tint);
    });
    rocks.castShadow = true;
    this.group.add(rocks);
  }

  /* dry desert scrub — small twiggy clumps */
  _scatterScrub(spots, dummy) {
    if (!spots.length) return;
    const geo = new THREE.IcosahedronGeometry(0.42, 0);
    const mat = new THREE.MeshStandardMaterial({ color: 0x8a7648, roughness: 1 });
    const scrub = new THREE.InstancedMesh(geo, mat, spots.length);
    const tint = new THREE.Color();
    spots.forEach((p, i) => {
      const yBase = this._terrainHeight(p.x, p.z);
      const s = p.s * (0.7 + Math.random() * 0.8);
      dummy.position.set(p.x, yBase + 0.2 * s, p.z);
      dummy.scale.set(s, s * 0.6, s);
      dummy.rotation.set(Math.random() * 0.5, Math.random() * 6.28, Math.random() * 0.5);
      dummy.updateMatrix();
      scrub.setMatrixAt(i, dummy.matrix);
      tint.setHex(0x8a7648).multiplyScalar(0.8 + Math.random() * 0.4);
      scrub.setColorAt(i, tint);
    });
    this.group.add(scrub);
  }

  /* window grid texture used as the emissive map on city buildings */
  _makeWindowTexture() {
    const c = document.createElement("canvas");
    c.width = 64; c.height = 128;
    const g = c.getContext("2d");
    g.fillStyle = "#000000";
    g.fillRect(0, 0, 64, 128);
    const palette = ["#ffd9a0", "#fff3c8", "#9fd8ff", "#ff9fd0", "#b0ffd0"];
    for (let wy = 6; wy < 124; wy += 10) {
      for (let wx = 5; wx < 60; wx += 12) {
        if (Math.random() < 0.42) {
          g.fillStyle = palette[Math.random() * palette.length | 0];
          g.globalAlpha = 0.5 + Math.random() * 0.5;
          g.fillRect(wx, wy, 7, 5);
        }
      }
    }
    g.globalAlpha = 1;
    const tex = new THREE.CanvasTexture(c);
    return tex;
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

/* ---------- track library ----------
 * points are [x, z, elevation]; polar-style loops (radius per angle step)
 * are guaranteed non-self-intersecting. Heights are sums of sinusoids so
 * the loop closes smoothly with no cliff at the start/finish seam.      */
function _polarLoop(radii, heightFn, scale = 1) {
  const n = radii.length;
  const base = heightFn(0, n);   // normalize so the grid area is flat
  return radii.map((r, i) => {
    const a = (i / n) * Math.PI * 2;
    return [
      Math.cos(a) * r * scale,
      Math.sin(a) * r * scale,
      heightFn(i, n) - base,
    ];
  });
}

const TRACKS = {
  downtown: {
    key: "downtown",
    name: "DOWNTOWN CIRCUIT",
    desc: "City dusk · hairpins & chicanes",
    width: 14,
    meta: { length: "≈2.4 km", elev: "flat", style: "City" },
    env: {
      skyStops: [[0, "#0a1130"], [0.45, "#27407c"], [0.72, "#c85a3a"], [0.85, "#ff9d4d"], [1, "#ffc880"]],
      sunColors: ["rgba(255,230,180,1)", "rgba(255,170,90,0.55)", "rgba(255,150,60,0)"],
      sunDir: [900, 120, 700], sunScale: 700,
      sunColor: 0xffc07a, sunIntensity: 1.35, sunPos: [90, 130, 50],
      hemiSky: 0x8fa8d8, hemiGround: 0x1a2028, hemiInt: 0.75,
      fogColor: 0x2a3550, fogNear: 180, fogFar: 750, exposure: 1.15,
      groundTex: "concrete", terrainTint: 0xc9ced6, wallTint: 0x8f95a0,
      rockTint: 0x7d838d,
      flora: { type: "pine", density: 0.9, color: 0x2e6b34, trunk: 0x5a4632 },
      city: { glow: 0.4 }, billboards: true,
      lamps: { every: 46, color: 0xffe9b0 },
      clouds: null,
    },
  },
  ridgeline: {
    key: "ridgeline",
    name: "RIDGELINE RUN",
    desc: "Rolling hills · high-speed sweepers",
    width: 15,
    points: _polarLoop(
      [200, 175, 215, 165, 195, 170, 220, 180, 160, 200, 170, 210, 175, 185],
      (i, n) => 6 * Math.sin(4 * Math.PI * i / n) + 3 * Math.sin(2 * Math.PI * i / n),
      1.35
    ),
    meta: { length: "≈1.8 km", elev: "±9 m", style: "Hilly" },
    env: {
      skyStops: [[0, "#3f97e0"], [0.5, "#8fd0ff"], [0.78, "#d6efff"], [1, "#f2fbff"]],
      sunColors: ["rgba(255,255,245,1)", "rgba(255,240,190,0.5)", "rgba(255,220,150,0)"],
      sunDir: [-500, 650, 400], sunScale: 420,
      sunColor: 0xfff2d0, sunIntensity: 1.45, sunPos: [-250, 380, 200],
      hemiSky: 0xbfe0ff, hemiGround: 0x2e5230, hemiInt: 0.9,
      fogColor: 0xcfe6f5, fogNear: 240, fogFar: 880, exposure: 1.06,
      groundTex: "grass", terrainTint: 0xe6ecd8,
      rockTint: 0x8a8272, snowAbove: 15,
      hillAmp: 1.35,
      flora: { type: "pine", density: 2.4, color: 0x275e2d, trunk: 0x4a3826 },
      city: null,
      lamps: { every: 80, color: 0xe8f0ff },
      clouds: { count: 9, y: 130 },
    },
  },
  canyon: {
    key: "canyon",
    name: "CANYON SPRINT",
    desc: "Desert sunset · steep climbs · big drops",
    width: 13,
    points: _polarLoop(
      [150, 95, 140, 88, 155, 105, 85, 132, 95, 148, 110, 128],
      (i, n) => 6 * Math.sin(2 * Math.PI * i / n) + 2 * Math.sin(6 * Math.PI * i / n),
      1.15
    ),
    meta: { length: "≈1.0 km", elev: "±9 m", style: "Mountain" },
    env: {
      skyStops: [[0, "#3a1f52"], [0.45, "#7a3b63"], [0.7, "#d95f35"], [0.85, "#ff9a3d"], [1, "#ffc873"]],
      sunColors: ["rgba(255,240,200,1)", "rgba(255,150,60,0.6)", "rgba(255,120,40,0)"],
      sunDir: [-800, 150, 350], sunScale: 850,
      sunColor: 0xffa050, sunIntensity: 1.4, sunPos: [-350, 120, 180],
      hemiSky: 0xd88a5a, hemiGround: 0x5a3020, hemiInt: 0.75,
      fogColor: 0xd98e5f, fogNear: 150, fogFar: 640, exposure: 1.18,
      groundTex: "sand", terrainTint: 0xf4e3c2,
      rockTint: 0xa5713f, wallTint: 0xd8b088,
      hillAmp: 1.5, hillFreq: 0.8,
      flora: { type: "desert", density: 1.2, color: 0x5a7a3a, trunk: 0xa87d52 },
      city: null,
      lamps: { every: 80, color: 0xffb46a },
      clouds: { count: 3, y: 160 },
    },
  },
  glacier: {
    key: "glacier",
    name: "GLACIER RUN",
    desc: "Frozen alpine pass · wide sweepers",
    width: 15.5,
    points: _polarLoop(
      [185, 155, 178, 148, 172, 158, 182, 162],
      (i, n) => 4 * Math.sin(4 * Math.PI * i / n) + 2 * Math.sin(2 * Math.PI * i / n),
      1.28
    ),
    meta: { length: "≈1.6 km", elev: "±6 m", style: "Snow" },
    env: {
      skyStops: [[0, "#8fc7ff"], [0.5, "#c8e4ff"], [0.75, "#eef7ff"], [1, "#ffffff"]],
      sunColors: ["rgba(255,255,255,1)", "rgba(220,240,255,0.5)", "rgba(200,230,255,0)"],
      sunDir: [-700, 500, 300], sunScale: 500,
      sunColor: 0xfff4e0, sunIntensity: 1.5, sunPos: [-300, 400, 150],
      hemiSky: 0xcfe4ff, hemiGround: 0x8a95a5, hemiInt: 0.95,
      fogColor: 0xdfeef8, fogNear: 220, fogFar: 820, exposure: 1.02,
      groundTex: "snow", terrainTint: 0xf4f8fd,
      rockTint: 0x8d99a8,
      hillAmp: 1.1,
      flora: { type: "snowpine", density: 1.6, color: 0x2f4a3e, trunk: 0x4a3b2e },
      city: null,
      lamps: { every: 90, color: 0xd8e8ff },
      clouds: { count: 7, y: 120 },
    },
  },
  neon: {
    key: "neon",
    name: "NEON DISTRICT",
    desc: "Midnight sprint · tight city blocks",
    width: 12.5,
    points: _polarLoop(
      [135, 100, 130, 88, 125, 98, 132, 92, 120, 100, 128, 95],
      () => 0,
      1.05
    ),
    meta: { length: "≈1.2 km", elev: "flat", style: "Night" },
    env: {
      skyStops: [[0, "#020308"], [0.55, "#0a1226"], [0.8, "#16223f"], [1, "#232f52"]],
      stars: true,
      sunColors: ["rgba(220,230,255,1)", "rgba(150,170,230,0.4)", "rgba(120,150,220,0)"],
      sunDir: [600, 700, -200], sunScale: 260,
      sunColor: 0x93a9e8, sunIntensity: 1.05, sunPos: [250, 350, -80],
      hemiSky: 0x3d5290, hemiGround: 0x10141f, hemiInt: 0.85,
      fogColor: 0x101830, fogNear: 180, fogFar: 740, exposure: 1.42,
      groundTex: "concrete", terrainTint: 0xb4bcc8, wallTint: 0x7d838d,
      hillAmp: 0.25,
      flora: null,
      city: { glow: 1.35 }, billboards: true,
      lamps: { every: 22, color: 0xbfd8ff },
      roadEdgeGlow: [0x00e5ff, 0xff2fd6],
    },
  },
};
