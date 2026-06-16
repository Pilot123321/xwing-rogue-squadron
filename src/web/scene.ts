/**
 * The game world + renderer. Owns the starfield/space backdrop, the player's
 * X-wing, the TIE squadron, blaster bolts/torpedoes, effects, and the camera
 * (chase + cockpit). update() advances everything and produces HudData; the HUD
 * overlay draws it. Star Wars space-combat arcade rules: shields + hull, target
 * lock with lead indicator, score, and escalating TIE waves.
 *
 * World: Three.js right-handed, +Y up, units are arbitrary "meters". Forward is
 * the ship's local -Z.
 */

import * as THREE from "three";
import { EffectComposer } from "three/addons/postprocessing/EffectComposer.js";
import { RenderPass } from "three/addons/postprocessing/RenderPass.js";
import { UnrealBloomPass } from "three/addons/postprocessing/UnrealBloomPass.js";
import { RoomEnvironment } from "three/addons/environments/RoomEnvironment.js";
import { Effects } from "./effects.ts";
import { Blasters, type Combatant } from "./lasers.ts";
import { EnemyManager } from "./enemies.ts";
import { PlayerShip, MAX_SPEED, type Controls } from "./ship.ts";
import { buildSpace } from "./space.ts";
import { buildCockpit, type Cockpit } from "./cockpit.ts";
import { drawRadar, type Blip } from "./radar.ts";
import { buildXWing, type XWing } from "./xwing.ts";
import type { ShipSnapshot, FireEvent } from "./net.ts";
import { buildSurface, PLANET_R, PLANET_CY, PLANET_CENTER, ATMO_THICKNESS, DS_SPHERE_R, DS_SPHERE_CENTER, DS_TRENCH_W, DS_TRENCH_DEPTH } from "./surface.ts";
import { GroundTargets } from "./ground.ts";

export type ViewMode = "chase" | "cockpit";

export interface HudData {
  speed: number;
  throttle: number;
  maxSpeed: number;
  hull: number; // 0..100
  shields: number; // 0..100
  score: number;
  wave: number;
  lives: number;
  enemiesLeft: number;
  sfoils: boolean;
  torps: number;
  laserHeat: number; // 0..1
  boost: number; // 0..1 sublight accelerator engaged
  view: ViewMode;
  flightAssist: boolean;
  blips: Blip[]; // radar contacts (player-local, normalized)
  radarRange: number;
  // Realistic gunnery markers (screen px). prograde = velocity vector;
  // gunReticle = where bolts actually go (boresight + inherited velocity).
  prograde?: { x: number; y: number; behind: boolean };
  gunReticle?: { x: number; y: number; behind: boolean };
  // Hornet A/A gun cues
  closure?: number; // target closing rate (m/s, + = closing) — null if no lock
  shoot?: boolean; // firing solution satisfied (Hornet SHOOT cue)
  gunRange?: number; // gun max effective range (m) for the reticle range arc
  heading?: number; // ship heading 0..360 for the HUD heading tape
  lock?: { state: "searching" | "locked"; progress: number };
  // Aim-assist gate circle around a locked target (screen px); active = reticle inside.
  assistCircle?: { x: number; y: number; r: number; active: boolean };
  agl?: number | null; // height above the surface, or null in open space
  landed?: boolean;
  a2g?: { x: number; y: number; behind: boolean; dist: number } | null; // ground designation
  gear?: boolean;
  vtol?: boolean;
  // Atmospheric flight cues (only meaningful inside the planet's air).
  inAtmo?: boolean;
  aoa?: number;
  gLoad?: number;
  stalled?: boolean;
  // Right-side kill feed: newest last; alpha fades as it expires.
  feed?: { text: string; color: string; alpha: number }[];
  // Target reticle (screen px) + lead pip, present when a target is locked & on-screen.
  target?: { x: number; y: number; dist: number; lead?: { x: number; y: number }; behind: boolean };
  message?: string;
}

const FORWARD = new THREE.Vector3(0, 0, -1);
const BOLT_SPEED = 2600;
const GUN_RMAX = 3000; // gun max effective range (Hornet A/A gun reticle range arc)

// Real-world phenomena near a celestial body: gravity well + atmospheric drag.
// In open space there is neither (frictionless vacuum, pure Newtonian).
const G_SURF = 26; // m/s^2 surface gravity (at the planet surface)
const PLANET_CENTER3 = new THREE.Vector3(PLANET_CENTER.x, PLANET_CY, PLANET_CENTER.y);

export class Scene3D {
  readonly scene = new THREE.Scene();
  readonly camera: THREE.PerspectiveCamera;
  readonly renderer: THREE.WebGLRenderer;
  view: ViewMode = "chase";

  // event hooks (wired to audio by the host)
  onPlayerFire: (() => void) | null = null;
  onEnemyFire: (() => void) | null = null;
  onExplosion: (() => void) | null = null;
  onPlayerHit: (() => void) | null = null;
  onTorpedo: (() => void) | null = null;
  onLock: (() => void) | null = null;
  onCockpitClick: (() => void) | null = null;
  /** Broadcast our laser fire to other players (online). */
  onFire: ((o: [number, number, number], d: [number, number, number], v: [number, number, number]) => void) | null = null;

  private effects: Effects;
  private blasters: Blasters;
  private enemies: EnemyManager;
  private player: PlayerShip;
  private space: ReturnType<typeof buildSpace>;

  // player combat state
  private hull = 100;
  private shields = 100;
  private lives = 3;
  private dead = false;
  private respawnAt = 0;
  private timeSinceHit = 0;

  // game progression
  private score = 0;
  private wave = 0;
  private nextWaveAt = 0;
  private message = "";
  private messageUntil = 0;

  // weapons
  private laserHeat = 0;
  private overheated = false;
  private lastFire = 0;
  private cannonIdx = 0;
  private torps = 8;

  // targeting + radar lock
  private lockedId: number | null = null;
  private lockProgress = 0; // 0..1 building toward a hard lock
  private hardLock = false;
  private autoLock = true; // auto-acquire nearest TIE; toggle off for manual targeting
  private aimAssistActive = false; // true when the boresight reticle is inside the lock circle
  private prevHardLock = false;
  private raycaster = new THREE.Raycaster();

