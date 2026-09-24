// Minimal fixture server used ONLY by CI to prove the memory-leak checker
// (scripts/memory-leak-check.js) correctly flags unbounded heap growth.
// This is not part of the production backend.
const http = require("node:http");

const port = Number(process.env.PORT) || 3002;
const leakedBuffers = [];

const server = http.createServer((req, res) => {
  if (req.url === "/api/health") {
    leakedBuffers.push(Buffer.alloc(1024 * 200)); // deliberate 200 KB/request leak
    res.writeHead(200, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ status: "ok", leaked: leakedBuffers.length }));
    return;
  }
  res.writeHead(200);
  res.end("ok");
});

server.listen(port, () => {
  console.log(`Leaky fixture server listening on ${port}`);
});