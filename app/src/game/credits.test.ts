import test from 'node:test';
import assert from 'node:assert';

import { errorText, noCreditsText, timeUntil } from './protocol';

/**
 * The wording a player sees when they run out of rooms. It matters more than
 * it looks: the limit is on *hosting*, and a message that reads as "you cannot
 * play until tomorrow" would be telling them something untrue.
 */

const inHours = (h: number) => new Date(Date.now() + h * 3_600_000).toISOString();

test('the refill time is human, and rounds up', () => {
  assert.equal(timeUntil(inHours(4) ), '4h');
  assert.equal(timeUntil(new Date(Date.now() + 90 * 60_000).toISOString()), '1h 30m');
  assert.equal(timeUntil(new Date(Date.now() + 5 * 60_000).toISOString()), '5 min');

  // Rounding up matters: a player refused with 30 seconds to go must not be
  // told "0 min", which reads as a bug.
  assert.equal(timeUntil(new Date(Date.now() + 30_000).toISOString()), '1 min');
});

test('a reset that has already passed does not render as negative', () => {
  assert.equal(timeUntil(new Date(Date.now() - 60_000).toISOString()), 'a moment');
});

test('a missing or unparseable reset still says something sensible', () => {
  assert.equal(timeUntil(undefined), 'a few hours');
  assert.equal(timeUntil('not-a-date'), 'a few hours');
});

test('the out-of-rooms message says joining is still free', () => {
  const msg = noCreditsText({ remaining: 0, perDay: 2, resetsAt: inHours(3) });
  assert.match(msg, /2 free rooms/);
  assert.match(msg, /3h/);
  assert.match(msg, /still join/, 'must not read as "come back tomorrow"');
});

test('the message survives the server not sending a balance', () => {
  const msg = noCreditsText(undefined);
  assert.match(msg, /free rooms/);
  assert.match(msg, /still join/);
  assert.ok(!msg.includes('undefined') && !msg.includes('NaN'), msg);
});

test('the daily allowance is quoted from the server, not hardcoded', () => {
  assert.match(noCreditsText({ remaining: 0, perDay: 5 }), /5 free rooms/);
});

test('NO_ROOM_CREDITS has a static fallback for callers without the balance', () => {
  const text = errorText('NO_ROOM_CREDITS');
  assert.match(text, /still join/);
  assert.notEqual(text, 'Something went wrong. Try again.');
});