  // surface battlefields (planet / Death Star)
  private surfaceHeightAt!: (x: number, z: number) => number;
  private pads: THREE.Vector3[] = [];
  private obstacles: THREE.Box3[] = [];
  // Solid celestial bodies you crash into if you penetrate their surface.
  private crashSpheres: { c: THREE.Vector3; r: number }[] = [];
  private prevPos = new THREE.Vector3();
  private _dsRel = new THREE.Vector3();
  private groundTargets!: GroundTargets;
  // Player collision: half-extents of the X-wing hull (wingspan x, thin y/z).
  private readonly playerHalf = new THREE.Vector3(7, 3, 11);
  // Crash camera shake.
  private shakeUntil = 0;
  private shakeMag = 0;
  // Right-side kill feed (DCS-style stacked entries).
  private feed: { text: string; color: string; until: number }[] = [];
  private lastDamageFeed = 0;
  private landed = false;
  private agl: number | null = null;

  // battle damage / destruction
  private gunHits = 0; // gun hits that have reached the hull
  private damageFire: THREE.Group | null = null;
  private smokeTimer = 0;

  // sublight accelerator visual ramp (0..1)
  private boostVis = 0;
  private readonly baseFov = 65;
  private lastThrottle = 0;
  // Drag-to-look camera offsets (radians). Yaw is unbounded (full 360°).
  private lookYaw = 0;
  private lookPitch = 0;

  private clock = new THREE.Clock();
  private tmp = new THREE.Vector3();
  private tmp2 = new THREE.Vector3();
  private _q = new THREE.Quaternion();
  private hud: HudData;

  // cockpit interior + radar
  private cockpit!: Cockpit;
  private scopeCtx!: CanvasRenderingContext2D;
  private blips: Blip[] = [];
  private readonly RADAR_RANGE = 6500;

  // player combatant wrapper so enemy bolts can hit us
  private playerCombatant: Combatant;

  // post-processing
  private composer!: EffectComposer;

  // air-to-ground targeting pod (TV feed -> cockpit MFD) + laser designation
  private podCam!: THREE.PerspectiveCamera;
  private tvTarget!: THREE.WebGLRenderTarget;
  private groundTarget: THREE.Vector3 | null = null;

  // online multiplayer: other players' ships (interpolated from snapshots)
  private remotes = new Map<number, {
    x: XWing; group: THREE.Group; tp: THREE.Vector3; tq: THREE.Quaternion; sfoils: number; boost: number;
  }>();

  constructor(canvas: HTMLCanvasElement) {
    this.renderer = new THREE.WebGLRenderer({ canvas, antialias: true });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    // Filmic HDR pipeline so the bloom + emissive energy reads cinematically.
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 1.1;

    this.scene.background = new THREE.Color(0x01030a);
    this.camera = new THREE.PerspectiveCamera(65, 1, 0.5, 250000);

    // Zoomed targeting-pod camera; renders to a texture shown on the cockpit MFD.
    this.podCam = new THREE.PerspectiveCamera(15, 1, 1, 40000);
    this.tvTarget = new THREE.WebGLRenderTarget(256, 256);

    // PBR environment: gives the X-wing's metal panels real reflections.
    const pmrem = new THREE.PMREMGenerator(this.renderer);
    this.scene.environment = pmrem.fromScene(new RoomEnvironment(), 0.04).texture;

    // Lighting: a key "sun" + soft fill so models read in the dark. The visible
    // sun (built in space.ts) sits far away along this same direction so the
    // highlights/shadows on the ships line up with where the sun actually is.
    const sunDir = new THREE.Vector3(0.5, 0.8, 0.3).normalize();
    const sun = new THREE.DirectionalLight(0xfff4e0, 2.7);
    sun.position.copy(sunDir);
    this.scene.add(sun);
    this.scene.add(new THREE.HemisphereLight(0x404a66, 0x080810, 0.7));
    this.scene.add(new THREE.AmbientLight(0x223044, 0.6));

    this.space = buildSpace();
    this.scene.add(this.space.group);

    // Landable battlefields (planet surface + Rebel base, Death Star trench).
    const surf = buildSurface();
    this.scene.add(surf.group);
    this.surfaceHeightAt = surf.heightAt;
    this.pads = surf.pads;
    this.obstacles = surf.obstacles;
    // Planet is a solid body (crash if you fly into its surface). The Death Star
    // is NOT a crash sphere — the trench run is recessed below its surface.
    this.crashSpheres = [
      { c: new THREE.Vector3(PLANET_CENTER.x, PLANET_CY, PLANET_CENTER.y), r: PLANET_R },
    ];

    this.effects = new Effects(this.scene);
    this.blasters = new Blasters(this.scene, this.effects);
    this.enemies = new EnemyManager(this.scene, this.effects, () => {
      this.score += 100;
      this.onExplosion?.();
    });
    // Kill feed: TIE destroyed (red) / damaged (white), DCS-style.
    this.blasters.onPlayerHit = (killed) => {
      if (killed) this.pushFeed("TIE FIGHTER DESTROYED", "#ff4533");
      else {
        const now = this.clock.getElapsedTime();
        if (now - this.lastDamageFeed > 0.5) { this.lastDamageFeed = now; this.pushFeed("TIE FIGHTER DAMAGED", "#e8eef2"); }
      }
    };

    // Death Star air-to-ground targets (turrets + the thermal exhaust port).
    this.groundTargets = new GroundTargets(this.scene, this.effects, (pts) => {
      this.score += pts;
      this.onExplosion?.();
      this.pushFeed(pts >= 1000 ? "EXHAUST PORT DESTROYED" : "TURBOLASER DESTROYED", "#ff4533");
    });
    this.groundTargets.onPortDestroyed = () => this.flash("EXHAUST PORT DESTROYED — GREAT SHOT, KID!", 5);

    this.player = new PlayerShip();
    this.scene.add(this.player.group);

    // First-person cockpit interior, parented to the ship so it tracks motion.
    this.cockpit = buildCockpit();
    this.scopeCtx = this.cockpit.scopeCanvas.getContext("2d")!;
    this.player.group.add(this.cockpit.group);
    // Feed the targeting-pod TV onto the left cockpit MFD.
    (this.cockpit.tvScreen.material as THREE.MeshBasicMaterial).map = this.tvTarget.texture;
    (this.cockpit.tvScreen.material as THREE.MeshBasicMaterial).color.set(0xffffff);

    this.playerCombatant = {
      id: 1,
      faction: "player",
      position: this.player.group.position,
      radius: 7,
      get alive() { return true; },
      hit: (dmg: number, _at: THREE.Vector3, kind?: "gun" | "missile") => this.damagePlayer(dmg, kind ?? "gun"),
    } as Combatant;

    this.hud = this.buildHud();
    this.startWave();

    // Bloom pipeline: blasters, engines and explosions glow.
    this.composer = new EffectComposer(this.renderer);
    this.composer.addPass(new RenderPass(this.scene, this.camera));
    const bloom = new UnrealBloomPass(
      new THREE.Vector2(window.innerWidth, window.innerHeight),
      0.9, // strength
      0.5, // radius
      0.55, // luminance threshold (only HDR energy elements bloom)
    );
    this.composer.addPass(bloom);

    this.resize();
    window.addEventListener("resize", () => this.resize());
  }

