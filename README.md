# Ludo Royale 🎲

Real-time multiplayer Ludo built with plain **HTML, CSS and JavaScript** on the client and **Node.js + WebSockets** on the server. Three modes (Classic, Team, Quick), all following the original Ludo rules, with animated dice, tokens and captures. Works on phones and desktops.

## Quick start

```bash
npm install
npm start          # http://localhost:3000
npm test           # rules test suite
npm run dev        # auto-restart on server changes
```

Open the page, enter a name and either **Create room** (share the code or invite link), **Join** a friend's room, or **Play vs bots**. Hosts can fill empty seats with bots from the lobby.

## Rules (original Ludo)

| Rule | Behaviour |
| --- | --- |
| Leaving the yard | Only on a **6**, onto your own start square |
| Route | Clockwise once around the 52-square track, then up your 5-square home column into home (56 steps) |
| Reaching home | Needs the **exact** roll. Overshooting isn't allowed |
| Rolling a 6 | Grants another roll. **Three 6s in a row** forfeit the turn (the third 6 isn't played) |
| Capturing | Landing on a single opponent token sends it back to its yard and grants another roll |
| Home bonus | Bringing a token home grants another roll |
| Safe squares | The 4 start squares and 4 ★ star squares. No captures there |
| Blockade (optional) | Host toggle in the lobby, off by default. When on, 2+ tokens of one colour block opponents from passing or landing (traditional Parcheesi-style rule). When off, pairs can be passed and captured |
| Fair play | Server-side `crypto.randomInt` dice, the same for humans and bots. The first player is random |
| No legal move | The turn passes (a 6 still earns its re-roll) |

### Modes

- **Classic**: 2–4 players. Play continues until every place is decided.
- **Team**: 4 players, Red & Yellow vs Green & Blue (partners sit opposite each other). Partners never capture or block each other. A player who has finished uses their rolls to move their partner's tokens. The first team with all 8 tokens home wins.
- **Quick**: 2–4 players. Each player starts with one token already on the board. The first to bring 2 tokens home wins. Turns last 15s instead of 30s.

Rules live in [`shared/modes.js`](shared/modes.js) (`BASE_RULES` plus each mode's config), so you can add a variant without touching the engine.

## Project structure

```
shared/                 Imported by both server and browser (plain ES modules)
  constants.js          Colours, position encoding, protocol message & event names, timing
  board.js              15x15 board geometry: track, home columns, safe squares, coordinates
  modes.js              Rule set and mode configs (Classic / Team / Quick)

server/
  index.js              HTTP static server + WebSocket endpoint (/ws) + heartbeat
  config.js             Ports, timers, limits
  game/GameEngine.js    Pure rules engine: no I/O, no timers, returns events
  game/BotPlayer.js     Heuristic AI for bots, disconnected players and timeouts
  rooms/Room.js         Seats, host controls, turn timers, bot pacing, broadcasting
  rooms/RoomManager.js  Sessions (reconnect-safe), room lifecycle, message routing
  utils/ids.js          IDs, room codes, name sanitising

public/
  index.html            Screens: home, lobby, game, plus modals
  css/                  base, home, lobby, game, board, dice, animations
  js/main.js            App bootstrap and screen routing
  js/core/              Socket (auto-reconnect), Emitter, storage, DOM helpers, Sound (Web Audio)
  js/ui/                HomeView, LobbyView, Toast, Confetti
  js/game/              GameView (event queue and animations), BoardRenderer (SVG),
                        TokenLayer, Dice (3D CSS), PlayerPanels, Effects

tests/engine.test.js    Rules tests (node:test)
```

### How it works

- The **server is authoritative**. Clients send only intents (`roll`, `move {tokenIndex}`). The engine validates them and returns a list of **events** (`roll`, `move` with the full path and captures, `extra-turn`, `finish`, `turn`, `game-over`, …).
- Each broadcast contains `{ events, state }`. The client **queues** messages, animates each event in order (dice tumble, square-by-square hops, capture fly-back, bursts), then snaps to the authoritative `state`, so the board can never drift out of sync.
- The server paces bots using the same timing constants (`shared/constants.js → TIMING`) the client animates with, so bot moves don't overlap the animations.
- **Sessions** survive refreshes and network drops: the client stores its session id and resumes its seat on reconnect. Disconnected players are auto-played after a short delay. Leaving mid-game hands your colour to a bot.
- Turn timers: when time runs out, the bot logic rolls or moves for you. Forced moves (only one distinct option) play automatically.
- The board rotates so **your colour is always bottom-left**.

## Controls

- Tap the glowing dice (or press **Space**/**Enter**) to roll.
- Tap a pulsing token (or press **1–4**) to move it.
- Emote bar sends quick reactions; 🔊 toggles sound; **?** shows the rules.

## Deploying

**GitHub Pages can't host this.** Pages serves static files only, and the game needs the Node.js WebSocket server. Push the repo to GitHub, then connect it to a Node host that supports WebSockets:

- **Render** (free tier): New → Web Service → pick the repo. Build `npm install`, start `npm start`.
- **Railway** or **Fly.io**: same commands. They detect Node automatically.

The server reads `PORT` from the environment, and the client switches to `wss://` automatically on HTTPS. Rooms live in memory, so run a single instance (or add a shared store with sticky sessions to scale).
