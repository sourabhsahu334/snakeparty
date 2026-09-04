'use strict';

/**
 * Uniform grid for broad-phase collision.
 *
 * With ~15 snakes of up to a few hundred body points each, testing every head
 * against every point is ~10^6 checks per tick. Bucketing by cell turns that
 * into a handful of lookups.
 */
class SpatialHash {
  constructor(cellSize) {
    this.cellSize = cellSize;
    this.buckets = new Map();
  }

  clear() {
    this.buckets.clear();
  }

  _key(x, y) {
    return `${Math.floor(x / this.cellSize)},${Math.floor(y / this.cellSize)}`;
  }

  insert(x, y, item) {
    const k = this._key(x, y);
    let bucket = this.buckets.get(k);
    if (!bucket) {
      bucket = [];
      this.buckets.set(k, bucket);
    }
    bucket.push(item);
  }

  /** Every item in the cells overlapping the circle (x, y, radius). */
  query(x, y, radius) {
    const out = [];
    const minX = Math.floor((x - radius) / this.cellSize);
    const maxX = Math.floor((x + radius) / this.cellSize);
    const minY = Math.floor((y - radius) / this.cellSize);
    const maxY = Math.floor((y + radius) / this.cellSize);

    for (let cx = minX; cx <= maxX; cx++) {
      for (let cy = minY; cy <= maxY; cy++) {
        const bucket = this.buckets.get(`${cx},${cy}`);
        if (bucket) out.push(...bucket);
      }
    }
    return out;
  }
}

module.exports = SpatialHash;
