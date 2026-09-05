'use strict';

/**
 * Multiplayer requires a real account.
 *
 * The app hides the buttons from guests, but that is cosmetic — a modified
 * client can emit whatever it likes. This asserts the *server* refuses, which
 * is the only thing that actually holds, and that solo play and the credit
 * accounting are untouched by the gate.
 */
process.env.PORT = process.env.PORT || '3997';
process.env.AUTH_JWT_SECRET = 'account-gate-test-secret';
// The gate is ON here — that is the thing under test. Set rather than deleted:
// index.js runs dotenv, which would otherwise refill this from server/.env,
// where the flag is currently false. dotenv does not overwrite a var that is
// already set, so assigning it wins.
process.env.REQUIRE_ACCOUNT_FOR_ROOMS = 'true';

const { io: ioClient } = require('socket.io-client');
const { httpServer } = require('../src/index');
const auth = require('../src/auth');

const URL = `http://localhost:${process.env.PORT}`;
let fail = 0;
const ok = (c, m) => { console.log(`  ${c ? '✓' : '✗'} ${m}`); if (!c) fail++; };

const connect = (clientId, token) =>
  new Promise((res, rej) => {
    const s = ioClient(URL, {
      transports: ['websocket'],
      auth: { clientId, username: 'Tester', accessToken: token },
    });
    s.on('connect', () => res(s));
    s.on('connect_error', rej);
    setTimeout(() => rej(new Error('connect timeout')), 8000);
  });

const emit = (s, ev, payload) =>
  new Promise((res) => {
    s.emit(ev, payload ?? {}, res);
    setTimeout(() => res({ ok: false, error: 'TIMEOUT' }), 5000);
  });

setTimeout(async () => {
  // A guest: either no token at all, or a token whose `guest` claim is true.
  const noToken = await connect('gate-anon', undefined);
  ok(
    (await emit(noToken, 'create_room')).error === 'GOOGLE_REQUIRED',
    'no token cannot CREATE a room'
  );
  ok(
    (await emit(noToken, 'join_room', { code: 'ABCDE' })).error === 'GOOGLE_REQUIRED',
    'no token cannot JOIN a room'
  );

  const guestToken = auth.issueToken({ id: 'guest-1', username: 'Guesty', google_sub: null });
  const guest = await connect('gate-guest', guestToken);
  ok(
    (await emit(guest, 'create_room')).error === 'GOOGLE_REQUIRED',
    'a guest token cannot CREATE a room'
  );
  ok(
    (await emit(guest, 'join_room', { code: 'ABCDE' })).error === 'GOOGLE_REQUIRED',
    'a guest token cannot JOIN a room'
  );

  // A real account gets through. google_sub set => the token's guest claim is false.
  const accountToken = auth.issueToken({
    id: '11111111-2222-3333-4444-555555555555',
    username: 'Real',
    google_sub: 'google-sub-1',
  });
  ok(auth.verifyToken(accountToken).guest === false, 'a linked account issues a non-guest token');

  const account = await connect('gate-account', accountToken);
  const created = await emit(account, 'create_room');
  ok(created.ok, `a signed-in account CAN create a room (${created.code})`);

  const joiner = await connect('gate-account-2', auth.issueToken({
    id: '66666666-7777-8888-9999-000000000000',
    username: 'Real2',
    google_sub: 'google-sub-2',
  }));
  const joinAck = await emit(joiner, 'join_room', { code: created.code });
  ok(joinAck.ok, 'and another account can join it');

  // Hosting is the only thing that costs. create_room reports a balance
  // because it just spent one; join_room reports none because it spent
  // nothing. If a credits field ever appears on a join ack, something on the
  // join path has started touching the counter.
  ok('credits' in created, 'create_room reports the balance it just spent from');
  ok(!('credits' in joinAck), 'join_room reports NO balance — joining burns nothing');

  // A refused guest must not have been charged on the way out.
  ok(
    (await emit(guest, 'create_room')).error === 'GOOGLE_REQUIRED',
    'a refused guest is gated, not silently charged a credit'
  );

  console.log(fail === 0 ? `\n${10}/10 account-gate checks passed` : `\n${fail} FAILED`);
  [noToken, guest, account, joiner].forEach((s) => s.close());
  httpServer.close(() => process.exit(fail === 0 ? 0 : 1));
  setTimeout(() => process.exit(fail === 0 ? 0 : 1), 1500).unref();
}, 700);
