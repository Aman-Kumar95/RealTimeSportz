import { WebSocket, WebSocketServer } from "ws";
import { isLocalRequest, wsArcjet } from "../arcjet.js";

const matchSubscribers= new Map();

function subscribe(matchId,socket){
  const id = Number(matchId);
  if(!matchSubscribers.has(id)){
    matchSubscribers.set(id,new Set());
  }
  matchSubscribers.get(id).add(socket);
}

function unsubscribe(matchId,socket){
  const id = Number(matchId);
  const subscribers= matchSubscribers.get(id);

  if(!subscribers)return;

  subscribers.delete(socket);

  if(subscribers.size==0){
    matchSubscribers.delete(id);
  }
}

function cleanupSubscription(socket){
  for(const matchId of socket.subscriptions){
    unsubscribe(matchId,socket);
  }
}

function broadcastToMatch(matchId,payload){
  const id = Number(matchId);
  const subscribers= matchSubscribers.get(id);

  if(!subscribers|| subscribers.size===0)return;

  const message= JSON.stringify(payload);

  for(const client of subscribers){
    if(client.readyState===WebSocket.OPEN){
      client.send(message);
    }
  }
}

function handleMessage(socket,data){
  let message;

  try {
    message= JSON.parse(data.toString());
  } catch  {
    sendJson(socket,{type:'error',message:'Invalid JSON'});
    return;
  }

  const matchId = Number(message?.matchId);

  if (message?.type==="subscribe" && Number.isInteger(matchId)) {
    subscribe(matchId,socket);

    socket.subscriptions.add(matchId);
    sendJson(socket,{ type:'subscribed',matchId})
  }

  if (message?.type==="unsubscribe" && Number.isInteger(matchId)) {
    unsubscribe(matchId, socket);
    socket.subscriptions.delete(matchId);

    sendJson(socket,{type:'unsubscribed',matchId});
  }

  // Handle setSubscriptions message from frontend
  if (message?.type === "setSubscriptions" && Array.isArray(message.matchIds)) {
    // Clear existing subscriptions
    for (const matchId of socket.subscriptions) {
      unsubscribe(matchId, socket);
    }
    socket.subscriptions.clear();

    // Add new subscriptions
    for (const matchId of message.matchIds) {
      const id = Number(matchId);
      if (Number.isInteger(id)) {
        subscribe(id, socket);
        socket.subscriptions.add(id);
      }
    }

    sendJson(socket, {
      type: 'subscriptions',
      matchIds: Array.from(socket.subscriptions),
    });
  }
}

function sendJson(socket, payload) {
  if (socket.readyState !== WebSocket.OPEN) return;

  socket.send(JSON.stringify(payload));
}

function broadcast(wss, payload) {
  for (const client of wss.clients) {
    if (client.readyState !== WebSocket.OPEN) continue;

    client.send(JSON.stringify(payload));
  }
}

export function attachWebSocketServer(server) {
  const wss = new WebSocketServer({
    server,
    path: "/ws",
    maxPayload: 1024 * 1024,
    perMessageDeflate: false,
  });

  wss.on("connection", async (socket, req) => {
    console.log(`[WS] Client connected`);
    socket.subscriptions = new Set();

    if (wsArcjet && !isLocalRequest(req)) {
      try {
        const decision = await wsArcjet.protect(req);
        if (decision.isDenied()) {
          const code = decision.reason.isRateLimit() ? 1013 : 1008;
          socket.close(code, decision.reason.isRateLimit() ? "Rate limit exceeded" : "Access denied");
          return;
        }
      } catch (error) {
        console.error(`[WS] Security check failed:`, error.message);
        socket.close(1011, "Server security error");
        return;
      }
    }

    socket.on("message", (data) => {
      try {
        handleMessage(socket, data);
      } catch (e) {
        console.error(`[WS] Error:`, e.message);
      }
    });

    socket.on("close", () => {
      console.log(`[WS] Client disconnected`);
      cleanupSubscription(socket);
    });

    socket.on("error", (error) => {
      console.error(`[WS] Socket error:`, error);
    });
  });

  function broadcastMatchCreated(match) {
    broadcast(wss, { type: 'match_created', data: match });
  }

  function broadcastCommentary(matchId, comment) {
    broadcastToMatch(matchId, { type: 'commentary', data: comment });
  }

  function broadcastScoreUpdate(match) {
    // Broadcast score updates globally to all clients so cards on the dashboard update live
    broadcast(wss, {
      type: 'score_update',
      matchId: match.id,
      data: {
        homeScore: match.homeScore,
        awayScore: match.awayScore,
      },
    });

    if (match.commentary) {
      broadcastToMatch(match.id, { type: 'commentary', data: match.commentary });
    }
  }

  return { broadcastMatchCreated, broadcastCommentary, broadcastScoreUpdate };
}




