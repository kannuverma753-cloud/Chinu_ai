import { AnimationClip, AnimationMixer, Box3, LoopOnce, LoadingManager, Matrix4, Quaternion, QuaternionKeyframeTrack, Vector3, VectorKeyframeTrack } from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { VRMLoaderPlugin, VRMUtils } from '@pixiv/three-vrm';

const base = new URL('realistic/assets/', document.baseURI);
const manager = new LoadingManager().setURLModifier(url =>
  url.endsWith('/Textures/colormap.png') ? new URL('car-colormap.png', base).href : url);
const loader = new GLTFLoader(manager).register(parser => new VRMLoaderPlugin(parser));
const assets = new Map();
const textures = new WeakMap();
let started = false;
let animationSource;
const vehicleFiles = { bike: 'motorcycle', jeep: 'suv-luxury', coupe: 'sedan-sports' };
const variants = { suv: 'jeep', sedan: 'coupe', 'hatchback-sports': 'coupe' };
const pendingModels = new Set();
function loadVehicle(key, type) {
  if (pendingModels.has(key)) return;
  pendingModels.add(key);
  queued(key, load((vehicleFiles[key] || key) + '.glb').then(gltf => vehicle(gltf.scene, type)));
}
const joints = {
  pelvis: 'hips', spine_01: 'spine', spine_02: 'chest', spine_03: 'upperChest',
  neck_01: 'neck', Head: 'head',
};
for (const [suffix, side] of [['l', 'left'], ['r', 'right']]) {
  for (const [source, target] of Object.entries({
    clavicle: 'Shoulder', upperarm: 'UpperArm', lowerarm: 'LowerArm', hand: 'Hand',
    thigh: 'UpperLeg', calf: 'LowerLeg', foot: 'Foot', ball: 'Toes',
  })) joints[source + '_' + suffix] = side + target;
}
const load = file => loader.loadAsync(new URL(file, base).href);
function queued(key, promise) {
  promise.then(value => assets.set(key, value)).catch(error => console.warn('Chinu asset', key, error));
}
function start() {
  if (started) return;
  started = true;
  animationSource = load('animations.glb').catch(error => {
    console.warn('Chinu animation library', error);
    return null;
  });
  for (const [who, file] of [['Cheeku', 'avatar-a.vrm'], ['Komal', 'avatar-b.vrm']]) {
    queued(who, Promise.all([load(file), animationSource]).then(([gltf, source]) => avatar(gltf, source)));
  }

}
function retarget(source, vrm, clip) {
  const tracks = [];
  const q = new Quaternion(), inverseRest = new Quaternion(), parentRest = new Quaternion();
  const sourceHips = source.scene.getObjectByName('pelvis');
  const targetHips = vrm.humanoid.getNormalizedBoneNode('hips');
  const ratio = Math.abs(targetHips.position.y / sourceHips.getWorldPosition(new Vector3()).y);
  const displacement = new Vector3();
  const restHips = sourceHips.getWorldPosition(new Vector3());
  for (const track of clip.tracks) {
    const [name, property] = track.name.split('.');
    const human = joints[name];
    const dst = human && vrm.humanoid.getNormalizedBoneNode(human);
    if (!dst) continue;
    const src = source.scene.getObjectByName(name);
    if (!src) continue;
    if (property === 'quaternion') {
      src.getWorldQuaternion(inverseRest).invert();
      src.parent.getWorldQuaternion(parentRest);
      const values = new Float32Array(track.values.length);
      for (let i = 0; i < values.length; i += 4) {
        q.fromArray(track.values, i).premultiply(parentRest).multiply(inverseRest);
        if (vrm.meta.metaVersion === '0') q.set(-q.x, q.y, -q.z, q.w);
        q.normalize().toArray(values, i);
      }
      tracks.push(new QuaternionKeyframeTrack(dst.name + '.quaternion', track.times, values));
    } else if (property === 'position' && human === 'hips' && Number.isFinite(ratio)) {
      const values = new Float32Array(track.values.length);
      for (let i = 0; i < values.length; i += 3) {
        values[i] = dst.position.x;
        displacement.fromArray(track.values,i).applyMatrix4(sourceHips.parent.matrixWorld).sub(restHips);
        values[i + 1] = dst.position.y + displacement.y * ratio;
        values[i + 2] = dst.position.z;
      }
      tracks.push(new VectorKeyframeTrack(dst.name + '.position', track.times, values));
    }
  }
  return new AnimationClip(clip.name, clip.duration, tracks);
}
function avatar(gltf, source) {
  const vrm = gltf.userData.vrm;
  if (!vrm) throw new Error('VRM humanoid metadata is missing');
  vrm.scene.updateMatrixWorld(true);
  if (source) source.scene.updateMatrixWorld(true);
  const names = ['Idle_Loop', 'Walk_Loop', 'Jog_Fwd_Loop', 'Sprint_Loop', 'Jump_Loop',
    'Crouch_Idle_Loop', 'Crouch_Fwd_Loop', 'Sitting_Enter', 'Sitting_Exit', 'Sitting_Idle_Loop',
    'Driving_Loop', 'Dance_Loop'];
  const mixer = new AnimationMixer(vrm.scene);
  const raw = name => vrm.humanoid.getRawBoneNode(name);
  const feet = ['leftFoot','leftToes','rightFoot','rightToes'].map(raw).filter(Boolean);
  const actions = new Map((source?.animations || []).filter(clip => names.includes(clip.name))
    .map(clip => [clip.name, mixer.clipAction(retarget(source, vrm, clip))]));
  VRMUtils.rotateVRM0(vrm);
  return { vrm, mixer, actions, parts: meshes(vrm.scene), feet, stamp: -1 };
}
function meshes(scene) {
  const parts = [];
  scene.traverse(mesh => {
    if (mesh.isMesh) parts.push({ mesh, contexts: new WeakMap() });
  });
  return parts;
}
function splitMotorcycleWheels(scene) {
  const groups = [];
  scene.traverse(mesh => {
    if (mesh.isMesh && /tyre_rubber|wheel_paint|brake_disc_steel/i.test(mesh.name)) groups.push(mesh);
  });
  for (const mesh of groups) {
    const geometry = mesh.geometry, position = geometry.attributes.position, index = geometry.index;
    if (!index) continue;
    const split = [[],[]];
    for (let i=0;i<index.count;i+=3) {
      const a=index.getX(i),b=index.getX(i+1),c=index.getX(i+2);
      split[position.getZ(a)+position.getZ(b)+position.getZ(c)>0?1:0].push(a,b,c);
    }
    const parent = mesh.parent;
    for (let i=0;i<2;i++) {
      if (!split[i].length) continue;
      const wheel=mesh.clone();
      wheel.geometry=geometry.clone();
      wheel.geometry.setIndex(split[i]);
      wheel.userData.wheelPivot=new Vector3(0,.30,i?.72:-.72);
      wheel.userData.frontWheel=Boolean(i);
      parent.add(wheel);
    }
    parent.remove(mesh);
  }
}
function vehicle(scene, kind) {
  if (kind === 'bike') splitMotorcycleWheels(scene);
  scene.updateMatrixWorld(true);
  const box = new Box3().setFromObject(scene), size = box.getSize(new Vector3());
  const center = box.getCenter(new Vector3());
  const lengths = { jeep: 4, coupe: 4.5, bike: 2.1 };
  const sideways = size.x > size.z;
  const scale = lengths[kind] / Math.max(size.x, size.z);
  const correction = new Matrix4().makeRotationY(sideways ? -Math.PI / 2 : 0)
    .multiply(new Matrix4().makeScale(scale, scale, scale))
    .multiply(new Matrix4().makeTranslation(-center.x, -box.min.y, -center.z));
  const parts = meshes(scene);
  for (const part of parts) {
    const { mesh } = part;
    if (mesh.userData.wheelPivot || /^wheel-(front|back)-(left|right)/.test(mesh.name)) {
      part.wheel = { pivot: mesh.userData.wheelPivot || new Vector3(),
        front: !!mesh.userData.frontWheel || mesh.name.startsWith('wheel-front') };
    }
  }
  return { scene, parts, correction };
}
function texture(gl, image) {
  let map = textures.get(gl);
  if (!map) textures.set(gl, map = new WeakMap());
  if (map.has(image)) return map.get(image);
  const tex = gl.createTexture();
  gl.bindTexture(gl.TEXTURE_2D, tex);
  gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, false);
  gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, image);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
  const powerOfTwo = n => n > 0 && (n & (n - 1)) === 0;
  if (powerOfTwo(image.width) && powerOfTwo(image.height)) {
    gl.generateMipmap(gl.TEXTURE_2D);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR_MIPMAP_LINEAR);
  } else gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
  map.set(image, tex);
  return tex;
}
function meshBuffer(gl, part) {
  const mesh = part.mesh, g = mesh.geometry;
  if (!g.attributes.normal) g.computeVertexNormals();
  const position = g.attributes.position, normal = g.attributes.normal;
  const uv = g.attributes.uv, color = g.attributes.color;
  let index = g.index?.array;
  if (index instanceof Uint32Array && !gl.getExtension('OES_element_index_uint')) {
    if (position.count > 65535) throw new Error('A mesh exceeds 16-bit WebGL index capacity');
    index = Uint16Array.from(index);
  }
  const b = gl.createBuffer(), elements = index && gl.createBuffer();
  const out = new Float32Array(position.count * 11);
  const mat = mesh.material;
  if (elements) {
    gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, elements);
    gl.bufferData(gl.ELEMENT_ARRAY_BUFFER, index, gl.STATIC_DRAW);
  }
  for (let i = 0, o = 0; i < position.count; i++, o += 11) {
    out[o + 6] = color ? color.getX(i) : 1;
    out[o + 7] = color ? color.getY(i) : 1;
    out[o + 8] = color ? color.getZ(i) : 1;
    out[o + 9] = uv?.getX(i) || 0;
    out[o + 10] = uv?.getY(i) || 0;
  }
  const image = mat.map?.image;
  const value = { b, elements, n: index?.length ?? position.count, out, position, normal,
    elementType: index instanceof Uint32Array ? gl.UNSIGNED_INT : index instanceof Uint8Array ? gl.UNSIGNED_BYTE : gl.UNSIGNED_SHORT,
    tex: image ? texture(gl, image) : null, tint: mat.color?.toArray() || [1, 1, 1],
    roughness: mat.roughness ?? .78, metallic: mat.metalness ?? 0,
    alphaCutoff: mat.alphaTest || (mat.transparent ? .3 : 0), gloss: .05 + .55 * (1 - (mat.roughness ?? .8)),
  };
  part.contexts.set(gl, value);
  return value;
}
const morphDelta = new Vector3();
const p = new Vector3(), n = new Vector3(), direction = new Vector3();
const bone = new Matrix4(), inverse = new Matrix4();
function upload(gl, mesh, gpu) {
  const { out, position, normal } = gpu;
  const skin = mesh.isSkinnedMesh;
  const skeleton = mesh.skeleton;
  const { skinIndex, skinWeight } = mesh.geometry.attributes;
  const morph = mesh.geometry.morphAttributes.position || [];
  const weights = mesh.morphTargetInfluences || [];
  const activeMorphs = morph.flatMap((attribute,i) => weights[i] > .001 ? [[attribute,weights[i]]] : []);
  let palette;
  if (skin) {
    skeleton.update();
    inverse.copy(mesh.bindMatrixInverse);
    palette = skeleton.bones.map((_, i) => new Matrix4().multiplyMatrices(inverse,
      bone.fromArray(skeleton.boneMatrices, i * 16)).multiply(mesh.bindMatrix).elements);
  }
  for (let i = 0, o = 0; i < position.count; i++, o += 11) {
    p.fromBufferAttribute(position, i);
    n.fromBufferAttribute(normal, i);
    for (const [attribute, strength] of activeMorphs) {
      morphDelta.fromBufferAttribute(attribute,i);
      if (!mesh.geometry.morphTargetsRelative) {
        morphDelta.x -= position.getX(i); morphDelta.y -= position.getY(i); morphDelta.z -= position.getZ(i);
      }
      p.addScaledVector(morphDelta,strength);
    }
    if (skin) {
      const x = p.x, y = p.y, z = p.z, nx = n.x, ny = n.y, nz = n.z;
      p.set(0, 0, 0); n.set(0, 0, 0);
      for (let j = 0; j < 4; j++) {
        const w = skinWeight.getComponent(i, j);
        if (!w) continue;
        const a = palette[skinIndex.getComponent(i,j)];
        p.x += w * (a[0]*x + a[4]*y + a[8]*z + a[12]);
        p.y += w * (a[1]*x + a[5]*y + a[9]*z + a[13]);
        p.z += w * (a[2]*x + a[6]*y + a[10]*z + a[14]);
        n.x += w * (a[0]*nx + a[4]*ny + a[8]*nz);
        n.y += w * (a[1]*nx + a[5]*ny + a[9]*nz);
        n.z += w * (a[2]*nx + a[6]*ny + a[10]*nz);
      }
      n.normalize();
    }
    p.toArray(out, o); n.toArray(out, o + 3);
  }
  gl.bindBuffer(gl.ARRAY_BUFFER, gpu.b);
  gl.bufferData(gl.ARRAY_BUFFER, out, skin ? gl.DYNAMIC_DRAW : gl.STATIC_DRAW);
}
const xAxis = new Vector3(1, 0, 0), zAxis = new Vector3(0, 0, 1);
const axis = new Vector3(), target = new Vector3(), joint = new Vector3();
const world = new Quaternion(), rotation = new Quaternion();
function aim(node, child, point, strength) {
  node.getWorldPosition(joint);
  child.getWorldPosition(direction).sub(joint).normalize();
  axis.copy(point).sub(joint).normalize();
  rotation.setFromUnitVectors(direction, axis);
  node.parent.getWorldQuaternion(world);
  rotation.premultiply(world.clone().invert()).multiply(world).multiply(node.quaternion);
  node.quaternion.slerp(rotation, strength);
  node.updateWorldMatrix(false, true);
}
function pose(model, who, c, state, stamp) {
  const { vrm, actions, mixer } = model;
  const kind = c.pose?.k, time = state.t, moving = c.spd > .15;
  const transition = c.vehicleEnter != null && time-c.vehicleEnter < .72;
  const clip = transition ? 'Sitting_Enter' : kind === 'vehicleExit' ? 'Sitting_Exit' : kind === 'dance' ? 'Dance_Loop' :
    kind === 'sit' ? 'Sitting_Idle_Loop' :
    ['carD', 'carP', 'bike', 'pillion', 'ride', 'pedal'].includes(kind) ? 'Driving_Loop' :
    !c.ground ? 'Jump_Loop' : c.crouch ? (moving ? 'Crouch_Fwd_Loop' : 'Crouch_Idle_Loop') :
    c.spd > 5 ? 'Sprint_Loop' : c.spd > 2.5 ? 'Jog_Fwd_Loop' : moving ? 'Walk_Loop' : 'Idle_Loop';
  const dt = model.stamp < 0 ? 0 : Math.max(0, Math.min(.1, (stamp - model.stamp) / 30));
  for (const [node, q] of model.proceduralRest || []) node.quaternion.copy(q);
  model.proceduralRest = [];
  const action = actions.get(clip);
  if (action && action !== model.action) {
    action.reset().setEffectiveWeight(1).fadeIn(.16).play();
    if (transition || kind === 'vehicleExit') action.setLoop(LoopOnce,1).clampWhenFinished = true;
    model.action?.fadeOut(.16);
    model.action = action;
  }
  mixer.update(dt);
  vrm.scene.updateMatrixWorld(true);
  const get = name => vrm.humanoid.getNormalizedBoneNode(name);
  const remember = node => model.proceduralRest.push([node, node.quaternion.clone()]);
  const hold = state.hand && !kind;
  const face = kind === 'hug' || kind === 'kiss';
  const partner = state.ch[who === 'Komal' ? 'Cheeku' : 'Komal'];
  const dx = partner.x - c.x, dz = partner.z - c.z;
  const sine = Math.sin(c.yaw), cosine = Math.cos(c.yaw);
  const localX = dx * cosine - dz * sine;
  const localZ = dx * sine + dz * cosine;
  const blend = kind ? Math.min(1, c.pose.t * 5, Math.max(0, (c.pose.dur - c.pose.t) * 5)) : 1;
  for (const side of ['left', 'right']) {
    const sign = side === 'left' ? 1 : -1;
    const arm = get(side + 'UpperArm'), elbow = get(side + 'LowerArm'), hand = get(side + 'Hand');
    if (!arm || !elbow || !hand) continue;
    const waving = kind === 'wave' && side === 'right';
    const reaching = hold && Math.sign(localX) === sign;
    if (!waving && !reaching && !face && kind !== 'heart') continue;
    remember(arm); remember(elbow);
    arm.getWorldPosition(target);
    target.x = reaching ? Math.max(-.48, Math.min(.48, localX * .5)) : sign * (waving ? .44 : .18);
    target.y = reaching ? Math.min(c.y,partner.y) - c.y + .93 - (model.floor||0)
      : target.y + (waving ? .28 + Math.sin(time * 14) * .05 : kind === 'heart' ? -.08 : -.16);
    target.z = waving ? .13 : reaching ? localZ*.5+.13 : .35;
    for (let pass = 0; pass < 3; pass++) {
      aim(arm, hand, target, blend * .65);
      aim(elbow, hand, target, blend * .75);
    }
  }
  if (face) {
    const bone = get('head');
    if (bone) {
      remember(bone);
      bone.quaternion.multiply(new Quaternion().setFromAxisAngle(xAxis, (kind === 'kiss' ? .22 : .12) * blend));
      bone.quaternion.multiply(new Quaternion().setFromAxisAngle(zAxis, (who === 'Komal' ? .12 : -.12) * blend));
    }
  }
  const blink = Math.max(0, 1 - Math.abs((time + (who === 'Komal' ? 1.8 : 0)) % 4.1 - 3.8) * 17);
  vrm.expressionManager?.setValue('blink', kind === 'kiss' ? Math.max(blink, blend * .8) : blink);
  vrm.expressionManager?.setValue('happy', face || hold ? .45 : .12);
  vrm.expressionManager?.setValue('ou', kind === 'kiss' ? blend*.12 : 0);
  vrm.update(dt);
  vrm.scene.updateMatrixWorld(true);
  const airborne = !c.ground, riding = transition || ['carD','carP','bike','pillion','ride','pedal','carrier'].includes(kind);
  if (airborne || riding || kind === 'sit' || kind === 'vehicleExit') model.floor = 0;
  else {
    const foot = Math.min(...model.feet.map(node => node.getWorldPosition(joint).y));
    const floor = Math.max(-.55,Math.min(.35,.04-foot));
    model.floor = Number.isFinite(floor) ? (model.floor??floor)+(floor-(model.floor??floor))*.65 : 0;
  }
  model.stamp = stamp;
}
function drawParts(gl, draw, model, basis, stamp, vehicle) {
  for (const part of model.parts) {
    const gpu = part.contexts.get(gl) || meshBuffer(gl, part);
    if (gpu.stamp === undefined || part.mesh.isSkinnedMesh && gpu.stamp !== stamp) {
      upload(gl, part.mesh, gpu);
      gpu.stamp = stamp;
    }
    const matrix = new Matrix4().fromArray(basis).multiply(part.mesh.matrixWorld);
    if (vehicle && part.wheel) {
      const { pivot, front } = part.wheel;
      matrix.multiply(new Matrix4().makeTranslation(pivot.x,pivot.y,pivot.z));
      if (front) matrix.multiply(new Matrix4().makeRotationY(vehicle.steer||0));
      matrix.multiply(new Matrix4().makeRotationX(vehicle.wh||0))
        .multiply(new Matrix4().makeTranslation(-pivot.x,-pivot.y,-pivot.z));
    }
    draw(gpu, matrix.elements, gpu.tint, 0, null, gpu.gloss);
  }
}
function drawAvatar(gl, draw, who, c, state, matrix) {
  start();
  const model = assets.get(who);
  if (!model) return;
  const stamp = Math.floor(state.t * 30);
  if (stamp !== model.stamp || state !== model.state) {
    if (model.state !== state) { model.stamp = -1; for (const part of model.parts) { const gpu = part.contexts.get(gl); if (gpu) gpu.stamp = undefined; } }
    pose(model, who, c, state, stamp);
    model.state = state;
  }
  const grounded = new Matrix4().fromArray(matrix);
  grounded.elements[13] += model.floor || 0;
  drawParts(gl, draw, model, grounded.elements, stamp);
}
function drawVehicle(gl, draw, v, basis) {
  const key = variants[v.variant] === v.type ? v.variant : v.type;
  loadVehicle(key,v.type);
  const model = assets.get(key);
  if (!model) return;
  drawParts(gl, draw, model, new Matrix4().fromArray(basis).multiply(model.correction).elements, 0, v);
}
window.ChinuRealistic = { start, drawAvatar, drawVehicle, vehicleFiles };
