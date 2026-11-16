/** A shot-local stream: presentation never depends on frame count or Math.random(). */
export function shotRandom(sequence) {
  let state = Math.imul(sequence, 0x9E3779B9) || 1
  return () => {
    state ^= state << 13
    state ^= state >>> 17
    state ^= state << 5
    return (state >>> 0) / 0x100000000
  }
}
