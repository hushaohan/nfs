/* =====================================================================
 * gltf.js — minimal glTF 2.0 binary (GLB) parser for core-profile
 * models: meshes with POSITION/NORMAL/indices, flat node transforms,
 * PBR metallic-roughness materials. No textures/Draco/skins — exactly
 * what our car models use. Returns ready-to-use THREE geometry.       */
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
      if (type === 0x4E4F534A) {                    // "JSON"
        json = JSON.parse(new TextDecoder().decode(new Uint8Array(arrayBuffer, start, len)));
      } else if (type === 0x004E4942) {             // "BIN\0"
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
    const total = a.count * comps * compBytes;
    // slice: guarantees alignment for the typed-array view
    const bytes = bin.slice(start, start + total);
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

  function buildMaterial(json, mIndex) {
    const m = json.materials[mIndex] || {};
    const pbr = m.pbrMetallicRoughness || {};
    const bcf = pbr.baseColorFactor || [1, 1, 1, 1];
    const mat = new THREE.MeshStandardMaterial({
      color: new THREE.Color(bcf[0], bcf[1], bcf[2]),
      metalness: pbr.metallicFactor !== undefined ? pbr.metallicFactor : 1,
      roughness: pbr.roughnessFactor !== undefined ? pbr.roughnessFactor : 1,
    });
    if (bcf[3] !== undefined && bcf[3] < 0.98) {
      mat.transparent = true;
      mat.opacity = bcf[3];
    }
    if (m.alphaMode === "BLEND") mat.transparent = true;
    if (m.alphaMode === "MASK") mat.alphaTest = 0.5;
    if (m.emissiveFactor) {
      mat.emissive = new THREE.Color(m.emissiveFactor[0], m.emissiveFactor[1], m.emissiveFactor[2]);
    }
    mat.side = m.doubleSided ? THREE.DoubleSide : THREE.FrontSide;
    mat.name = m.name || ("mat" + mIndex);
    return mat;
  }

  /* node local matrix from matrix or TRS */
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

  /* parse GLB -> array of { name, geometry, material, materialName }
   * with every node transform baked into the geometry                */
  function parse(arrayBuffer) {
    const { json, bin } = parseGLB(arrayBuffer);
    const out = [];
    const walk = (nodeIdx, parentMtx) => {
      const nd = json.nodes[nodeIdx];
      const mtx = parentMtx.clone().multiply(nodeMatrix(nd));
      if (nd.mesh !== undefined) {
        const mesh = json.meshes[nd.mesh];
        for (const prim of mesh.primitives) {
          const geo = primitiveGeometry(json, bin, prim);
          geo.applyMatrix4(mtx);
          out.push({
            name: nd.name || mesh.name || "",
            geometry: geo,
            material: buildMaterial(json, prim.material || 0),
            materialName: (json.materials[prim.material || 0] || {}).name || "",
          });
        }
      }
      for (const c of nd.children || []) walk(c, mtx);
    };
    const scene = json.scenes[json.scene || 0];
    for (const n of scene.nodes) walk(n, new THREE.Matrix4());
    return out;
  }

  return { parse };
})();
