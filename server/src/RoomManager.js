'use strict';

const { customAlphabet } = require('nanoid');
const GameRoom = require('./GameRoom');

// Unambiguous alphabet: no O/0, I/1, so a code read aloud to a friend survives.
const ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
const CODE_LENGTH = 5;
const newCode = customAlphabet(ALPHABET, CODE_LENGTH);

/**
 * Owns the set of live rooms. Rooms live entirely in this process's memory —
 * there is no database round trip anywhere in this file.
 */
class RoomManager {
  constructor({ emit, emitTo }) {
    /** @type {Map<string, GameRoom>} */
    this.rooms = new Map();
    this.emit = emit;
    this.emitTo = emitTo;
  }

  createRoom({ hostClientId }) {
    const code = this._uniqueCode();
    const room = new GameRoom(code, {
      hostClientId,
      emit: this.emit,
      emitTo: this.emitTo,
      onEmpty: (r) => this.removeRoom(r.code),
    });
    this.rooms.set(code, room);
    return room;
  }

  /**
   * @returns {{ok: true, room: GameRoom, player: object} | {ok: false, error: string}}
   */
  joinRoom(code, socketId, identity) {
    const room = this.getRoom(code);
    if (!room) return { ok: false, error: 'ROOM_NOT_FOUND' };
    if (room.status !== 'lobby') return { ok: false, error: 'ROOM_IN_PROGRESS' };
    if (room.isFull) return { ok: false, error: 'ROOM_FULL' };

    const player = room.addPlayer(socketId, identity);
    if (!player) return { ok: false, error: 'ROOM_FULL' };
    return { ok: true, room, player };
  }

  getRoom(code) {
    if (typeof code !== 'string') return null;
    return this.rooms.get(code.trim().toUpperCase()) || null;
  }

  /** Find the room a given socket is sitting in. */
  roomForSocket(socketId) {
    for (const room of this.rooms.values()) {
      if (room.players.has(socketId)) return room;
    }
    return null;
  }

  removeRoom(code) {
    const room = this.rooms.get(code);
    if (!room) return;
    room.stop();
    this.rooms.delete(code);
  }

  get size() {
    return this.rooms.size;
  }

  _uniqueCode() {
    for (let i = 0; i < 50; i++) {
      const code = newCode();
      if (!this.rooms.has(code)) return code;
    }
    // Astronomically unlikely; widen rather than fail.
    return `${newCode()}${newCode()}`.slice(0, CODE_LENGTH + 2);
  }
}

module.exports = RoomManager;
module.exports.CODE_LENGTH = CODE_LENGTH;
module.exports.ALPHABET = ALPHABET;
