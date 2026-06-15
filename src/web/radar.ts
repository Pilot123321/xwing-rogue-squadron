/**
 * Sensor radar renderer. Draws a top-down scope (forward = up) with range rings,
 * a rotating sweep, the player at centre, and contact blips. Shared by the 2D
 * HUD overlay and the in-cockpit scope texture so they always agree.
 *
 * Blip coords (rx, ry) are normalized to the scope disc: rx = right, ry = up
 * (i.e. straight ahead). elev encodes relative altitude (+ above, - below).
 */

export interface Blip {
  rx: number; // -1..1 (right)
  ry: number; // -1..1 (forward = up)
  elev: number; // world units above(+)/below(-)
  locked: boolean;
}

export function drawRadar(
  ctx: CanvasRenderingContext2D,
  cx: number, cy: number, R: number,
  blips: Blip[], time: number,
): void {
  ctx.save();

  // scope background
  ctx.beginPath();
  ctx.arc(cx, cy, R, 0, Math.PI * 2);
  ctx.fillStyle = "rgba(2, 14, 10, 0.72)";
  ctx.fill();

  // clip everything else to the disc
  ctx.save();
  ctx.beginPath();
  ctx.arc(cx, cy, R, 0, Math.PI * 2);
  ctx.clip();

  ctx.strokeStyle = "rgba(60, 200, 120, 0.35)";
  ctx.lineWidth = 1;
  // range rings
  for (const f of [0.33, 0.66, 1.0]) {
    ctx.beginPath();
    ctx.arc(cx, cy, R * f, 0, Math.PI * 2);
    ctx.stroke();
  }
  // crosshair
  ctx.beginPath();
  ctx.moveTo(cx - R, cy); ctx.lineTo(cx + R, cy);
  ctx.moveTo(cx, cy - R); ctx.lineTo(cx, cy + R);
  ctx.stroke();

  // rotating sweep
  const a = (time * 1.6) % (Math.PI * 2);
  const grad = ctx.createLinearGradient(cx, cy, cx + Math.sin(a) * R, cy - Math.cos(a) * R);
  grad.addColorStop(0, "rgba(80, 255, 150, 0.55)");
  grad.addColorStop(1, "rgba(80, 255, 150, 0)");
  ctx.strokeStyle = grad;
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.moveTo(cx, cy);
  ctx.lineTo(cx + Math.sin(a) * R, cy - Math.cos(a) * R);
  ctx.stroke();

  // contacts
  for (const b of blips) {
    const x = cx + b.rx * R;
    const y = cy + b.ry * R;
    const locked = b.locked;
    ctx.fillStyle = locked ? "#ff4533" : "#ffd24a";
    const s = locked ? 4.5 : 3.2;
    ctx.beginPath();
    ctx.arc(x, y, s, 0, Math.PI * 2);
    ctx.fill();
    if (locked) {
      ctx.strokeStyle = "#ff4533";
      ctx.lineWidth = 1.5;
      ctx.strokeRect(x - 6, y - 6, 12, 12);
    }
    // altitude tick: above / below
    if (Math.abs(b.elev) > 120) {
      ctx.strokeStyle = ctx.fillStyle as string;
      ctx.lineWidth = 1;
      const dir = b.elev > 0 ? -1 : 1;
      ctx.beginPath();
      ctx.moveTo(x, y); ctx.lineTo(x, y + dir * 6);
      ctx.stroke();
    }
  }
  ctx.restore(); // unclip

  // rim
  ctx.beginPath();
  ctx.arc(cx, cy, R, 0, Math.PI * 2);
  ctx.strokeStyle = "#3cc878";
  ctx.lineWidth = 2;
  ctx.stroke();

  // player marker (centre, pointing up)
  ctx.fillStyle = "#9effc4";
  ctx.beginPath();
  ctx.moveTo(cx, cy - 6);
  ctx.lineTo(cx - 4, cy + 5);
  ctx.lineTo(cx + 4, cy + 5);
  ctx.closePath();
  ctx.fill();

  ctx.restore();
}
