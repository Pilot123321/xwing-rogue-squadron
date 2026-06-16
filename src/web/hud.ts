/**
 * X-wing targeting-computer HUD, drawn on a 2D canvas overlay: boresight
 * crosshair, locked-target box with range + lead pip, shields/hull/laser-heat
 * bars, throttle, score/wave/lives, and centre messages. Rebel amber/cyan.
 */

import type { HudData } from "./scene.ts";
import { drawRadar } from "./radar.ts";

const AMBER = "#ffb627";
const CYAN = "#46d8ff";
const RED = "#ff4533";
const GREEN = "#5dff7a";

export class HUD {
  private ctx: CanvasRenderingContext2D;
  private time = 0;
  // Stable per-streak angle + phase so the speed lines don't flicker randomly.
  private streaks = Array.from({ length: 60 }, () => ({
    ang: Math.random() * Math.PI * 2,
    phase: Math.random(),
    speed: 0.6 + Math.random() * 1.2,
  }));
  constructor(private canvas: HTMLCanvasElement) {
    this.ctx = canvas.getContext("2d")!;
    this.resize();
    window.addEventListener("resize", () => this.resize());
  }

  /** Radial "jump to lightspeed" streaks while the sublight accelerator is on. */
  private drawStreaks(cx: number, cy: number, intensity: number): void {
    if (intensity < 0.02) return;
    const ctx = this.ctx;
    const maxR = Math.hypot(cx, cy);
    ctx.save();
    ctx.lineCap = "round";
    for (const s of this.streaks) {
      const p = (s.phase + this.time * s.speed) % 1;
      const inner = (0.12 + p * 0.9) * maxR;
      const len = (40 + p * 260) * intensity;
      const ca = Math.cos(s.ang), sa = Math.sin(s.ang);
      const a = Math.min(1, intensity) * Math.min(1, p * 2) * (1 - p) * 2.2;
      ctx.strokeStyle = `rgba(170,225,255,${Math.max(0, Math.min(0.9, a))})`;
      ctx.lineWidth = 1 + intensity * 2;
      ctx.beginPath();
      ctx.moveTo(cx + ca * inner, cy + sa * inner);
      ctx.lineTo(cx + ca * (inner + len), cy + sa * (inner + len));
      ctx.stroke();
    }
    ctx.restore();
  }

  private resize(): void {
    this.canvas.width = window.innerWidth;
    this.canvas.height = window.innerHeight;
  }