  private buildHud(): HudData {
    return {
      speed: 0, throttle: 0, maxSpeed: MAX_SPEED, hull: 100, shields: 100,
      score: 0, wave: 1, lives: 3, enemiesLeft: 0, sfoils: true, torps: 8,
      laserHeat: 0, boost: 0, view: this.view, flightAssist: true,
      blips: [], radarRange: this.RADAR_RANGE,
    };
  }

  // ---- progression ----
  private startWave(): void {
    this.wave++;
    const n = 6 + this.wave * 3; // 9, 12, 15, ... a proper swarm
    this.enemies.skill = Math.min(1, this.wave * 0.16); // ramp difficulty
    this.enemies.spawnWave(n, this.player.group.position);
    this.flash(`WAVE ${this.wave} — ${n} TIE FIGHTERS INBOUND`, 2.5);
  }

  private flash(msg: string, secs: number): void {
    this.message = msg;
    this.messageUntil = this.clock.getElapsedTime() + secs;
  }

  // ---- player damage / respawn ----
  private damagePlayer(dmg: number, kind: "gun" | "missile" = "gun"): void {
    if (this.dead) return;
    this.timeSinceHit = 0;
    this.onPlayerHit?.();

    // A missile is always fatal — straight to the boom, no fire stage.
    if (kind === "missile") {
      this.hull = 0;
      this.killPlayer();
      return;
    }

    // No shields — all damage hits the hull directly.
    const hullBefore = this.hull;
    this.hull -= dmg;
    // Count gun hits that bit into the hull; after ~3, the ship catches fire.
    if (this.hull < hullBefore) {
      this.gunHits++;
      if (this.gunHits >= 3) this.ensureDamageFire();
    }
    if (this.hull <= 0) {
      this.hull = 0;
      this.killPlayer();
    }
  }

  /** Attach a flickering fire + smoke to the X-wing when it's badly shot up. */
  private ensureDamageFire(): void {
    if (this.damageFire) return;
    const g = new THREE.Group();
    const flame = new THREE.Mesh(
      new THREE.ConeGeometry(0.9, 2.6, 8),
      new THREE.MeshBasicMaterial({ color: new THREE.Color(3.2, 1.2, 0.3), transparent: true, opacity: 0.9, toneMapped: false }),
    );
    flame.position.set(1.3, 0.5, 2.2); // off a wing root / engine
    g.add(flame);
    g.userData.flame = flame;
    this.player.group.add(g);
    this.damageFire = g;
  }

  private removeDamageFire(): void {
    if (this.damageFire) { this.player.group.remove(this.damageFire); this.damageFire = null; }
    this.gunHits = 0;
  }

  private killPlayer(): void {
    this.dead = true;
    this.lives--;
    this.removeDamageFire();
    // Detailed breakup: an initial blast, a staggered chain of secondary
    // explosions, a big spread of tumbling wreckage, and a camera shake.
    const p = this.player.group.position.clone();
    const v = this.player.vel.clone();
    this.effects.spawnExplosion(p, 3.0);
    this.effects.spawnDebris(p, v, 22, 1.8);
    // staggered secondary detonations along the wreck's momentum
    for (let i = 1; i <= 4; i++) {
      const t = i * 0.18;
      const off = p.clone().addScaledVector(v.clone().normalize(), i * 18)
        .add(new THREE.Vector3((Math.random() - 0.5) * 36, (Math.random() - 0.5) * 36, (Math.random() - 0.5) * 36));
      setTimeout(() => this.effects.spawnExplosion(off, 1.2 + Math.random()), t * 1000);
    }
    this.shakeUntil = this.clock.getElapsedTime() + 0.9;
    this.shakeMag = 6;
    this.onExplosion?.();
    this.player.group.visible = false;
    this.view = "chase";
    if (this.lives <= 0) {
      this.flash(`GAME OVER — SCORE ${this.score}`, 4);
      this.respawnAt = this.clock.getElapsedTime() + 4;
    } else {
      this.flash(`HIT! ${this.lives} X-WING${this.lives === 1 ? "" : "S"} LEFT`, 2.5);
      this.respawnAt = this.clock.getElapsedTime() + 2.8;
    }
  }

  private respawn(fullRestart: boolean): void {
    if (fullRestart) {
      this.score = 0; this.wave = 0; this.lives = 3;
      this.enemies.clearAll();
      this.lockedId = null; this.lockProgress = 0; this.hardLock = false;
      this.startWave();
    }
    this.player.group.position.set(0, 0, 0);
    this.player.group.quaternion.identity();
    this.player.resetMotion(320);
    this.hull = 100;
    this.laserHeat = 0; this.overheated = false;
    this.removeDamageFire();
    this.player.group.visible = true;
    this.dead = false;
  }

