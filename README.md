# Snake Party

Real-time multiplayer Snake for private friend lobbies (2–5 players). One person
creates a room, shares a 5-character code, everyone piles in. Grow by eating,
die on any collision, last snake standing wins.

```
/snake-game
  /server      Node.js authoritative game server (socket.io, 20Hz fixed tick)
    /db        schema.sql — players, matches, daily room credits
  /app         React Native (Expo) client — Skia canvas, client-side prediction
  /docs        setup notes (Google Sign-In, CI/CD)
```

---

## Architecture in one page

**The server is the only thing that knows where snakes are.** Clients send one
kind of message during a round — `set_direction` — and the server decides
everything else: movement, wall/self/other-snake collisions, food, scoring,
who won. A modified client that reports its own position, sets its own score,
or emits its own `game_over` is simply ignored (see `npm run test:cheat`).

**Rooms are in-memory and isolated.** Each room is one `GameRoom` instance with
its own `setInterval` loop at 50ms. Nothing touches the database during a round.
A room is destroyed the moment its last player leaves.

**The database is off the hot path entirely.** Postgres runs beside the game
server and is consulted three times: once in the socket handshake to check a
token, once when a room is created to spend a daily credit, and once at
`game_over` to write the result. If the database is down or unconfigured the
game still plays perfectly — you just don't get a saved match history, and
credits stop being enforced.

**Identity is ours.** There is no auth provider. `POST /auth/guest` mints a JWT
against the install's `clientId`; `POST /auth/google` verifies a Google ID token
with Google's keys and hands back the same kind of JWT. Signing in with Google
on a device that was already playing as a guest upgrades that player row in
place, so history and the day's spent credits follow you into the account
instead of resetting.

**Two free rooms a day.** Hosting a room costs a credit; joining one is always
free. That split is the point — a player out of credits can still play all
evening if a friend hosts, so nobody is locked out of the multiplayer
experience. The counter resets at midnight IST, and the reset is a date
comparison inside the same UPDATE that spends the credit, so two taps racing
each other cannot buy a third room.

**The client predicts, the server corrects.** At 20Hz a snake steps once every
50ms; waiting a network round trip to see your own turn would feel awful. So the
client re-simulates its own snake locally the instant you swipe, then reconciles
against every server tick. If the prediction was right, nothing happens. If it
was off by a cell or two, the error is absorbed into an offset that decays over
~120ms so the correction glides in. Only a large divergence hard-snaps.

### The wire protocol

`game_start` and the periodic `state_snapshot` carry the full board. Everything
in between is a delta — roughly 100 bytes per tick for two players:

```jsonc
{ "t": 412, "p": [ { "i": 0, "h": [17, 22], "d": 1, "g": 0, "s": 40, "a": 1 } ] }
//   tick      players   index  head      dir  grew  score  alive
```

`g: 1` means "the tail did not pop this tick", which is all the client needs to
rebuild the body from the previous one. Players missing from `p` are dead and
off the board. A full snapshot goes out every 40 ticks (2s) as a desync safety
net and to catch up anyone who reconnected.

---

## Running it locally

### 1. Server

```bash
cd server
npm install
cp .env.example .env      # optional — it runs fine without a database
npm run dev               # http://localhost:3001
```

`GET /health` returns `{"ok":true,...}` and is what Fly/Railway probe.

### 2. App

```bash
cd app
npm install
cp .env.example .env
npx expo start
```

Point `EXPO_PUBLIC_SERVER_URL` at the server:

| Running on | Value |
|---|---|
| iOS simulator | `http://localhost:3001` |
| Android emulator | `http://10.0.2.2:3001` |
| Physical device, same Wi-Fi | `http://<your-lan-ip>:3001` |
| Deployed | `https://your-app.fly.dev` |

Restart `expo start` after editing `.env` — `EXPO_PUBLIC_*` vars are inlined at
bundle time.

> Plain `http://` on Android needs cleartext traffic, which `app.json` already
> enables via `expo-build-properties`. Requires a dev build (`npx expo run:android`),
> not Expo Go.

### 3. Postgres (optional)

Without it the game runs and credits are unlimited. With it you get match
history and the daily room limit.

```bash
docker run -d --name snake-pg -p 5432:5432 \
  -e POSTGRES_USER=snake -e POSTGRES_PASSWORD=password -e POSTGRES_DB=snake \
  postgres:16-alpine
```

Then in `server/.env`:

```
DATABASE_URL=postgres://snake:password@localhost:5432/snake
AUTH_JWT_SECRET=$(openssl rand -hex 32)
```

