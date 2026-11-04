import * as THREE from 'three';
import { Chapter } from '../world/chapter.js';
import { buildOrigin } from './origin.js';
import { buildMemory } from './memory.js';
import { buildRefraction } from './refraction.js';
import { buildWork } from './work.js';
import { buildThreshold } from './threshold.js';
import { buildNetwork } from './network.js';

// Chapters sit around a huge circle, each lower than the last, facing the next.
const HUB = new THREE.Vector3(0, 0, -160);
const RADIUS = 160;
const onCircle = (deg, y) => {
  const a = (deg * Math.PI) / 180;
  return [HUB.x + RADIUS * Math.cos(a), y, HUB.z + RADIUS * Math.sin(a)];
};
const yawFrom = (a, b) => Math.atan2(-(b[0] - a[0]), -(b[2] - a[2]));

function layout() {
  const origin = onCircle(90, 0);
  const memory = onCircle(142, -65);
  const refraction = onCircle(194, -130);
  const work = onCircle(246, -195);
  const threshold = onCircle(304, -260);
  return {
    origin, memory, refraction, work, threshold,
    originYaw: yawFrom(origin, memory),
    memoryYaw: yawFrom(origin, memory),
    refractionYaw: yawFrom(memory, refraction),
    workYaw: yawFrom(refraction, work),
    thresholdYaw: yawFrom(work, threshold),
  };
}

export function buildChapters(world) {
  world.layout = layout();
  world.materials = {};
  const L = world.layout;
  const chapters = [buildOrigin(world), buildMemory(world), buildRefraction(world), buildWork(world)];
  const threshold = buildThreshold(world);
  chapters.push(threshold);
  // the network hall hangs far above the dunes; you arrive by falling through the door
  L.networkDoor = [0, 64, 50];
  L.network = threshold.w(0, threshold.doorCenter.y - L.networkDoor[1], threshold.doorCenter.z - L.networkDoor[2]).toArray();
  L.networkYaw = L.thresholdYaw;
  chapters.push(buildNetwork(world));
  const finale = new Chapter({ id: 'finale', index: 6, origin: [0, -200, -160] });
  finale.addLight([0, 200, 160], '#ff2410', 400, 120);
  finale.setGlow([0, 200, 160], '#ff2412', 0.6);
  chapters.push(finale);
  return chapters;
}