  // ---- weapons (called by host on key press) ----
  firePrimary(): void {
    if (this.dead || this.overheated) return;
    const now = this.clock.getElapsedTime();
    if (now - this.lastFire < 0.1) return;
    this.lastFire = now;

    const muzzles = this.player.muzzles();
    const vel = this.player.velocity();
    const fwd = this.player.forward();

    // Gun aim-assist: bolts converge onto the locked target's intercept solution
    // ONLY while your boresight reticle is inside the on-screen lock circle
    // (computed each frame in composeHud). Otherwise they fire straight boresight.
    let aimDir = fwd;
    const info = this.lockedId != null ? this.enemies.info(this.lockedId) : null;
    if (info && this.aimAssistActive) {
      const rel = info.position.clone().sub(this.player.group.position);
      const relVel = info.velocity.clone().sub(this.player.vel);
      const tHit = this.interceptTime(rel, relVel, BOLT_SPEED);
      if (tHit != null) {
        aimDir = info.position.clone().addScaledVector(info.velocity, tHit)
          .sub(this.player.group.position).normalize();
      }
    }

    const pair = this.cannonIdx % 2 === 0 ? [0, 3] : [1, 2];
    this.cannonIdx++;
    for (const i of pair) {
      const o = muzzles[i].addScaledVector(fwd, 24);
      this.blasters.fire(o, aimDir, vel, "player", 6);
    }
    this.laserHeat = Math.min(1.2, this.laserHeat + 0.08);
    if (this.laserHeat >= 1) this.overheated = true;
    this.onPlayerFire?.();
    // Broadcast to other players (they spawn an incoming bolt that can hit them).
    if (this.onFire) {
      const bp = this.player.group.position.clone().addScaledVector(fwd, 24);
      this.onFire([bp.x, bp.y, bp.z], [fwd.x, fwd.y, fwd.z], [vel.x, vel.y, vel.z]);
    }
  }

  // ---- online multiplayer ----
  upsertRemote(id: number, s: ShipSnapshot): void {
    let r = this.remotes.get(id);
    if (!r) {
      const x = buildXWing();
      this.scene.add(x.group);
      r = { x, group: x.group, tp: new THREE.Vector3(), tq: new THREE.Quaternion(), sfoils: 1, boost: 0 };
      this.remotes.set(id, r);
    }
    r.tp.set(s.p[0], s.p[1], s.p[2]);
    r.tq.set(s.q[0], s.q[1], s.q[2], s.q[3]);
    r.sfoils = s.s;
    r.boost = s.b;
  }
  removeRemote(id: number): void {
    const r = this.remotes.get(id);
    if (r) { this.scene.remove(r.group); this.remotes.delete(id); }
  }
  spawnNetBolt(f: FireEvent): void {
    this.blasters.fire(
      new THREE.Vector3(f.o[0], f.o[1], f.o[2]),
      new THREE.Vector3(f.d[0], f.d[1], f.d[2]),
      new THREE.Vector3(f.v[0], f.v[1], f.v[2]),
      "enemy", 6,
    );
  }
  /** Our ship state for the network snapshot. */
  getNetState(): ShipSnapshot {
    const p = this.player.group.position, q = this.player.group.quaternion, v = this.player.vel;
    return {
      p: [p.x, p.y, p.z], q: [q.x, q.y, q.z, q.w], v: [v.x, v.y, v.z],
      s: this.player.sfoilsOpen ? 1 : 0, b: this.player.boosting ? 1 : 0, t: this.lastThrottle,
    };
  }

  launchTorpedo(): void {
    if (this.dead || this.torps <= 0) return;
    // Guided only with a hard radar lock; otherwise it flies dumb (straight).
    const target = this.hardLock ? this.findTargetCombatant() : null;
    if (!target) this.flash("NO LOCK — FIRING UNGUIDED", 1.0);
    this.torps--;
    const o = this.player.group.position.clone().addScaledVector(this.player.forward(this.tmp), 8);
    const dir = this.player.forward(this.tmp2).clone();
    this.blasters.launchTorpedo(o, dir, this.player.velocity(), target);
    this.onTorpedo?.();
  }

  cycleTarget(): void {
    // Designate the nearest TIE and restart the lock timer.
    this.lockedId = this.enemies.nearestId(this.player.group.position);
    this.lockProgress = 0;
  }

  /** Air-to-ground: laser-guided bomb onto the designated ground point. */
  launchBomb(): void {
    if (this.dead) return;
    if (!this.groundTarget) { this.flash("NO GROUND TARGET — POINT AT A SURFACE", 1.2); return; }
    if (this.torps <= 0) { this.flash("NO ORDNANCE", 1.0); return; }
    this.torps--;
    const o = this.player.group.position.clone().addScaledVector(this.player.forward(this.tmp), 8);
    const dir = this.groundTarget.clone().sub(o).normalize();
    this.blasters.launchGuidedBomb(o, dir, this.player.velocity(), this.groundTarget);
    this.flash("BOMB AWAY — LGB GUIDING", 1.2);
    this.onTorpedo?.();
  }

  /** Laser designator: march the nose ray to the surface to find a ground spot. */
  private computeGroundTarget(): THREE.Vector3 | null {
    const o = this.player.group.position;
    const dir = this.player.forward(this.tmp);
    for (let d = 150; d < 14000; d += 150) {
      const x = o.x + dir.x * d, y = o.y + dir.y * d, z = o.z + dir.z * d;
      const gh = this.surfaceHeightAt(x, z);
      if (Number.isFinite(gh) && y <= gh + 4) return new THREE.Vector3(x, gh + 2, z);
    }
    return null;
  }

  /** Aim the pod camera: at the designated ground point if any, else a forward
   *  sensor view that follows a locked target / the nose — so the MFD is never
   *  blank. */
  private updatePod(): void {
    this.groundTarget = this.computeGroundTarget();
    this.podCam.position.copy(this.player.group.position);
    this.podCam.up.set(0, 1, 0).applyQuaternion(this.player.group.quaternion);
    let lookAt: THREE.Vector3;
    if (this.groundTarget) {
      lookAt = this.groundTarget;
    } else {
      const info = this.lockedId != null ? this.enemies.info(this.lockedId) : null;
      lookAt = info
        ? info.position
        : this.player.group.position.clone().addScaledVector(this.player.forward(this.tmp), 4000);
    }
    this.podCam.lookAt(lookAt);
  }

