import { test } from 'node:test';
import assert from 'node:assert/strict';
import { GameEngine, GameError } from '../server/game/GameEngine.js';
import { POS, EVT } from '../shared/constants.js';
import { TRACK, toAbsolute } from '../shared/board.js';

const two = () =>
  new GameEngine({
    mode: 'classic',
    firstTurn: 0,
    options: { blocks: true },
    players: [
      { id: 'r', name: 'R', color: 'red' },
      { id: 'y', name: 'Y', color: 'yellow' },
    ],
  });

const four = (mode = 'classic') =>
  new GameEngine({
    mode,
    firstTurn: 0,
    players: ['red', 'green', 'yellow', 'blue'].map((c) => ({ id: c[0], name: c, color: c })),
  });

const types = (events) => events.map((e) => e.type);

test('board geometry: 52 unique track squares, colours enter home column correctly', () => {
  assert.equal(TRACK.length, 52);
  assert.equal(new Set(TRACK.map(String)).size, 52);
  assert.equal(toAbsolute('green', 50), 11);
  assert.equal(toAbsolute('yellow', 50), 24);
  assert.equal(toAbsolute('blue', 50), 37);
  assert.equal(toAbsolute('red', 50), 50);
});

test('a token leaves the yard only on a 6', () => {
  const g = two();
  const ev = g.roll('r', 4);
  assert.deepEqual(types(ev), [EVT.ROLL, EVT.NO_MOVES, EVT.TURN]);
  assert.equal(g.current.color, 'yellow');

  g.roll('y', 6);
  assert.equal(g.phase, 'move');
  assert.equal(g.legalMoves.length, 4);
  const mv = g.move('y', 0);
  assert.equal(g.playerByColor('yellow').tokens[0], POS.START);
  assert.ok(types(mv).includes(EVT.EXTRA_TURN), 'six grants another roll');
  assert.equal(g.current.color, 'yellow');
});

test('a 6 with no legal move still grants a re-roll', () => {
  const g = two();
  g.playerByColor('red').tokens = [POS.HOME, POS.HOME, POS.HOME, 53];
  const ev = g.roll('r', 6);
  assert.deepEqual(types(ev), [EVT.ROLL, EVT.NO_MOVES, EVT.EXTRA_TURN]);
  assert.equal(g.current.color, 'red');
});

test('three sixes in a row forfeit the turn without moving', () => {
  const g = two();
  g.playerByColor('red').tokens = [10, POS.YARD, POS.YARD, POS.YARD];
  g.roll('r', 6); g.move('r', 0);
  g.roll('r', 6); g.move('r', 0);
  const before = g.playerByColor('red').tokens.slice();
  const ev = g.roll('r', 6);
  assert.deepEqual(types(ev), [EVT.ROLL, EVT.FORFEIT, EVT.TURN]);
  assert.deepEqual(g.playerByColor('red').tokens, before);
  assert.equal(g.current.color, 'yellow');
});

test('exact roll needed to reach home', () => {
  const g = two();
  g.playerByColor('red').tokens = [53, POS.HOME, POS.HOME, POS.HOME];
  const ev = g.roll('r', 4); // 53 + 4 = 57 > 56
  assert.ok(types(ev).includes(EVT.NO_MOVES));
  g.roll('y', 1); // yellow has nothing out
  g.roll('r', 3);
  const mv = g.move('r', 0);
  assert.ok(types(mv).includes(EVT.FINISH));
  assert.ok(types(mv).includes(EVT.GAME_OVER), 'two-player game ends when one finishes');
  assert.deepEqual(g.winners, ['red']);
});

test('landing on a single opponent captures it and grants a re-roll', () => {
  const g = two();
  // Red at rel 30 = abs 30. Yellow rel 4 = abs 30.
  g.playerByColor('red').tokens = [27, POS.YARD, POS.YARD, POS.YARD];
  g.playerByColor('yellow').tokens = [4, POS.YARD, POS.YARD, POS.YARD];
  g.roll('r', 3);
  const ev = g.move('r', 0);
  assert.equal(ev[0].captures.length, 1);
  assert.equal(g.playerByColor('yellow').tokens[0], POS.YARD);
  assert.equal(ev.at(-1).reason, 'capture');
  assert.equal(g.current.color, 'red');
});

test('no capture on safe squares (stars and starts)', () => {
  const g = two();
  // abs 34 is a star square. Yellow rel 8 = abs 34.
  g.playerByColor('red').tokens = [30, POS.YARD, POS.YARD, POS.YARD];
  g.playerByColor('yellow').tokens = [8, POS.YARD, POS.YARD, POS.YARD];
  g.roll('r', 4);
  const ev = g.move('r', 0);
  assert.equal(ev[0].captures.length, 0);
  assert.equal(g.playerByColor('yellow').tokens[0], 8);
});

test('blocks cannot be passed or landed on', () => {
  const g = two();
  // Yellow block at rel 3 = abs 29 (not safe).
  g.playerByColor('yellow').tokens = [3, 3, POS.YARD, POS.YARD];
  g.playerByColor('red').tokens = [27, POS.YARD, POS.YARD, POS.YARD];
  const ev = g.roll('r', 2); // land on block
  assert.ok(types(ev).includes(EVT.NO_MOVES));
  g.roll('y', 1); g.move('y', 0); // yellow moves one token off, breaking the block
  g.roll('r', 5); // abs 32, passes abs 29 single token -> legal now
  assert.equal(g.phase, 'move');
});

