/**
 * Online multiplayer server for the X-wing game.
 *
 * Serves the static client from web/ AND runs a WebSocket relay on the same
 * port. The relay is a lightweight authority-free hub: it assigns each client an
 * id, broadcasts player state snapshots and fire events to everyone else, and
 * notifies peers when someone leaves. Game simulation stays on the clients
 * (each renders the others from the snapshots); this is a real shared-space
 * dogfight, not a single-player demo.
 *
 *   node server.js            # serves http://localhost:8092 + ws on same port
 *   PORT=9000 node server.js  # custom port
 */

import http from "node:http";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { WebSocketServer } from "ws";

const PORT = Number(process.env.PORT) || 8092;
const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), "web");

const TYPES = {
  ".html": "text/html", ".js": "text/javascript", ".css": "text/css",
  ".json": "application/json", ".png": "image/png", ".svg": "image/svg+xml",
  ".mp3": "audio/mpeg", ".wav": "audio/wav", ".ogg": "audio/ogg",
};

const server = http.createServer((req, res) => {
  let urlPath = decodeURIComponent((req.url || "/").split("?")[0]);
  if (urlPath === "/") urlPath = "/index.html";
  const filePath = path.join(ROOT, path.normalize(urlPath));
  if (!filePath.startsWith(ROOT)) { res.writeHead(403).end(); return; }
  fs.readFile(filePath, (err, data) => {
    if (err) { res.writeHead(404).end("Not found"); return; }
    res.writeHead(200, { "Content-Type": TYPES[path.extname(filePath)] || "application/octet-stream" });
    res.end(data);
  });
});

const wss = new WebSocketServer({ server });
let nextId = 1;
const clients = new Map(); // id -> ws

wss.on("connection", (ws) => {
  const id = nextId++;
  clients.set(id, ws);
  ws.send(JSON.stringify({ t: "welcome", id }));
  console.log(`player ${id} joined (${clients.size} online)`);

  ws.on("message", (raw) => {
    let msg;
    try { msg = JSON.parse(raw.toString()); } catch { return; }
    msg.id = id; // stamp sender
    const out = JSON.stringify(msg);
    for (const [cid, c] of clients) {
      if (cid !== id && c.readyState === c.OPEN) c.send(out);
    }
  });

  ws.on("close", () => {
    clients.delete(id);
    const out = JSON.stringify({ t: "leave", id });
    for (const c of clients.values()) if (c.readyState === c.OPEN) c.send(out);
    console.log(`player ${id} left (${clients.size} online)`);
  });
});

server.listen(PORT, () => {
  console.log(`X-wing server on http://localhost:${PORT}  (WebSocket on same port)`);
});