  private pickButton(clientX: number, clientY: number): string | null {
    const ndc = new THREE.Vector2(
      (clientX / window.innerWidth) * 2 - 1,
      -(clientY / window.innerHeight) * 2 + 1,
    );
    this.raycaster.setFromCamera(ndc, this.camera);
    const hits = this.raycaster.intersectObjects(this.cockpit.buttons.map((b) => b.mesh), false);
    return hits.length ? (hits[0].object.userData.cockpitButton as string) : null;
  }

  /** Highlight the console button under the cursor; returns true if hovering one. */
  updateHover(clientX: number, clientY: number): boolean {
    if (this.view !== "cockpit" || this.dead) { this.cockpit.setHover(null); return false; }
    const id = this.pickButton(clientX, clientY);
    this.cockpit.setHover(id);
    return id !== null;
  }

  /** Forward a pointer click in the cockpit view to the console buttons. */
  handleClick(clientX: number, clientY: number): boolean {
    if (this.view !== "cockpit" || this.dead) return false;
    const id = this.pickButton(clientX, clientY);
    if (!id) return false;
    this.cockpit.press(id);
    this.onCockpitClick?.();
    switch (id) {
      case "SFOIL": this.toggleSFoils(); break;
      case "ASSIST": this.toggleFlightAssist(); break;
      case "TARGET": this.cycleTarget(); break;
      case "FIRE": this.firePrimary(); break;
      case "VIEW": this.toggleView(); break;
      case "GEAR": this.toggleGear(); break;
      case "VTOL": this.toggleVtol(); break;
      case "BOMB": this.launchBomb(); break;
      case "AUTO": this.toggleAutoLock(); break;
    }
    return true;
  }

  /**
   * Real-world phenomena over a celestial body: a gravity well pulls you down and
   * the atmosphere applies aerodynamic drag, both fading with altitude to a
   * frictionless vacuum in open space. You must hold thrust (or hover in VTOL)
   * to stay aloft near the deck.
   */
  /** Air density 0..1 at the player (0 = vacuum, 1 = planet surface). */
  private atmoDensity(): number {
    const d = this.tmp.copy(PLANET_CENTER3).sub(this.player.group.position).length();
    const alt = d - PLANET_R;
    if (alt < 0 || alt > ATMO_THICKNESS) return 0;
    return 1 - alt / ATMO_THICKNESS;
  }

  private applyEnvironment(dt: number): void {
    // Gravity well inside the GREEN PLANET's atmosphere (aerodynamic drag/lift are
    // handled in the ship's atmospheric flight model). Open space stays vacuum.
    const pos = this.player.group.position;
    const toCenter = this.tmp.copy(PLANET_CENTER3).sub(pos);
    const d = toCenter.length();
    const alt = d - PLANET_R;
    if (alt < 0 || alt > ATMO_THICKNESS) return;
    const density = 1 - alt / ATMO_THICKNESS;
    // Accelerate radially toward the planet centre (so a dive speeds up).
    this.player.vel.addScaledVector(toCenter.divideScalar(d || 1), G_SURF * density * dt);
  }

  /** Planet / Death Star surface: ground collision, landing, base repair. */
  private handleSurface(dt: number): void {
    this.landed = false;
    this.agl = null;
    const pos = this.player.group.position;
    const gh = this.surfaceHeightAt(pos.x, pos.z);
    if (!Number.isFinite(gh)) return; // open space

    const deck = gh + 3;
    this.agl = pos.y - deck;
    if (pos.y >= deck) return; // still airborne

    const speed = this.player.speed;
    const gear = this.player.gearDown;
    if (speed > 150) {
      this.damagePlayer(speed * 0.22); // hard impact
      this.player.vel.multiplyScalar(0.15);
    } else if (!gear && speed > 25) {
      this.damagePlayer(speed * 0.12); // belly scrape, gear up
    }
    // settle onto the surface
    pos.y = deck;
    if (this.player.vel.y < 0) this.player.vel.y = 0;
    this.agl = 0;

    if (speed < 120) {
      if (!gear) { this.flash("LOWER LANDING GEAR (L)", 0.5); return; }
      this.landed = true;
      let nearPad = Infinity;
      for (const pad of this.pads) nearPad = Math.min(nearPad, Math.hypot(pos.x - pad.x, pos.z - pad.z));
      if (nearPad < 480) {
        this.hull = Math.min(100, this.hull + 24 * dt);
        this.torps = 8;
        if (this.hull > 80) this.removeDamageFire(); // repaired enough to snuff the fire
        this.flash("DOCKED — REPAIRING & REARMING", 0.4);
      } else {
        this.flash("LANDED — FLY TO A PAD TO REPAIR", 0.4);
      }
    }
  }

  /** Flicker the battle-damage fire and trail smoke off the hull. */
  private updateDamageFx(dt: number): void {
    if (!this.damageFire) return;
    const flame = this.damageFire.userData.flame as THREE.Mesh;
    flame.scale.setScalar(0.7 + Math.random() * 0.6);
    (flame.material as THREE.MeshBasicMaterial).opacity = 0.7 + Math.random() * 0.3;
    this.smokeTimer -= dt;
    if (this.smokeTimer <= 0) {
      this.smokeTimer = 0.1;
      this.effects.spawnSmoke(flame.getWorldPosition(this.tmp).clone());
    }
  }

  toggleSFoils(): void { this.player.toggleSFoils(); }
  toggleView(): void {
    this.view = this.view === "chase" ? "cockpit" : "chase";
    this.lookYaw = 0; this.lookPitch = 0; // recenter the drag-look on view change
  }
  toggleGear(): void { this.player.toggleGear(); }
  toggleVtol(): void { this.player.toggleVtol(); }
  toggleAutoLock(): void {
    this.autoLock = !this.autoLock;
    this.flash(this.autoLock ? "AUTO TARGET ON" : "MANUAL TARGET (T)", 1.5);
  }

  toggleFlightAssist(): void { this.player.toggleFlightAssist(); }

  private pushFeed(text: string, color: string): void {
    this.feed.push({ text, color, until: this.clock.getElapsedTime() + 4.5 });
    if (this.feed.length > 6) this.feed.shift();
  }

