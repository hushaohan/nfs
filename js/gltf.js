/* =====================================================================
 * gltf.js — minimal glTF 2.0 binary (GLB) parser for core-profile
 * car models: POSITION/NORMAL/indices primitives, flat node
 * transforms, PBR metallic-roughness materials, and EMBEDDED
 * textures (decoded async, applied to materials when ready).
 * No Draco/skins/KHR-extension materials.                            */
"use strict";

const GLTF = (() => {

  function parseGLB(arrayBuffer) {
    const view = new DataView(arrayBuffer);
    if (view.getUint32(0, true) !== 0x46546C67) throw new Error("not a GLB file");
    let off = 12, json = null, bin = null;
    while (off + 8 <= view.byteLength) {
      const len = view.getUint32(off, true);
      const type = view.getUint32(off + 4, true);
      const start = off + 8;
      if (type === 0x4E4F534A) {
        json = JSON.parse(new TextDecoder().decode(new Uint8Array(arrayBuffer, start, len)));
      } else if (type === 0x004E4942) {
        bin = new Uint8Array(arrayBuffer, start, len);
      }
      off = start + len;
    }
    if (!json) throw new Error("GLB missing JSON chunk");
    return { json, bin };
  }

  function readAccessor(json, bin, index) {
    const a = json.accessors[index];
    const comps = { SCALAR: 1, VEC2: 2, VEC3: 3, VEC4: 4, MAT4: 16 }[a.type];
    const compBytes = { 5120: 1, 5121: 1, 5122: 2, 5123: 2, 5125: 4, 5126: 4 }[a.componentType];
    const bv = json.bufferViews[a.bufferView || 0];
    const start = bin.byteOffset + (bv.byteOffset || 0) + (a.byteOffset || 0);
    const bytes = bin.slice(start, start + a.count * comps * compBytes); // aligned copy
    let Arr = Float32Array;
    if (a.componentType === 5123) Arr = Uint16Array;
    else if (a.componentType === 5125) Arr = Uint32Array;
    else if (a.componentType === 5121) Arr = Uint8Array;
    else if (a.componentType === 5122) Arr = Int16Array;
    return new Arr(bytes.buffer);
  }

  function primitiveGeometry(json, bin, prim) {
    const g = new THREE.BufferGeometry();
    g.setAttribute("position",
      new THREE.BufferAttribute(readAccessor(json, bin, prim.attributes.POSITION), 3));
    if (prim.attributes.NORMAL !== undefined) {
      g.setAttribute("normal",
        new THREE.BufferAttribute(readAccessor(json, bin, prim.attributes.NORMAL), 3));
    }
    if (prim.indices !== undefined) {
      g.setIndex(new THREE.BufferAttribute(readAccessor(json, bin, prim.indices), 1));
    }
    if (prim.attributes.NORMAL === undefined) g.computeVertexNormals();
    return g;
  }

  function buildMaterial(m) {
    const pbr = m.pbrMetallicRoughness || {};
    const bcf = pbr.baseColorFactor || [1, 1, 1, 1];
    const mat = new THREE.MeshStandardMaterial({
      color: new THREE.Color(bcf[0], bcf[1], bcf[2]),
      metalness: pbr.metallicFactor !== undefined ? pbr.metallicFactor : 1,
      roughness: pbr.roughnessFactor !== undefined ? pbr.roughnessFactor : 1,
    });
    if (bcf[3] !== undefined && bcf[3] < 0.98) { mat.transparent = true; mat.opacity = bcf[3]; }
    if (m.alphaMode === "BLEND") mat.transparent = true;
    if (m.alphaMode === "MASK") mat.alphaTest = 0.5;
    if (m.emissiveFactor) mat.emissive = new THREE.Color(...m.emissiveFactor);
    mat.side = m.doubleSided ? THREE.DoubleSide : THREE.FrontSide;
    mat.name = m.name || "";
    mat.__baseColorTexIndex =
      pbr.baseColorTexture ? pbr.baseColorTexture.index : null;
    return mat;
  }

  function nodeMatrix(nd) {
    if (nd.matrix) return new THREE.Matrix4().fromArray(nd.matrix);
    const t = nd.translation || [0, 0, 0];
    const r = nd.rotation || [0, 0, 0, 1];
    const s = nd.scale || [1, 1, 1];
    return new THREE.Matrix4().compose(
      new THREE.Vector3(t[0], t[1], t[2]),
      new THREE.Quaternion(r[0], r[1], r[2], r[3]),
      new THREE.Vector3(s[0], s[1], s[2])
    );
  }

  /* sync pass: geometries + color materials (textures pending) */
  function buildParts(json, bin) {
    const out = [];
    const walk = (nodeIdx, parentMtx) => {
      const nd = json.nodes[nodeIdx];
      const mtx = parentMtx.clone().multiply(nodeMatrix(nd));
      if (nd.mesh !== undefined) {
        for (const prim of json.meshes[nd.mesh].primitives) {
          const geo = primitiveGeometry(json, bin, prim);
          geo.applyMatrix4(mtx);
          const mi = prim.material || 0;
          out.push({
            name: nd.name || "",
            geometry: geo,
            material: buildMaterial(json.materials[mi] || {}),
            materialName: (json.materials[mi] || {}).name || "",
          });
        }
      }
      for (const c of nd.children || []) walk(c, mtx);
    };
    for (const n of json.scenes[json.scene || 0].nodes) walk(n, new THREE.Matrix4());
    return out;
  }

  /* decode every embedded image and bind baseColor textures onto the
   * materials produced by buildParts (mutates them in place).         */
  function applyTextures(json, bin, parts) {
    const images = json.images || [];
    if (!images.length) return Promise.resolve();
    const texByImg = new Array(images.length).fill(null);
    const jobs = images.map((img, i) => new Promise(resolve => {
      try {
        const bv = json.bufferViews[img.bufferView];
        const start = bin.byteOffset + (bv.byteOffset || 0);
        const blob = new Blob([bin.slice(start, start + bv.byteLength)],
          { type: img.mimeType || "image/png" });
        const url = URL.createObjectURL(blob);
        const im = new Image();
        im.onload = () => {
          URL.revokeObjectURL(url);
          const tex = new THREE.Texture(im);
          tex.flipY = false;                       // glTF UV convention
          tex.encoding = THREE.sRGBEncoding;
          tex.needsUpdate = true;
          texByImg[i] = tex;
          resolve();
        };
        im.onerror = resolve;
        im.src = url;
      } catch (_) { resolve(); }
    }));
    return Promise.all(jobs).then(() => {
      const mats = new Set(parts.map(p => p.material));
      for (const mat of mats) {
        const idx = mat.__baseColorTexIndex;
        if (idx !== null && idx !== undefined && texByImg[idx]) {
          mat.map = texByImg[idx];
          mat.color.set(0xffffff);                 // texture replaces flat tint
          mat.needsUpdate = true;
        }
      }
    });
  }

  /* convenience: parse + parts + textures in one await */
  function parseAsync(arrayBuffer) {
    const { json, bin } = parseGLB(arrayBuffer);
    const parts = buildParts(json, bin);
    return applyTextures(json, bin, parts).then(() => parts);
  }

  return { parseGLB, readAccessor, buildParts, applyTextures, parseAsync };
})();
