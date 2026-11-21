const { WebSocketServer } = require("ws");
const port = process.env.PORT || 3000;
const wss = new WebSocketServer({ port });
const rooms = new Map();

function makeCode() {
  const chars = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
  let code = "";
  do {
    code = Array.from({ length: 6 }, () => chars[Math.floor(Math.random() * chars.length)]).join("");
  } while (rooms.has(code));
  return code;
}

wss.on("connection", (ws) => {
  ws.room = null;
  ws.role = null;
  ws.pid = 0;
  
  ws.on("message", (raw) => {
    const msg = raw.toString();
    if (msg === "HOST") {
      const code = makeCode();
      rooms.set(code, { host: ws, guests: new Map() });
      ws.room = code; ws.role = "host"; ws.pid = 1;
      ws.send(`CREATED|${code}`);
    } else if (msg.startsWith("JOIN|")) {
      const code = msg.split("|")[1]?.trim().toUpperCase();
      const rm = rooms.get(code);
      if (!rm || rm.guests.size >= 3) { ws.send("ERR|Room not found or full"); return; }
      let pid = 2;
      while (rm.guests.has(pid)) pid++;
      rm.guests.set(pid, ws);
      ws.room = code; ws.role = "guest"; ws.pid = pid;
      ws.send(`WELCOME|${pid}|${code}`);
      if (rm.host.readyState === 1) rm.host.send(`JOINED|${pid}`);
    } else if (ws.role === "host" && ws.room) {
      const rm = rooms.get(ws.room);
      if (!rm) return;
      if (msg.startsWith("TO|")) {
        const [, targetId, ...rest] = msg.split("|");
        const g = rm.guests.get(Number(targetId));
        if (g && g.readyState === 1) g.send(rest.join("|")); 
      } else if (msg.startsWith("BCAST|")) {
        const payload = msg.slice(6);
        for (const g of rm.guests.values()) if (g.readyState === 1) g.send(payload);
      }
    } else if (ws.role === "guest" && ws.room) {
      const rm = rooms.get(ws.room);
      if (rm && rm.host.readyState === 1) rm.host.send(`FROM|${ws.pid}|${msg}`);
    }
  });
  
  ws.on("close", () => {
    if (!ws.room) return;
    const rm = rooms.get(ws.room);
    if (!rm) return;
    if (ws.role === "host") {
      for (const g of rm.guests.values()) { try { g.send("CLOSED"); g.close(); } catch {} }
      rooms.delete(ws.room);
    } else if (ws.role === "guest") {
      rm.guests.delete(ws.pid);
      if (rm.host.readyState === 1) rm.host.send(`LEFT|${ws.pid}`);
    }
  });
});