  /** True if a world point (with its own radius) is inside the X-wing's oriented box. */
  private boxHitsPoint(p: THREE.Vector3, pad: number): boolean {
    const local = this.tmp.copy(p).sub(this.player.group.position)
      .applyQuaternion(this._q.copy(this.player.group.quaternion).invert());
    const h = this.playerHalf;
    return Math.abs(local.x) <= h.x + pad
      && Math.abs(local.y) <= h.y + pad
      && Math.abs(local.z) <= h.z + pad;
  }

  /**
   * Swept collision against solid bodies (obstacle boxes + celestial spheres).
   * Samples several points along the path travelled this frame so a fast ship
   * can't tunnel through thin walls.
   */
  private obstacleHit(): boolean {
    const r = 9; // X-wing bounding radius
    const cur = this.player.group.position;
    const steps = Math.max(1, Math.ceil(this.prevPos.distanceTo(cur) / 30));
    for (let s = 0; s <= steps; s++) {
      const p = this.tmp.copy(this.prevPos).lerp(cur, s / steps);
      for (const b of this.obstacles) {
        if (b.distanceToPoint(p) < r) return true;
      }
      // Penetrating a celestial body's surface (margin so landing on top is OK).
      for (const sph of this.crashSpheres) {
        if (p.distanceTo(sph.c) < sph.r - 35) return true;
      }
      // The Death Star is solid EXCEPT inside its equatorial trench channel.
      if (this.deathStarHit(p)) return true;
    }
    return false;
  }

  /** Solid Death Star, with the equatorial trench cut out so you can fly it. */
  private deathStarHit(p: THREE.Vector3): boolean {
    const rel = this._dsRel.copy(p).sub(DS_SPHERE_CENTER);
    const d = rel.length();
    if (d > DS_SPHERE_R - 9 || d < 1) return false; // outside the shell → free space
    // In the trench band? (near the equatorial plane, within the cut depth)
    const inTrench = Math.abs(rel.y) < DS_TRENCH_W - 12 && d > DS_SPHERE_R - DS_TRENCH_DEPTH;
    return !inTrench; // solid hull everywhere except the open trench channel
  }

  /**
   * Smallest positive time for a projectile of muzzle `speed` to intercept a
   * target at relative position/velocity (classic lead-fire quadratic). Returns
   * null if there's no solution (target outrunning the bolt).
   */
  private interceptTime(relPos: THREE.Vector3, relVel: THREE.Vector3, speed: number): number | null {
    const a = relVel.dot(relVel) - speed * speed;
    const b = 2 * relPos.dot(relVel);
    const c = relPos.dot(relPos);
    if (Math.abs(a) < 1e-6) {
      if (Math.abs(b) < 1e-9) return null;
      const t = -c / b;
      return t > 0 ? t : null;
    }
    const disc = b * b - 4 * a * c;
    if (disc < 0) return null;
    const s = Math.sqrt(disc);
    const t1 = (-b - s) / (2 * a), t2 = (-b + s) / (2 * a);
    const cand = [t1, t2].filter((x) => x > 0).sort((x, y) => x - y);
    return cand.length ? cand[0] : null;
  }

  private findTargetCombatant(): Combatant | null {
    if (this.lockedId == null) return null;
    return this.enemies.combatants.find((c) => c.id === this.lockedId && c.alive) ?? null;
  }