test('tokens move into their own home column, never around again', () => {
  const g = two();
  g.playerByColor('red').tokens = [49, POS.YARD, POS.YARD, POS.YARD];
  g.roll('r', 4);
  g.move('r', 0);
  assert.equal(g.playerByColor('red').tokens[0], 53);
});

test('turn order is clockwise and skips finished players', () => {
  const g = four();
  g.playerByColor('green').tokens = [POS.HOME, POS.HOME, POS.HOME, 55];
  g.roll('r', 2); // no moves -> green
  assert.equal(g.current.color, 'green');
  g.roll('g', 1);
  const ev = g.move('g', 3);
  assert.ok(types(ev).includes(EVT.FINISH));
  assert.equal(g.current.color, 'yellow', 'finished player passes the turn even with home bonus');
  g.roll('y', 2); g.roll('b', 2);
  assert.equal(g.current.color, 'red');
  g.roll('r', 2);
  assert.equal(g.current.color, 'yellow', 'green is skipped');
});

test('team mode: partners do not capture each other, finished player moves partner tokens', () => {
  const g = four('team');
  // Red rel 27 -> abs 27; Yellow rel 1 = abs 27 (not safe).
  g.playerByColor('red').tokens = [25, POS.YARD, POS.YARD, POS.YARD];
  g.playerByColor('yellow').tokens = [1, POS.YARD, POS.YARD, POS.YARD];
  g.roll('r', 2);
  const ev = g.move('r', 0);
  assert.equal(ev[0].captures.length, 0);
  assert.equal(g.playerByColor('yellow').tokens[0], 1);

  const t = four('team');
  t.playerByColor('red').tokens = [POS.HOME, POS.HOME, POS.HOME, POS.HOME];
  t.playerByColor('yellow').tokens = [10, POS.YARD, POS.YARD, POS.YARD];
  assert.equal(t.controlledPlayer(t.current).color, 'yellow');
  t.roll('r', 3);
  t.move('r', 0);
  assert.equal(t.playerByColor('yellow').tokens[0], 13);
});

test('team mode: game ends when both partners are home', () => {
  const g = four('team');
  g.playerByColor('red').tokens = [POS.HOME, POS.HOME, POS.HOME, POS.HOME];
  g.playerByColor('yellow').tokens = [POS.HOME, POS.HOME, POS.HOME, 55];
  g.roll('r', 1);
  const ev = g.move('r', 3);
  assert.ok(types(ev).includes(EVT.GAME_OVER));
  assert.deepEqual(g.winners, ['red', 'yellow']);
});

test('quick mode: one token starts on board and two home wins', () => {
  const g = new GameEngine({
    mode: 'quick',
    firstTurn: 0,
    players: [
      { id: 'r', name: 'R', color: 'red' },
      { id: 'g', name: 'G', color: 'green' },
      { id: 'y', name: 'Y', color: 'yellow' },
    ],
  });
  assert.deepEqual(g.playerByColor('red').tokens, [POS.START, POS.YARD, POS.YARD, POS.YARD]);
  g.playerByColor('red').tokens = [POS.HOME, 54, POS.YARD, POS.YARD];
  g.roll('r', 2);
  const ev = g.move('r', 1);
  assert.ok(types(ev).includes(EVT.GAME_OVER));
  assert.equal(g.getStandings()[0].color, 'red');
});

test('acting out of turn is rejected', () => {
  const g = two();
  assert.throws(() => g.roll('y', 6), GameError);
  assert.throws(() => g.move('r', 0), GameError);
});

test('full random games always terminate', () => {
  for (const mode of ['classic', 'team', 'quick']) {
    for (let n = 0; n < 20; n++) {
      const g = four(mode);
      let guard = 0;
      while (!g.over && guard++ < 20000) {
        const p = g.current;
        if (g.phase === 'roll') g.roll(p.id);
        else g.move(p.id, g.legalMoves[Math.floor(Math.random() * g.legalMoves.length)].index);
      }
      assert.ok(g.over, `${mode} game finished`);
    }
  }
});

test('without the blockade option, a pair can be passed', () => {
  const g = new GameEngine({ mode: 'classic', firstTurn: 0, players: [
    { id: 'r', name: 'R', color: 'red' }, { id: 'y', name: 'Y', color: 'yellow' }] });
  g.playerByColor('yellow').tokens = [3, 3, POS.YARD, POS.YARD]; // abs 29
  g.playerByColor('red').tokens = [27, POS.YARD, POS.YARD, POS.YARD];
  g.roll('r', 5);
  assert.equal(g.phase, 'move');
});

test('fairness: dice are uniform and the starting seat is random', () => {
  const counts = [0, 0, 0, 0, 0, 0, 0];
  const starts = { red: 0, yellow: 0 };
  for (let i = 0; i < 6000; i++) {
    const g = new GameEngine({ mode: 'classic', players: [
      { id: 'r', name: 'R', color: 'red' }, { id: 'y', name: 'Y', color: 'yellow' }] });
    starts[g.current.color]++;
    counts[g.roll(g.current.id)[0].value]++;
  }
  for (let v = 1; v <= 6; v++) assert.ok(counts[v] > 850 && counts[v] < 1150, `face ${v}: ${counts[v]}`);
  assert.ok(starts.red > 2700 && starts.yellow > 2700, JSON.stringify(starts));
});