`db/schema.sql` is applied automatically on boot — every statement is
create-if-not-exists, so a restart is a no-op and there is no migration step.

### 4. Google Sign-In (optional)

Guests are keyed on the install id; a Google account is what survives a
reinstall and keeps match history attached to the same player. The client IDs,
fingerprints and dashboard settings are in
[docs/google-sign-in.md](docs/google-sign-in.md). Unset, the button is hidden and
nothing else changes.

There is no row-level security, because there is no longer anything to protect
against: Postgres has no published port, the app cannot reach it, and every read
goes through an endpoint that scopes by the caller's JWT. The policy layer
Supabase needed existed to guard a direct-from-client connection that no longer
exists.

---

## Tests

```bash
npm test          # 62 server tests + 73 client tests
npm run test:e2e  # real socket clients: two-player, reconnect, then cheating
npm run typecheck # tsc --noEmit over the whole app
```

- **`server/test/gameRoom.test.js`** — collision resolution (wall, self, other
  snake, head-to-head, tail-chasing), food/growth, turn validation, rate
  limiting, win conditions, delta size, room lifecycle, reconnect seats.
- **`server/test/twoClients.js`** — boots the real server, connects two real
  socket clients, and asserts each one receives the other's snake moving.
- **`server/test/reconnect.js`** — drops a player mid-round and asserts the seat
  is held, the snake stays on autopilot, `rejoin_room` restores the same slot
  with a catch-up snapshot, and the seat is released once the grace window ends.
- **`server/test/cheatClient.js`** — 14 cheat attempts against the live server,
  each followed by an inspection of the authoritative state.
- **`server/test/credits.test.js`** — daily credits, identity linking and match
  recording against a real Postgres. PGlite is Postgres compiled to wasm, so
  `db/schema.sql` and every query run exactly as they will in production rather
  than against a mock.
- **`app/src/game/prediction.test.ts`** — prediction, reconciliation, the
  smooth-correct-vs-snap threshold, and frame interpolation, on a fake clock.

---

## Deploying the server

The one hard requirement: **it must be a long-running process, not serverless.**
Websockets need a connection that stays open, and rooms live in RAM.

### Fly.io

```bash
cd server
fly launch --no-deploy --copy-config
fly secrets set DATABASE_URL=... AUTH_JWT_SECRET=... GOOGLE_WEB_CLIENT_ID=...
fly deploy
```

Fly has no database in `fly.toml`; you would need a Postgres app alongside it.
The primary deployment is the OCI box — see `server/deploy/`, where
`docker compose` runs Caddy, the server and Postgres together, and
`deploy/backup.sh` is installed as a nightly `pg_dump` cron. That backup is the
entire disaster-recovery story now that Supabase's point-in-time recovery is
gone; test a restore before you rely on it.

`fly.toml` sets `auto_stop_machines = 'off'` and `min_machines_running = 1`.
Don't change those — a machine that scales to zero drops every open socket, and
a second machine would strand players in a different copy of the same room code.

### Railway

`railway.json` builds the Dockerfile with `numReplicas: 1` and a `/health`
probe. Set the same two env vars in the dashboard.

Then point the app at it and rebuild:

```bash
EXPO_PUBLIC_SERVER_URL=https://your-app.fly.dev npx expo start
```

---

## Gameplay reference

| | |
|---|---|
| Grid | 40 × 40 |
| Tick | 50ms (20Hz), one cell per tick |
| Players | 1–5 (1 is solo practice) |
| Start length | 3 |
| Food on board | 5, +10 points and +2 segments each |
| Round ends | one snake left (or all dead, or 5 minutes) |
| Disconnect grace | 15s — your snake stays on autopilot until you reconnect |

All of it is in `server/src/config.js`, and the client is told the grid size and
tick rate in `game_start` rather than hardcoding a copy.

---

## Known limits (deliberate MVP scope)

- Single server instance; no cross-instance room routing.
- No mid-match joining — you can rejoin your own seat, but not take a new one.
- JSON over socket.io, not a binary protocol. ~100 bytes/tick is nowhere near
  needing one at this player count.
- No public matchmaking, ranked play, cosmetics, or spectator mode.
- The game server and its database share one box, so losing the box loses both.
  Under Supabase a dead database still left the game playable.
- Daily credits are per *player row*, and a guest row is keyed on the install
  id — so uninstalling and reinstalling hands out a fresh two rooms. Signing in
  with Google closes that door for anyone who does, but guests can still farm
  it. Tightening it means device attestation, which is a much bigger hammer than
  a free-tier limit warrants.
