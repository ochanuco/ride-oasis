'use strict';

class MinHeap {
  constructor() {
    this.keys = [];
    this.vals = [];
  }

  get size() {
    return this.keys.length;
  }

  push(key, val) {
    this.keys.push(key);
    this.vals.push(val);
    this._siftUp(this.keys.length - 1);
  }

  pop() {
    const n = this.keys.length;
    if (n === 0) return undefined;
    const topKey = this.keys[0];
    const topVal = this.vals[0];
    const lastKey = this.keys.pop();
    const lastVal = this.vals.pop();
    if (n > 1) {
      this.keys[0] = lastKey;
      this.vals[0] = lastVal;
      this._siftDown(0);
    }
    return { key: topKey, val: topVal };
  }

  peek() {
    if (this.keys.length === 0) return undefined;
    return { key: this.keys[0], val: this.vals[0] };
  }

  _siftUp(i) {
    const { keys, vals } = this;
    while (i > 0) {
      const parent = (i - 1) >>> 1;
      if (keys[i] < keys[parent]) {
        [keys[i], keys[parent]] = [keys[parent], keys[i]];
        [vals[i], vals[parent]] = [vals[parent], vals[i]];
        i = parent;
      } else break;
    }
  }

  _siftDown(i) {
    const { keys, vals } = this;
    const n = keys.length;
    for (;;) {
      const left = i * 2 + 1;
      const right = left + 1;
      let smallest = i;
      if (left < n && keys[left] < keys[smallest]) smallest = left;
      if (right < n && keys[right] < keys[smallest]) smallest = right;
      if (smallest === i) break;
      [keys[i], keys[smallest]] = [keys[smallest], keys[i]];
      [vals[i], vals[smallest]] = [vals[smallest], vals[i]];
      i = smallest;
    }
  }
}

module.exports = { MinHeap };