  // ---- main step ----
  update(controls: Controls, dt: number): void {
    const t = this.clock.getElapsedTime();
    this.lastThrottle = controls.throttle;

    // Effects + projectiles always advance.
    this.effects.update(dt);

    if (this.dead) {
      if (t >= this.respawnAt) this.respawn(this.lives <= 0);
    } else {
      this.prevPos.copy(this.player.group.position); // for swept collision
      this.player.update(controls, dt, this.atmoDensity());
      // The sublight accelerator only works with the S-foils folded.
      if (controls.boost && this.player.sfoilsOpen) this.flash("FOLD S-FOILS FOR SUBLIGHT", 0.6);
      this.timeSinceHit += dt;
      // laser cooling
      this.laserHeat = Math.max(0, this.laserHeat - dt * 0.35);
      if (this.overheated && this.laserHeat < 0.3) this.overheated = false;

      this.applyEnvironment(dt);
      this.handleSurface(dt);
      this.updateDamageFx(dt);

      // Crash into solid obstacles: trench walls, base buildings, etc. Uses the
      // X-wing's oriented box vs each obstacle box for an accurate hit.
      if (this.obstacleHit()) {
        this.flash("CRASHED INTO OBSTACLE", 2.5);
        this.killPlayer();
      }

      // Ship-to-ship collision with another fighter (friend or foe) = crash.
      for (const r of this.remotes.values()) {
        if (this.boxHitsPoint(r.group.position, 11)) {
          this.flash("MID-AIR COLLISION", 2.0);
          this.killPlayer();
          break;
        }
      }
    }

    // Sublight accelerator visual ramp + FOV punch (driven by *effective* boost).
    const boosting = this.player.boosting && !this.dead;
    this.boostVis += ((boosting ? 1 : 0) - this.boostVis) * (1 - Math.exp(-dt * 6));
    const fov = this.baseFov + this.boostVis * 22;
    if (Math.abs(this.camera.fov - fov) > 0.01) {
      this.camera.fov = fov;
      this.camera.updateProjectionMatrix();
    }

    // Enemy AI + firing.
    const playerRef = { position: this.player.group.position, velocity: this.player.velocity(this.tmp).clone(), forward: this.player.forward() };
    this.enemies.update(dt, t, playerRef, (origin, dir, ownVel) => {
      this.blasters.fire(origin, dir, ownVel, "enemy", 9);
      this.onEnemyFire?.();
    });

    // Collisions: player + TIEs + destructible ground targets.
    const combatants: Combatant[] = this.dead
      ? [...this.enemies.combatants, ...this.groundTargets.combatants]
      : [this.playerCombatant, ...this.enemies.combatants, ...this.groundTargets.combatants];
    this.blasters.update(dt, combatants);
    // Death Star turrets aim + fire green bolts at the player.
    const pRef = { position: this.player.group.position, velocity: this.player.velocity(this.tmp).clone() };
    this.groundTargets.update(dt, pRef, (origin, dir) => {
      this.blasters.fire(origin, dir, this.tmp2.set(0, 0, 0), "enemy", 9);
      this.onEnemyFire?.();
    });

    // Ramming a TIE (or a ground turret/port) destroys it — and crashes you.
    if (!this.dead) {
      for (const c of [...this.enemies.combatants, ...this.groundTargets.combatants]) {
        if (!c.alive) continue;
        if (this.boxHitsPoint(c.position, c.radius)) {
          c.hit(999, c.position.clone());
          this.effects.spawnExplosion(c.position.clone(), 1.2);
          this.flash("MID-AIR COLLISION", 2.0);
          this.killPlayer();
          break;
        }
      }
    }

    // Drop a stale lock; in auto mode, re-acquire the nearest TIE. In manual
    // mode the player owns target selection (T) and we never auto-grab.
    if (this.lockedId != null && !this.enemies.info(this.lockedId)) this.lockedId = null;
    if (this.autoLock && this.lockedId == null && this.enemies.aliveCount > 0) {
      this.lockedId = this.enemies.nearestId(this.player.group.position);
      this.lockProgress = 0;
    }

    // Radar lock-on: a hard lock builds while the designated target is held in
    // the forward sensor cone and within range; it decays otherwise.
    const li = this.lockedId != null ? this.enemies.info(this.lockedId) : null;
    if (li && !this.dead) {
      const to = this.tmp.copy(li.position).sub(this.player.group.position);
      const dist = to.length();
      const inCone = to.normalize().dot(this.player.forward(this.tmp2)) > 0.94; // ~20deg
      if (inCone && dist < 6000) this.lockProgress = Math.min(1, this.lockProgress + dt / 1.1);
      else this.lockProgress = Math.max(0, this.lockProgress - dt * 1.5);
    } else {
      this.lockProgress = Math.max(0, this.lockProgress - dt * 2.5);
    }
    this.hardLock = this.lockProgress >= 1;
    if (this.hardLock && !this.prevHardLock) this.onLock?.();
    this.prevHardLock = this.hardLock;

    // Cockpit indicator lights + button press animation.
    this.cockpit.setIndicator("SFOIL", this.player.sfoilsOpen);
    this.cockpit.setIndicator("ASSIST", this.player.flightAssist);
    this.cockpit.setIndicator("GEAR", this.player.gearDown);
    this.cockpit.setIndicator("AUTO", this.autoLock); // lit = auto target acquire
    this.cockpit.setGearLever(this.player.gearDown);
    this.cockpit.setVtolDial(this.player.vtol);
    this.cockpit.update(performance.now());

    // Interpolate other players' ships toward their latest snapshots.
    if (this.remotes.size) {
      const k = 1 - Math.exp(-dt * 10);
      for (const r of this.remotes.values()) {
        r.group.position.lerp(r.tp, k);
        r.group.quaternion.slerp(r.tq, k);
        r.x.setSFoils(r.sfoils);
        r.x.setThrottle(r.boost ? 1 : 0.55);
      }
    }

    // Wave management.
    if (!this.dead && this.enemies.aliveCount === 0) {
      if (this.nextWaveAt === 0) { this.nextWaveAt = t + 3; this.flash("SECTOR CLEAR", 2.5); }
      else if (t >= this.nextWaveAt) { this.nextWaveAt = 0; this.startWave(); }
    }

    this.updatePod();
    this.updateCamera();
    this.composeHud(t);
  }

  /** Drag-to-look: orbit the camera (chase) / free-look (cockpit). */
  adjustLook(dPitch: number, dYaw: number): void {
    this.lookYaw += dYaw;
    this.lookPitch = Math.max(-1.3, Math.min(1.3, this.lookPitch + dPitch));
  }

  private updateCamera(): void {
    const q = this.player.group.quaternion;
    const p = this.player.group.position;
    const inCockpit = this.view === "cockpit" && !this.dead;
    this.cockpit.group.visible = inCockpit;
    this.player.setExteriorVisible(!inCockpit);
    const lookE = new THREE.Euler(this.lookPitch, this.lookYaw, 0, "YXZ");
    if (inCockpit) {
      // Pilot's eye, set back from the panel so the dash doesn't fill the view.
      const eye = this.tmp.set(0, 0.92, -0.2).applyQuaternion(q).add(p);
      // Gaze looks forward out the windscreen (slight down bias) — like Luke's
      // view: stars/enemies ahead, the instrument dash in the lower third.
      const dir = this.tmp2.set(0, -0.14, -1).normalize().applyEuler(lookE).applyQuaternion(q);
      this.camera.position.copy(eye);
      this.camera.up.set(0, 1, 0).applyQuaternion(q);
      this.camera.lookAt(eye.clone().addScaledVector(dir, 200));
    } else {
      // Chase: behind + above, orbited around the ship by the drag offsets (360°).
      const off = this.dead ? this.tmp.set(0, 40, 160) : this.tmp.set(0, 9, 46);
      off.applyEuler(lookE).applyQuaternion(q).add(p);
      this.camera.position.copy(off);
      this.camera.up.set(0, 1, 0).applyQuaternion(q);
      this.camera.lookAt(p);
    }
    // Crash camera shake.
    if (this.clock.getElapsedTime() < this.shakeUntil) {
      const m = this.shakeMag;
      this.camera.position.x += (Math.random() - 0.5) * m;
      this.camera.position.y += (Math.random() - 0.5) * m;
      this.camera.position.z += (Math.random() - 0.5) * m;
    }
  }

  /** Project a world point to screen pixels; behind=true if it's behind camera. */
  private project(world: THREE.Vector3): { x: number; y: number; behind: boolean } {
    const v = world.clone().project(this.camera);
    return {
      x: (v.x + 1) / 2 * window.innerWidth,
      y: (1 - v.y) / 2 * window.innerHeight,
      behind: v.z > 1,
    };
  }

