# RealTimeSportz 🏏

Real-time international cricket match tracking web application with live ball-by-ball commentary and score updates powered by WebSocket and Express, with a React + TypeScript + Tailwind frontend.

---

## ⚡ Features

- **🔴 Real-Time International Matches**: Live score updates & ball-by-ball commentary streamed over WebSocket.
- **🏏 Official Cricket API Integration**: Synced with SportMonks Cricket API for real Twenty20 International series.
- **⚡ Dual Mode**: 
  - Real-time live match engine streaming live deliveries every 3.5 seconds.
  - Active background polling for official in-play matches.
- **🌐 Single-Service Production Deployment**: Express server hosts the React SPA, REST APIs (`/matches`), and WebSocket (`/ws`) from a single domain.

---

## 🚀 Quick Start (Local Development)

```bash
# Install dependencies across both projects
npm run install:all

# Start both frontend & backend concurrently
npm run dev
```

- **Frontend**: `http://localhost:3000`
- **Backend & WebSocket**: `http://localhost:8000` (`ws://localhost:8000/ws`)

---

## ☁️ Production Deployment (Render.com)

1. Connect this repository on [Render](https://render.com).
2. Set:
   - **Build Command**: `npm run build`
   - **Start Command**: `npm start`
3. Add Environment Variables:
   - `DATABASE_URL`
   - `SPORTMONKS_TOKEN`
   - `SPORTMONKS_URL`
   - `ARCJET_KEY`
   - `ARCJET_ENV`
