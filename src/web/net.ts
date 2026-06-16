/**
 * Client networking for online multiplayer. Connects to the relay server, sends
 * our ship snapshot at a fixed rate, and surfaces other players' snapshots, fire
 * events, and disconnects via callbacks. JSON over WebSocket; best-effort (no
 * reliability layer needed for a fast-moving dogfight).
 */

export interface ShipSnapshot {
  p: [number, number, number]; // position
  q: [number, number, number, number]; // quaternion
  v: [number, number, number]; // velocity
  s: number; // s-foils open 0/1
  b: number; // boost 0/1
  t: number; // throttle 0..1
}

export interface FireEvent {
  o: [number, number, number]; // origin
  d: [number, number, number]; // direction
  v: [number, number, number]; // inherited velocity
}

export class Net {
  private ws: WebSocket | null = null;
  id = 0;
  connected = false;

  onWelcome: ((id: number) => void) | null = null;
  onState: ((id: number, s: ShipSnapshot) => void) | null = null;
  onFire: ((id: number, f: FireEvent) => void) | null = null;
  onLeave: ((id: number) => void) | null = null;
  onCount: ((n: number) => void) | null = null;

  connect(url: string): void {
    try {
      this.ws = new WebSocket(url);
    } catch {
      return;
    }
    this.ws.onopen = () => { this.connected = true; };
    this.ws.onclose = () => { this.connected = false; };
    this.ws.onerror = () => { this.connected = false; };
    this.ws.onmessage = (ev) => {
      let m: any;
      try { m = JSON.parse(ev.data); } catch { return; }
      // Server messages use `t` (welcome/leave); relayed client messages use `mt`
      // with the payload nested (so it can't collide with snapshot fields).
      switch (m.t ?? m.mt) {
        case "welcome": this.id = m.id; this.onWelcome?.(m.id); break;
        case "s": this.onState?.(m.id, m.s as ShipSnapshot); break;
        case "f": this.onFire?.(m.id, m.f as FireEvent); break;
        case "leave": this.onLeave?.(m.id); break;
      }
    };
  }

  private send(obj: object): void {
    if (this.connected && this.ws) this.ws.send(JSON.stringify(obj));
  }

  sendState(s: ShipSnapshot): void { this.send({ mt: "s", s }); }
  sendFire(f: FireEvent): void { this.send({ mt: "f", f }); }
}
