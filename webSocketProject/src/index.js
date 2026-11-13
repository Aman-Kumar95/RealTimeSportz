import express from "express";
import { matchRouter } from "./routes/matches.js";
import { commentaryRouter } from "./routes/commentary.js";
import http from "http";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import { attachWebSocketServer } from "./ws/server.js";
import { securityMiddleware } from "./arcjet.js";
import { startLiveSync } from "./services/live-sync.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const distPath = path.resolve(__dirname, "../../sportz-frontend-main/dist");

const PORT = process.env.PORT ?? 8000;
const HOST = process.env.HOST ?? "0.0.0.0";

const app = express();
const server = http.createServer(app);

// CORS middleware
app.use((req, res, next) => {
  const origin = req.headers.origin || "*";
  res.header("Access-Control-Allow-Origin", origin);
  res.header("Access-Control-Allow-Methods", "GET, POST, PUT, DELETE, OPTIONS");
  res.header("Access-Control-Allow-Headers", "Origin, X-Requested-With, Content-Type, Accept, Upgrade, Connection");
  res.header("Access-Control-Allow-Credentials", "true");
  
  if (req.method === "OPTIONS") {
    return res.sendStatus(200);
  }
  next();
});

app.use(express.json());

// Serve production frontend assets if built
if (fs.existsSync(distPath)) {
  app.use(express.static(distPath));
}

app.use(securityMiddleware());

app.use("/matches", matchRouter);
app.use("/matches/:id/commentary", commentaryRouter);

// Fallback to React index.html for non-API routes (Express 5 compatible)
if (fs.existsSync(distPath)) {
  app.use((req, res, next) => {
    if (req.method === "GET" && !req.path.startsWith("/matches") && !req.path.startsWith("/ws")) {
      return res.sendFile(path.join(distPath, "index.html"));
    }
    next();
  });
} else {
  app.get("/", (req, res) => {
    res.send(`Sportz Backend API is running!`);
  });
}

const { broadcastMatchCreated, broadcastCommentary, broadcastScoreUpdate } =
  attachWebSocketServer(server);
app.locals.broadcastMatchCreated = broadcastMatchCreated;
app.locals.broadcastCommentary= broadcastCommentary;

startLiveSync({
  onCreated: broadcastMatchCreated,
  onScoreUpdated: broadcastScoreUpdate,
});

server.listen(PORT, HOST, () => {
  const baseUrl =
    HOST === "0.0.0.0" ?`http://localhost:${PORT}` : `http://localhost:${HOST}:${PORT}`;

 console.log(`Server is running on ${baseUrl}`);
 console.log(`Websocket server is running on ${baseUrl.replace('http','ws')}/ws`);
 
 

});
