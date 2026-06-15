/**
 * Browser entry point for the X-wing space-combat game: runs the arcade flight
 * model + TIE dogfight at a fixed sim rate, renders the 3D scene + targeting HUD,
 * plays procedural audio, and reads keyboard/gamepad input.
 */

import { Scene3D } from "./scene.ts";
import { HUD } from "./hud.ts";
import { AudioEngine } from "./audio.ts";
import { InputManager } from "./input.ts";
import { Net } from "./net.ts";

const glCanvas = document.getElementById("gl") as HTMLCanvasElement;
const hudCanvas = document.getElementById("hud") as HTMLCanvasElement;

const scene = new Scene3D(glCanvas);
const hud = new HUD(hudCanvas);
const audio = new AudioEngine();
const input = new InputManager();
input.attach();

input.onFirstGesture = () => audio.start();
input.onBomb = () => scene.launchBomb();
input.onTarget = () => scene.cycleTarget();
input.onSFoils = () => scene.toggleSFoils();
input.onView = () => scene.toggleView();
input.onFlightAssist = () => scene.toggleFlightAssist();
input.onGear = () => scene.toggleGear();
input.onVtol = () => scene.toggleVtol();
input.onAutoLock = () => scene.toggleAutoLock();

// Scene -> audio cues.
scene.onPlayerFire = () => audio.laser();
scene.onEnemyFire = () => audio.enemyLaser();
scene.onExplosion = () => audio.explosion();
scene.onTorpedo = () => audio.torpedo();
scene.onLock = () => audio.lockTone();
scene.onCockpitClick = () => audio.click();

// --- Online multiplayer ---
const net = new Net();
net.onState = (id, s) => scene.upsertRemote(id, s);
net.onFire = (_id, f) => scene.spawnNetBolt(f);
net.onLeave = (id) => scene.removeRemote(id);
scene.onFire = (o, d, v) => net.sendFire({ o, d, v });
// Same origin as the page (the Node server serves both the files and the socket).
net.connect(`${location.protocol === "https:" ? "wss" : "ws"}://${location.host}`);
let lastNetSend = 0;

// Mouse drag rotates the camera 360° (orbit in chase, free-look in cockpit).
// A press with no drag is treated as a click on the cockpit console buttons.
let dragging = false, moved = false, downX = 0, downY = 0, lastX = 0, lastY = 0;
glCanvas.addEventListener("pointerdown", (e) => {
  dragging = true; moved = false;
  downX = lastX = e.clientX; downY = lastY = e.clientY;
});
window.addEventListener("pointermove", (e) => {
  if (dragging) {
    const dx = e.clientX - lastX, dy = e.clientY - lastY;
    lastX = e.clientX; lastY = e.clientY;
    if (Math.abs(e.clientX - downX) + Math.abs(e.clientY - downY) > 6) moved = true;
    if (moved) scene.adjustLook(-dy * 0.005, -dx * 0.005);
  } else {
    // Hover highlight + pointer cursor over clickable cockpit buttons.
    const over = scene.updateHover(e.clientX, e.clientY);
    glCanvas.style.cursor = over ? "pointer" : "default";
  }
});
window.addEventListener("pointerup", (e) => {
  if (dragging && !moved) scene.handleClick(e.clientX, e.clientY);
  dragging = false;
});
let lastHitWarn = 0;
scene.onPlayerHit = () => {
  const now = performance.now();
  if (now - lastHitWarn > 250) { audio.warning(); lastHitWarn = now; }
};

const SIM_DT = 1 / 120;
let acc = 0;
let last = performance.now();
let lastLaser = 0;
let lastSearchBeep = 0;

function frame(now: number) {
  const wall = Math.min(0.1, (now - last) / 1000);
  last = now;

  const controls = input.sample(wall);

  acc += wall;
  while (acc >= SIM_DT) {
    scene.update(controls, SIM_DT);
    acc -= SIM_DT;
  }

  // Hold-to-fire lasers (scene rate-limits internally; audio cue per shot).
  if (input.gunHeld && now - lastLaser > 95) {
    scene.firePrimary();
    lastLaser = now;
  }

  // Broadcast our ship state ~20 Hz for other players.
  if (net.connected && now - lastNetSend > 50) {
    net.sendState(scene.getNetState());
    lastNetSend = now;
  }

  scene.render();
  const h = scene.getHud();
  hud.draw(h);
  audio.update(h.throttle * 100, h.throttle, 0);

  // Soft search blip while a lock is building.
  if (h.lock?.state === "searching" && h.lock.progress > 0 && now - lastSearchBeep > 300) {
    audio.lockSearch();
    lastSearchBeep = now;
  }

  requestAnimationFrame(frame);
}
requestAnimationFrame(frame);

// Debug handles.
(window as any).__scene = scene;
(window as any).__hud = () => scene.getHud();