  private composeHud(t: number): void {
    const h = this.hud;
    h.speed = this.player.speed;
    h.throttle = this.lastThrottle;
    h.flightAssist = this.player.flightAssist;
    h.hull = Math.max(0, Math.round(this.hull));
    h.shields = 0;
    h.score = this.score;
    h.wave = this.wave;
    h.lives = this.lives;
    h.enemiesLeft = this.enemies.aliveCount;
    h.sfoils = this.player.sfoilsOpen;
    h.torps = this.torps;
    h.laserHeat = Math.min(1, this.laserHeat);
    h.boost = this.boostVis;
    h.view = this.view;
    h.agl = this.agl;
    h.landed = this.landed;
    h.gear = this.player.gearDown;
    h.vtol = this.player.vtol;
    h.inAtmo = this.player.inAtmo;
    h.aoa = this.player.aoaDeg;
    h.gLoad = this.player.gLoad;
    h.stalled = this.player.stalled;
    this.feed = this.feed.filter((f) => f.until > t);
    h.feed = this.feed.map((f) => ({ text: f.text, color: f.color, alpha: Math.min(1, (f.until - t) / 0.8) }));
    h.a2g = null;
    if (this.groundTarget) {
      const pr = this.project(this.groundTarget);
      h.a2g = { x: pr.x, y: pr.y, behind: pr.behind, dist: this.groundTarget.distanceTo(this.player.group.position) };
    }
    h.message = t < this.messageUntil ? this.message : (this.overheated ? "LASERS OVERHEATED" : undefined);

    h.target = undefined;
    h.lock = undefined;
    const pp = this.player.group.position;

    // Green gun aimer (velocity-compensated pipper) — where your bolts actually
    // go. Computed first so the lock circle can gate off it.
    h.prograde = undefined;
    h.gunReticle = undefined;
    if (this.player.vel.lengthSq() > 1) {
      const pg = this.project(this.tmp.copy(this.player.vel).normalize().multiplyScalar(3000).add(pp));
      h.prograde = { x: pg.x, y: pg.y, behind: pg.behind };
    }
    const boltVel = this.player.forward().multiplyScalar(BOLT_SPEED).add(this.player.vel).normalize();
    const gr = this.project(boltVel.multiplyScalar(3000).add(pp));
    h.gunReticle = { x: gr.x, y: gr.y, behind: gr.behind };

    const info = this.lockedId != null ? this.enemies.info(this.lockedId) : null;
    if (info) {
      h.lock = { state: this.hardLock ? "locked" : "searching", progress: this.lockProgress };
      const box = this.project(info.position);
      const dist = info.position.distanceTo(pp);
      // Lead solution uses the bolt's true muzzle speed and the target's
      // velocity relative to the firing ship (both inherit the ship's velocity).
      const relPos = info.position.clone().sub(pp);
      const relVel = info.velocity.clone().sub(this.player.vel);
      const tHit = this.interceptTime(relPos, relVel, BOLT_SPEED);
      let lead: { x: number; y: number } | undefined;
      if (tHit != null && !box.behind) {
        const lp = this.project(info.position.clone().addScaledVector(info.velocity, tHit));
        if (!lp.behind) lead = { x: lp.x, y: lp.y };
      }
      h.target = { x: box.x, y: box.y, dist, behind: box.behind, lead };

      // Aim-assist gate circle: a ring around the locked TIE. Lasers converge
      // while the GREEN GUN AIMER (the pipper) sits inside it and the target is
      // in range and ahead. Bigger = more forgiving to shoot.
      const R = 70;
      const inside = !box.behind && !gr.behind && dist < 3700
        && Math.hypot(box.x - gr.x, box.y - gr.y) < R;
      this.aimAssistActive = inside;
      if (!box.behind) h.assistCircle = { x: box.x, y: box.y, r: R, active: inside };

      // Hornet gun cues: closure rate, gun-range arc, and the SHOOT solution.
      const los = relPos.clone().normalize();
      h.closure = -relVel.dot(los); // + = closing
      h.gunRange = GUN_RMAX;
      h.shoot = inside && dist < GUN_RMAX;
    } else {
      this.aimAssistActive = false;
      h.closure = undefined; h.shoot = false; h.gunRange = undefined;
    }
    // HUD heading tape: world -Z = 000 (north), +X = 090.
    const fwd2 = this.player.forward(this.tmp);
    h.heading = (Math.atan2(fwd2.x, -fwd2.z) * 180 / Math.PI + 360) % 360;

    // Radar contacts + cockpit instruments.
    this.updateRadar();
    h.blips = this.blips;
    this.cockpit.setBars(this.hull, Math.min(1, h.throttle));
  }

  /** Build player-local radar blips and refresh the cockpit scope texture. */
  private updateRadar(): void {
    const inv = this._q.copy(this.player.group.quaternion).invert();
    const pp = this.player.group.position;
    this.blips.length = 0;
    for (const c of this.enemies.combatants) {
      if (!c.alive) continue;
      const rel = this.tmp.copy(c.position).sub(pp).applyQuaternion(inv);
      const n = Math.min(1, rel.length() / this.RADAR_RANGE);
      const horiz = Math.atan2(rel.x, -rel.z); // 0 = dead ahead
      this.blips.push({
        rx: Math.sin(horiz) * n,
        ry: -Math.cos(horiz) * n,
        elev: rel.y,
        locked: c.id === this.lockedId,
      });
    }
    const ctx = this.scopeCtx;
    ctx.clearRect(0, 0, 256, 256);
    drawRadar(ctx, 128, 128, 116, this.blips, this.clock.getElapsedTime());
    this.cockpit.scopeTex.needsUpdate = true;
  }

  getHud(): HudData { return this.hud; }

  private resize(): void {
    const w = window.innerWidth, h = window.innerHeight;
    this.renderer.setSize(w, h, false);
    this.composer?.setPixelRatio(this.renderer.getPixelRatio());
    this.composer?.setSize(w, h);
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
  }

  render(): void {
    // Render the sensor/targeting-pod view to the MFD texture (own ship hidden).
    // Done whenever the cockpit MFD is visible, so the screen is never blank.
    if (this.view === "cockpit" && !this.dead) {
      const prevV = this.player.group.visible;
      this.player.group.visible = false;
      this.renderer.setRenderTarget(this.tvTarget);
      this.renderer.clear();
      this.renderer.render(this.scene, this.podCam);
      this.renderer.setRenderTarget(null);
      this.player.group.visible = prevV;
    }
    this.composer.render();
  }
}
