/**
 * On-screen touch controls for mobile / tablets: a virtual flight joystick
 * (pitch + roll), a throttle lever, yaw paddles, a fire trigger and a sublight
 * boost, plus tap buttons and toggle switches for every action. Built as a DOM
 * overlay over the canvas; only shown on touch devices. Feeds the InputManager
 * (analog -> input.touch.*, discrete -> the input.on* callbacks).
 */

import type { InputManager } from "./input.ts";

export function isTouchDevice(): boolean {
  return (typeof window !== "undefined") &&
    (("ontouchstart" in window) || (navigator.maxTouchPoints ?? 0) > 0);
}

function el(tag: string, style: Partial<CSSStyleDeclaration>, text?: string): HTMLElement {
  const e = document.createElement(tag);
  Object.assign(e.style, style);
  if (text) e.textContent = text;
  return e;
}

const BTN_BASE: Partial<CSSStyleDeclaration> = {
  position: "absolute", display: "flex", alignItems: "center", justifyContent: "center",
  fontFamily: "monospace", fontWeight: "bold", fontSize: "13px", color: "#ffe27a",
  background: "rgba(20,28,36,0.55)", border: "2px solid #ffb627", borderRadius: "10px",
  userSelect: "none", touchAction: "none", textAlign: "center", lineHeight: "1.1",
};

