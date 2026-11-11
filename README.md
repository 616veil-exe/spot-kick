# Spot Kick: online penalty shootout

Two players, one room code. Node.js + Socket.IO server (authoritative), Three.js client, deterministic ball physics
(gravity, air drag, Magnus curve, post/crossbar/net bounces). Works on phones (portrait and landscape) and desktop.

## Project layout
```
spot-kick/
├─ package.json        dependencies + "npm start"
├─ server.js           rooms, turns, rules, shot resolution
├─ render.yaml         optional one-click Render blueprint
└─ public/
   ├─ index.html, style.css, game.js   client (3D scene, UI, audio)
   └─ shared/physics.js                physics used by BOTH server and client
```

## Run locally (test first)
1. Install Node.js 18+ from nodejs.org
2. In this folder: `npm install` then `npm start`
3. Open http://localhost:3000 in two browser tabs. Create a room in one, join with the code in the other.

## Put it live on Render (free)
**1. Upload to GitHub**
- Create a free account at github.com, click **New repository**, name it `spot-kick`, keep it Public or Private.
- Easiest: on the empty repo page click **uploading an existing file**, drag in everything from this folder
  (`package.json`, `server.js`, `render.yaml`, `README.md`, `.gitignore` and the whole `public` folder; do NOT upload `node_modules`), then **Commit changes**.
- Or with git: `git init && git add . && git commit -m "first" && git branch -M main && git remote add origin <your-repo-url> && git push -u origin main`

**2. Create the Render service**
- Go to render.com and sign up with GitHub.
- Click **New +** then **Web Service** and pick your `spot-kick` repo.
- Fill in:
  - **Language / Runtime:** Node
  - **Build Command:** `npm install`
  - **Start Command:** `npm start`
  - **Instance Type:** Free
  - (Optional) Environment variable `NODE_VERSION` = `20`
- Click **Create Web Service**. Wait 2-4 minutes until the log says `Spot Kick running`.
- Your game is live at `https://<your-service-name>.onrender.com`.
  (Alternatively: **New + > Blueprint** and select the repo; `render.yaml` fills everything in.)

**3. Play with friends**
- Open your Render URL, enter a name, **Create room**, then **Copy invite link** and send it. Your friend opens it and taps **Join room**.

**4. Free-tier notes**
- The free service sleeps after ~15 minutes without traffic; the next visit takes ~30-60 s to wake. Open the link a minute before playing.
- To keep it awake, add a free monitor at uptimerobot.com: HTTP(s) monitor to `https://<your-service>.onrender.com/healthz`, every 5 minutes.
- Rooms live in server memory, so a restart or redeploy clears them (players just create a new room).
- Updating the game: push changes to GitHub and Render redeploys automatically.

## How to play
- Roles alternate each kick. 5 kicks each, early win when the other side can't catch up, then sudden death.
- **Kicker:** drag on the goal to aim (the ring shows your accuracy), set **Power** and **Curve**, press **Shoot**.
  More power means more speed but a wider error ring.
- **Keeper:** pick one of 6 zones and press **Dive**. Both choices stay hidden until the server resolves the kick.
- 15 s per turn; if time runs out a pick is made for you.

## Tuning
- `public/shared/physics.js`: `MAG` (curve strength), `errSigma` (accuracy vs power), `KEEPER_REACH`, `DIVE_TIME`, `ZONES`.
- `server.js`: `PICK_MS` (turn timer), `ANIM_MS` (time between kicks).
- Graphics: the Graphics button toggles high/low; the game auto-drops to low on slow devices.

## Troubleshooting
- Blank page or `Cannot GET /vendor/three/...`: make sure `npm install` ran (Render does this in the build step) and `three` is in `package.json`.
- Can't connect: wait for the free instance to wake, then refresh.
- Fonts missing offline: the UI falls back to system fonts.
