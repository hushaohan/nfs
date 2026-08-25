/* one-off v3b: replace v2 generic rigger */
const fs = require("fs");
let src = fs.readFileSync("js/effects.js", "utf8");
const start = src.indexOf("/* generic rigger v2:");
const anchor = "function _box(g, w, h, d, mat, x, y, z, rx) {";
const end = src.indexOf(anchor);
if (start < 0 || end < start) throw new Error("markers missing");

const L = [
  "/* generic rigger v3:",
  " *  • oversized merged meshes split per-triangle to nearest hub",
  " *  • radial partition: triangles within the tire radius SPIN; lumpier",
  " *    outer bits become steer-only statics (never rotated by game)",
  " *  • output ordered [FL,FR,RL,RR]; fronts only receive steering     */",
  "function rigWheelsGeneric(group, hubs, spec, reg) {",
  "  const raw = [];",
  "  group.traverse(o => {",
  "    if (!o.isMesh) return;",
  "    const kind = reg.match(o);",
  '    if (kind === "spin") raw.push({ mesh: o, kind });',
  "  });",
  "",
  "  /* phase 1: classify raw meshes into corners */",
  "  const cornerMeshes = { FL: [], FR: [], RL: [], RR: [] };",
  "  for (const item of raw) {",
  "    item.mesh.geometry.computeBoundingBox();",
  "    const c = new THREE.Vector3(); item.mesh.geometry.boundingBox.getCenter(c);",
  "    const ck = cornerOfName(item.mesh.name) || nearestHub(hubs, c.x, c.z);",
  "    cornerMeshes[ck].push(item.mesh);",
  "    group.remove(item.mesh);",
  "  }",
  "",
  "  /* phase 2: mount each corner into a single shared wheel group */",
  "  const wheels = [];",
  "  for (const ck of CORNER_KEYS) {",
  "    const list = cornerMeshes[ck];",
  "    if (!list.length) continue;",
  "    const wg = new THREE.Group();",
  '    wg.name = "cwm_wheel_" + ck;',
  "    wg.position.set(hubs[ck][0], hubs[ck][1], hubs[ck][2]);",
  "    const spin = new THREE.Group();",
  "    const shell = new THREE.Group();      // children[1]: never spun",
  "    wg.add(spin);",
  "    wg.add(shell);",
  "    for (const mesh of list) {",
  "      mesh.geometry.translate(-slot.wg.position.x, -slot.wg.position.y, -slot.wg.position.z);",
  "    }",
  "  }",
  ""
];
fs.writeFileSync("js/effects.js", src.slice(0, start) + L.join("\n") + "\n" + src.slice(end));
console.log("installed");