export function setupMobileControls(input: InputManager): void {
  if (!isTouchDevice()) return;
  input.touch.active = true;
  // The desktop key-list overlay just clutters a phone screen.
  const help = document.getElementById("help");
  if (help) help.style.display = "none";

  const root = el("div", {
    position: "absolute", inset: "0", pointerEvents: "none", zIndex: "20",
    touchAction: "none",
  });
  document.body.appendChild(root);

  // ---- Virtual joystick (bottom-left): pitch + roll ----
  const R = 70; // base radius (px)
  const base = el("div", {
    position: "absolute", left: "24px", bottom: "24px",
    width: `${R * 2}px`, height: `${R * 2}px`, borderRadius: "50%",
    background: "rgba(20,28,36,0.45)", border: "2px solid #46d8ff",
    pointerEvents: "auto", touchAction: "none",
  });
  const knob = el("div", {
    position: "absolute", left: "50%", top: "50%", width: "62px", height: "62px",
    marginLeft: "-31px", marginTop: "-31px", borderRadius: "50%",
    background: "rgba(70,216,255,0.5)", border: "2px solid #cfeefe",
  });
  base.appendChild(knob);
  root.appendChild(base);

  let stickId = -1;
  const stickMove = (cx: number, cy: number) => {
    const r = base.getBoundingClientRect();
    let dx = cx - (r.left + R), dy = cy - (r.top + R);
    const len = Math.hypot(dx, dy);
    if (len > R) { dx = dx / len * R; dy = dy / len * R; }
    knob.style.transform = `translate(${dx}px, ${dy}px)`;
    input.touch.roll = dx / R;       // right = roll right (like D)
    input.touch.pitch = -dy / R;     // up = pitch (push, like W)
  };
  const stickEnd = () => {
    stickId = -1; knob.style.transform = "translate(0,0)";
    input.touch.roll = 0; input.touch.pitch = 0;
  };
  base.addEventListener("pointerdown", (e) => { stickId = e.pointerId; base.setPointerCapture(e.pointerId); stickMove(e.clientX, e.clientY); e.preventDefault(); });
  base.addEventListener("pointermove", (e) => { if (e.pointerId === stickId) { stickMove(e.clientX, e.clientY); e.preventDefault(); } });
  base.addEventListener("pointerup", (e) => { if (e.pointerId === stickId) stickEnd(); });
  base.addEventListener("pointercancel", () => stickEnd());

  // ---- Throttle lever (bottom-right, vertical slider) ----
  const tH = 200;
  const tTrack = el("div", {
    position: "absolute", right: "30px", bottom: "30px", width: "54px", height: `${tH}px`,
    background: "rgba(20,28,36,0.45)", border: "2px solid #ffb627", borderRadius: "27px",
    pointerEvents: "auto", touchAction: "none",
  });
  const tKnob = el("div", {
    position: "absolute", left: "3px", width: "44px", height: "44px", borderRadius: "50%",
    background: "rgba(255,182,39,0.6)", border: "2px solid #ffe27a", bottom: "0px",
  }, );
  const tLabel = el("div", { position: "absolute", right: "30px", bottom: `${30 + tH + 6}px`, width: "54px", textAlign: "center", fontFamily: "monospace", fontSize: "11px", color: "#ffb627" }, "THR");
  tTrack.appendChild(tKnob);
  root.appendChild(tTrack); root.appendChild(tLabel);
  const setThrottle = (cy: number) => {
    const r = tTrack.getBoundingClientRect();
    let f = 1 - (cy - r.top) / r.height;
    f = Math.max(0, Math.min(1, f));
    input.touch.throttle = f;
    tKnob.style.bottom = `${f * (tH - 44)}px`;
  };
  let tId = -1;
  tTrack.addEventListener("pointerdown", (e) => { tId = e.pointerId; tTrack.setPointerCapture(e.pointerId); setThrottle(e.clientY); e.preventDefault(); });
  tTrack.addEventListener("pointermove", (e) => { if (e.pointerId === tId) { setThrottle(e.clientY); e.preventDefault(); } });
  tTrack.addEventListener("pointerup", (e) => { if (e.pointerId === tId) tId = -1; });
  input.touch.throttle = 0.55; tKnob.style.bottom = `${0.55 * (tH - 44)}px`;

  // ---- A momentary "hold" button helper ----
  const holdBtn = (label: string, css: Partial<CSSStyleDeclaration>, onDown: () => void, onUp: () => void, color = "#ffb627") => {
    const b = el("div", { ...BTN_BASE, ...css, pointerEvents: "auto", borderColor: color, color }, label);
    const down = (e: Event) => { b.style.background = "rgba(255,182,39,0.35)"; onDown(); e.preventDefault(); };
    const up = () => { b.style.background = "rgba(20,28,36,0.55)"; onUp(); };
    b.addEventListener("pointerdown", down);
    b.addEventListener("pointerup", up);
    b.addEventListener("pointercancel", up);
    b.addEventListener("pointerleave", up);
    root.appendChild(b);
    return b;
  };
  // ---- A tap (momentary action) button ----
  const tapBtn = (label: string, css: Partial<CSSStyleDeclaration>, action: () => void, color = "#ffe27a") => {
    const b = el("div", { ...BTN_BASE, ...css, pointerEvents: "auto", borderColor: color, color }, label);
    b.addEventListener("pointerdown", (e) => { b.style.background = "rgba(255,182,39,0.35)"; action(); e.preventDefault(); });
    b.addEventListener("pointerup", () => { b.style.background = "rgba(20,28,36,0.55)"; });
    root.appendChild(b);
    return b;
  };

  // FIRE (big red, hold) — bottom-right above the throttle's left.
  holdBtn("FIRE", { right: "100px", bottom: "40px", width: "92px", height: "92px", borderRadius: "50%", fontSize: "18px", color: "#ff5544", borderColor: "#ff5544" },
    () => { input.touch.gun = true; }, () => { input.touch.gun = false; }, "#ff5544");
  // BOOST (hold) — sublight accelerator.
  holdBtn("BOOST", { right: "210px", bottom: "60px", width: "78px", height: "60px" },
    () => { input.touch.boost = true; }, () => { input.touch.boost = false; }, "#46d8ff");
  // Yaw paddles (hold), flanking the joystick.
  holdBtn("◄ YAW", { left: "180px", bottom: "30px", width: "66px", height: "52px" },
    () => { input.touch.yaw = -1; }, () => { input.touch.yaw = 0; });
  holdBtn("YAW ►", { left: "180px", bottom: "92px", width: "66px", height: "52px" },
    () => { input.touch.yaw = 1; }, () => { input.touch.yaw = 0; });

  // Tap actions — right column.
  tapBtn("LOCK\nTGT", { right: "20px", bottom: "250px", width: "70px", height: "56px" }, () => input.onTarget?.());
  tapBtn("BOMB", { right: "20px", bottom: "314px", width: "70px", height: "56px" }, () => input.onBomb?.());
  tapBtn("VIEW", { right: "20px", bottom: "378px", width: "70px", height: "56px" }, () => input.onView?.());

  // Toggle switches — top-right column (visual on/off state).
  const toggles: { label: string; fn: () => void; getOn?: () => boolean }[] = [
    { label: "S-FOIL", fn: () => input.onSFoils?.() },
    { label: "ASSIST", fn: () => input.onFlightAssist?.() },
    { label: "GEAR", fn: () => input.onGear?.() },
    { label: "VTOL", fn: () => input.onVtol?.() },
    { label: "AUTO", fn: () => input.onAutoLock?.() },
  ];
  toggles.forEach((t, i) => {
    const b = el("div", { ...BTN_BASE, pointerEvents: "auto", right: "20px", top: `${70 + i * 54}px`, width: "78px", height: "44px", borderColor: "#5dff7a", color: "#5dff7a" }, t.label);
    b.addEventListener("pointerdown", (e) => { b.style.background = "rgba(93,255,122,0.3)"; t.fn(); e.preventDefault(); });
    b.addEventListener("pointerup", () => { b.style.background = "rgba(20,28,36,0.55)"; });
    root.appendChild(b);
  });
}