  draw(d: HudData): void {
    const ctx = this.ctx;
    const W = this.canvas.width, H = this.canvas.height;
    const cx = W / 2, cy = H / 2;
    ctx.clearRect(0, 0, W, H);
    this.time += 0.016;
    this.drawStreaks(cx, cy, d.boost);
    ctx.lineWidth = 2;
    ctx.font = "15px monospace";
    ctx.textBaseline = "middle";

    // --- Boresight crosshair (cyan) ---
    ctx.strokeStyle = CYAN;
    ctx.beginPath();
    ctx.moveTo(cx - 26, cy); ctx.lineTo(cx - 9, cy);
    ctx.moveTo(cx + 9, cy); ctx.lineTo(cx + 26, cy);
    ctx.moveTo(cx, cy - 26); ctx.lineTo(cx, cy - 9);
    ctx.moveTo(cx, cy + 9); ctx.lineTo(cx, cy + 26);
    ctx.stroke();
    ctx.beginPath(); ctx.arc(cx, cy, 4, 0, Math.PI * 2); ctx.stroke();

    // --- Hornet A/A gun reticle (green): a 50-mil circle + centre pipper at the
    // gun aimer, with a closing target-range ARC around it (full = max range,
    // shrinks as the target closes). Plus the SHOOT cue when the solution is good. ---
    if (d.gunReticle && !d.gunReticle.behind) {
      const g = d.gunReticle;
      const rad = 26;
      ctx.strokeStyle = GREEN; ctx.lineWidth = 2;
      ctx.beginPath(); ctx.arc(g.x, g.y, rad, 0, Math.PI * 2); ctx.stroke();
      // centre pipper
      ctx.fillStyle = GREEN;
      ctx.beginPath(); ctx.arc(g.x, g.y, 2.4, 0, Math.PI * 2); ctx.fill();
      // range arc: starts at 12 o'clock, sweeps clockwise; length = range/Rmax
      if (d.gunRange && d.target && !d.target.behind) {
        const frac = Math.max(0, Math.min(1, 1 - d.target.dist / d.gunRange));
        if (frac > 0) {
          ctx.strokeStyle = d.shoot ? RED : GREEN;
          ctx.lineWidth = 4;
          ctx.beginPath();
          ctx.arc(g.x, g.y, rad + 5, -Math.PI / 2, -Math.PI / 2 + frac * Math.PI * 2);
          ctx.stroke();
        }
      }
      // SHOOT cue
      if (d.shoot) {
        ctx.fillStyle = RED;
        ctx.font = "bold 18px monospace";
        ctx.textAlign = "center";
        ctx.fillText("SHOOT", g.x, g.y - rad - 16);
        ctx.font = "15px monospace";
      }
      ctx.lineWidth = 2;
    }

    // --- Prograde marker: the velocity vector (where you're actually moving) ---
    if (d.prograde && !d.prograde.behind) {
      const p = d.prograde;
      ctx.strokeStyle = GREEN;
      ctx.lineWidth = 1.5;
      ctx.beginPath(); ctx.arc(p.x, p.y, 7, 0, Math.PI * 2); ctx.stroke();
      ctx.beginPath();
      ctx.moveTo(p.x - 7, p.y); ctx.lineTo(p.x - 13, p.y);
      ctx.moveTo(p.x + 7, p.y); ctx.lineTo(p.x + 13, p.y);
      ctx.moveTo(p.x, p.y - 7); ctx.lineTo(p.x, p.y - 13);
      ctx.stroke();
    }

    // --- Hornet airspeed box (left of centre) ---
    ctx.strokeStyle = GREEN; ctx.fillStyle = GREEN; ctx.lineWidth = 1.5;
    ctx.font = "20px monospace"; ctx.textAlign = "right";
    ctx.strokeRect(cx - 210, cy - 18, 78, 36);
    ctx.fillText(`${Math.round(d.speed)}`, cx - 138, cy);
    ctx.font = "12px monospace"; ctx.textAlign = "center";
    ctx.fillText("M/S", cx - 171, cy - 28);

    // (Heading tape removed — there's no absolute compass direction in space.)
    ctx.lineWidth = 2;

    // --- Aim-assist gate circle around the locked target ---
    if (d.assistCircle) {
      const a = d.assistCircle;
      ctx.strokeStyle = a.active ? GREEN : "rgba(150,170,185,0.5)";
      ctx.lineWidth = a.active ? 2.5 : 1.5;
      ctx.setLineDash(a.active ? [] : [5, 5]);
      ctx.beginPath();
      ctx.arc(a.x, a.y, a.r, 0, Math.PI * 2);
      ctx.stroke();
      ctx.setLineDash([]);
      ctx.lineWidth = 2;
    }

    // --- Target box + lead pip ---
    if (d.target) {
      if (d.target.behind || d.target.x < 0 || d.target.x > W || d.target.y < 0 || d.target.y > H) {
        // off-screen: arrow from centre toward target direction
        const ang = Math.atan2(d.target.y - cy, d.target.x - cx) + (d.target.behind ? Math.PI : 0);
        const r = Math.min(W, H) * 0.34;
        const ax = cx + Math.cos(ang) * r, ay = cy + Math.sin(ang) * r;
        ctx.save();
        ctx.translate(ax, ay); ctx.rotate(ang);
        ctx.strokeStyle = AMBER; ctx.fillStyle = AMBER;
        ctx.beginPath();
        ctx.moveTo(14, 0); ctx.lineTo(-8, -8); ctx.lineTo(-8, 8); ctx.closePath();
        ctx.fill();
        ctx.restore();
      } else {
        const { x, y, dist } = d.target;
        const inRange = dist < 3200;
        ctx.strokeStyle = inRange ? RED : AMBER;
        const s = 22;
        ctx.beginPath();
        // corner brackets
        for (const [sx, sy] of [[-1, -1], [1, -1], [1, 1], [-1, 1]] as [number, number][]) {
          ctx.moveTo(x + sx * s, y + sy * s - sy * 8);
          ctx.lineTo(x + sx * s, y + sy * s);
          ctx.lineTo(x + sx * s - sx * 8, y + sy * s);
        }
        ctx.stroke();
        // Hornet TD data: target range (100s of ft style → here metres) + closure.
        ctx.fillStyle = inRange ? RED : AMBER;
        ctx.textAlign = "left";
        ctx.fillText(`${Math.round(dist)}m`, x + s + 4, y - s);
        if (d.closure != null) {
          const c = Math.round(d.closure);
          ctx.fillText(`${c >= 0 ? "+" : ""}${c} m/s`, x + s + 4, y - s + 18);
        }
        // lead pip
        if (d.target.lead) {
          ctx.strokeStyle = GREEN;
          ctx.beginPath();
          ctx.arc(d.target.lead.x, d.target.lead.y, 7, 0, Math.PI * 2);
          ctx.moveTo(d.target.lead.x - 11, d.target.lead.y); ctx.lineTo(d.target.lead.x + 11, d.target.lead.y);
          ctx.moveTo(d.target.lead.x, d.target.lead.y - 11); ctx.lineTo(d.target.lead.x, d.target.lead.y + 11);
          ctx.stroke();
        }
        // radar lock reticle
        if (d.lock) {
          ctx.textAlign = "center";
          if (d.lock.state === "locked") {
            ctx.strokeStyle = RED; ctx.fillStyle = RED; ctx.lineWidth = 2;
            ctx.beginPath();
            ctx.moveTo(x, y - 30); ctx.lineTo(x + 30, y);
            ctx.lineTo(x, y + 30); ctx.lineTo(x - 30, y); ctx.closePath();
            ctx.stroke();
            ctx.font = "bold 13px monospace";
            ctx.fillText("◉ LOCK — MISSILE READY", x, y - 40);
            ctx.font = "15px monospace";
          } else if (d.lock.progress > 0.01) {
            // brackets close in as the lock builds
            const g = 34 - d.lock.progress * 12;
            ctx.strokeStyle = AMBER; ctx.lineWidth = 2;
            ctx.beginPath();
            ctx.moveTo(x - g, y - g + 9); ctx.lineTo(x - g, y - g); ctx.lineTo(x - g + 9, y - g);
            ctx.moveTo(x + g, y - g + 9); ctx.lineTo(x + g, y - g); ctx.lineTo(x + g - 9, y - g);
            ctx.moveTo(x + g, y + g - 9); ctx.lineTo(x + g, y + g); ctx.lineTo(x + g - 9, y + g);
            ctx.moveTo(x - g, y + g - 9); ctx.lineTo(x - g, y + g); ctx.lineTo(x - g + 9, y + g);
            ctx.stroke();
            ctx.fillStyle = AMBER; ctx.font = "12px monospace";
            ctx.fillText(`LOCKING ${Math.round(d.lock.progress * 100)}%`, x, y + g + 16);
            ctx.font = "15px monospace";
          }
        }
      }
    }

    // --- Left: hull / laser bars (shields removed) ---
    this.bar(30, H - 92, "HULL", d.hull / 100, d.hull > 30 ? GREEN : RED);
    this.bar(30, H - 64, "LASER", 1 - d.laserHeat, d.laserHeat > 0.8 ? RED : AMBER);

    // --- Surface altitude (AGL) when over a battlefield ---
    if (d.agl != null && Number.isFinite(d.agl)) {
      ctx.textAlign = "left";
      ctx.fillStyle = d.agl < 200 ? RED : AMBER;
      ctx.font = "15px monospace";
      ctx.fillText(`AGL ${Math.max(0, Math.round(d.agl))}`, 30, H - 150);
      if (d.landed) {
        ctx.fillStyle = GREEN;
        ctx.fillText("● LANDED", 110, H - 150);
      }
    }

    // --- Atmospheric flight cues (only in the planet's air): G load, AoA, and
    // an on-speed AoA bracket (~8.1° Hornet on-speed), plus a STALL warning. ---
    if (d.inAtmo) {
      ctx.textAlign = "left";
      ctx.font = "15px monospace";
      const g = d.gLoad ?? 1, aoa = d.aoa ?? 0;
      ctx.fillStyle = g > 7.5 ? RED : GREEN;
      ctx.fillText(`G ${g.toFixed(1)}`, 30, H - 200);
      ctx.fillStyle = aoa > 22 ? RED : (aoa > 14 ? AMBER : GREEN);
      ctx.fillText(`AOA ${Math.round(aoa)}°`, 30, H - 178);
      // On-speed AoA bracket on the left of the velocity vector (E-bracket).
      if (d.prograde && !d.prograde.behind) {
        const p = d.prograde, bx = p.x - 26;
        const onSpeed = aoa >= 6 && aoa <= 10;
        ctx.strokeStyle = onSpeed ? GREEN : (aoa > 10 ? RED : AMBER);
        ctx.lineWidth = 2;
        ctx.beginPath(); // chevron pointing right (on-speed indexer)
        ctx.moveTo(bx - 8, p.y - 9); ctx.lineTo(bx, p.y); ctx.lineTo(bx - 8, p.y + 9);
        ctx.stroke();
      }
      if (d.stalled) {
        ctx.fillStyle = RED; ctx.font = "bold 22px monospace"; ctx.textAlign = "center";
        ctx.fillText("STALL", cx, cy + 150);
        ctx.font = "15px monospace";
      }
    }

    // --- Throttle (bottom centre) ---
    ctx.strokeStyle = AMBER; ctx.fillStyle = AMBER;
    ctx.textAlign = "center";
    const tW = 220, tx = cx - tW / 2, ty = H - 36;
    ctx.strokeRect(tx, ty, tW, 12);
    ctx.fillRect(tx, ty, tW * Math.max(0, Math.min(1, d.throttle)), 12);
    ctx.fillText(`THR ${Math.round(d.throttle * 100)}%   ${Math.round(d.speed)} m/s   S-FOILS ${d.sfoils ? "ATTACK" : "CRUISE"}`, cx, ty - 14);
    // Flight-assist status (RCS dampers). OFF = pure Newtonian.
    ctx.fillStyle = d.flightAssist ? CYAN : RED;
    ctx.font = "bold 14px monospace";
    ctx.fillText(`FLIGHT ASSIST ${d.flightAssist ? "ON" : "OFF — NEWTONIAN"}`, cx, ty + 24);
    ctx.font = "15px monospace";
    // Gear / VTOL status
    const states: string[] = [];
    if (d.gear) states.push("GEAR DOWN");
    if (d.vtol) states.push("VTOL");
    if (states.length) {
      ctx.fillStyle = GREEN;
      ctx.font = "bold 14px monospace";
      ctx.fillText(states.join("   "), cx, ty + 42);
      ctx.font = "15px monospace";
    }
    ctx.fillStyle = AMBER;
    if (d.boost > 0.3) {
      ctx.fillStyle = CYAN;
      ctx.font = "bold 16px monospace";
      ctx.fillText("▶ SUBLIGHT ACCELERATOR ◀", cx, cy + 90);
      ctx.font = "15px monospace";
    }

    // --- Right: score / wave / lives / torps ---
    ctx.textAlign = "right";
    ctx.fillStyle = AMBER;
    ctx.font = "18px monospace";
    ctx.fillText(`SCORE ${d.score}`, W - 24, 28);
    ctx.font = "15px monospace";
    ctx.fillStyle = CYAN;
    ctx.fillText(`WAVE ${d.wave}`, W - 24, 54);
    ctx.fillText(`TIE x${d.enemiesLeft}`, W - 24, 76);
    ctx.fillStyle = GREEN;
    ctx.fillText(`X-WINGS ${d.lives}`, W - 24, 98);
    ctx.fillStyle = CYAN;
    ctx.fillText(`A2G BOMB x${d.torps}`, W - 24, 120);

    // --- Right-side kill feed (DCS-style translucent stacked panel) ---
    if (d.feed && d.feed.length) {
      const rows = d.feed.slice().reverse(); // newest on top
      const rowH = 30, padX = 16, padY = 12;
      const boxW = 320, boxH = rows.length * rowH + padY * 2;
      const bx = W - boxW - 20, by = 150;
      ctx.save();
      ctx.globalAlpha = 0.55;
      ctx.fillStyle = "#2a3642";
      ctx.fillRect(bx, by, boxW, boxH);
      ctx.restore();
      ctx.textAlign = "left";
      ctx.font = "bold 18px monospace";
      for (let i = 0; i < rows.length; i++) {
        const r = rows[i];
        ctx.globalAlpha = r.alpha;
        ctx.fillStyle = r.color;
        ctx.fillText(r.text, bx + padX, by + padY + rowH / 2 + i * rowH);
      }
      ctx.globalAlpha = 1;
      ctx.font = "15px monospace";
    }

    // --- Air-to-ground laser designation reticle ---
    if (d.a2g && !d.a2g.behind) {
      const g = d.a2g;
      ctx.strokeStyle = "#ff8c1a"; ctx.fillStyle = "#ff8c1a"; ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.arc(g.x, g.y, 14, 0, Math.PI * 2); ctx.stroke();
      ctx.beginPath();
      ctx.moveTo(g.x - 20, g.y); ctx.lineTo(g.x - 8, g.y);
      ctx.moveTo(g.x + 8, g.y); ctx.lineTo(g.x + 20, g.y);
      ctx.moveTo(g.x, g.y - 20); ctx.lineTo(g.x, g.y - 8);
      ctx.moveTo(g.x, g.y + 8); ctx.lineTo(g.x, g.y + 20);
      ctx.stroke();
      ctx.textAlign = "left"; ctx.font = "12px monospace";
      ctx.fillText(`A/G ${Math.round(g.dist)}`, g.x + 18, g.y - 14);
      ctx.font = "15px monospace";
    }

    // --- Sensor radar (bottom-right) ---
    const rR = Math.min(96, Math.min(W, H) * 0.14);
    const rcx = W - rR - 30, rcy = H - rR - 30;
    drawRadar(ctx, rcx, rcy, rR, d.blips, this.time);
    ctx.fillStyle = GREEN;
    ctx.font = "12px monospace";
    ctx.textAlign = "center";
    ctx.fillText("SENSORS", rcx, rcy - rR - 8);
    ctx.font = "15px monospace";

    // --- Centre message ---
    if (d.message) {
      ctx.textAlign = "center";
      ctx.fillStyle = d.message.includes("OVER") || d.message.includes("HIT") || d.message.includes("GAME") ? RED : AMBER;
      ctx.font = "bold 24px monospace";
      ctx.fillText(d.message, cx, cy - 120);
      ctx.font = "15px monospace";
    }
  }

  private bar(x: number, y: number, label: string, frac: number, color: string): void {
    const ctx = this.ctx;
    const w = 180, h = 14;
    ctx.textAlign = "left";
    ctx.fillStyle = "#cfe3ee";
    ctx.font = "13px monospace";
    ctx.fillText(label, x, y - 9);
    ctx.strokeStyle = "#2a3742";
    ctx.strokeRect(x + 64, y - 16, w, h);
    ctx.fillStyle = color;
    ctx.fillRect(x + 64, y - 16, w * Math.max(0, Math.min(1, frac)), h);
    ctx.font = "15px monospace";
  }
}
