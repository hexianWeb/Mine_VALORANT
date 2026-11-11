import { PropertyBinding } from 'three/webgpu'

export function immutable(value) {
  if (Array.isArray(value))
    return Object.freeze(value.map(immutable))
  if (value && typeof value === 'object') {
    return Object.freeze(Object.fromEntries(Object.entries(value).map(([key, entry]) => [
      key,
      immutable(entry),
    ])))
  }
  return value
}

export function seconds(value, name, positive = false) {
  if (!Number.isFinite(value) || value < 0 || (positive && value === 0))
    throw new RangeError(`[Animation] Invalid ${name}`)
  return value
}

function validateBindings(root, clip, nodes) {
  for (const track of clip.tracks) {
    const path = PropertyBinding.parseTrackName(track.name)
    if (path.objectName)
      throw new Error(`[Animation] Unsupported compound binding: ${track.name}`)
    const matches = nodes.get(path.nodeName)
    if (matches?.length > 1)
      throw new Error(`[Animation] Ambiguous node binding: ${track.name}`)
    const node = PropertyBinding.findNode(root, path.nodeName)
    if (!node || node[path.propertyName] === undefined)
      throw new Error(`[Animation] Missing binding: ${track.name}`)
    if (path.propertyIndex !== undefined) {
      const index = path.propertyName === 'morphTargetInfluences'
        ? node.morphTargetDictionary?.[path.propertyIndex] ?? path.propertyIndex
        : path.propertyIndex
      if (node[path.propertyName][index] === undefined)
        throw new Error(`[Animation] Missing property index: ${track.name}`)
    }
    if (!track.times.length || !Number.isInteger(track.getValueSize()) || track.getValueSize() < 1)
      throw new Error(`[Animation] Empty or malformed track: ${track.name}`)
    let previous = -Infinity
    for (const time of track.times) {
      if (!Number.isFinite(time) || time < 0 || time < previous || time > clip.duration + 1e-5)
        throw new Error(`[Animation] Invalid track time: ${track.name}`)
      previous = time
    }
    if (!['bool', 'string'].includes(track.ValueTypeName) && !track.values.every(Number.isFinite))
      throw new Error(`[Animation] Invalid track value: ${track.name}`)
  }
}

/** Resolves semantic roles and rejects missing targets before Mixer can silently skip them. */
export class ClipLibrary {
  #roles = new Map()

  constructor({ root, clips, actions } = {}) {
    if (!root?.isObject3D || !Array.isArray(clips) || !actions || Array.isArray(actions))
      throw new TypeError('[Animation] Expected root, clips and actions')
    const nodes = new Map()
    root.traverse((node) => {
      for (const key of new Set([node.name, node.uuid])) {
        if (!key)
          continue
        if (!nodes.has(key))
          nodes.set(key, [])
        nodes.get(key).push(node)
      }
    })
    const byName = new Map()
    for (const clip of clips) {
      if (!clip?.isAnimationClip && (!clip?.tracks || typeof clip.name !== 'string'))
        throw new TypeError('[Animation] Invalid clip')
      if (byName.has(clip.name))
        throw new Error(`[Animation] Duplicate clip: ${clip.name}`)
      seconds(clip.duration, 'clip duration')
      validateBindings(root, clip, nodes)
      byName.set(clip.name, clip)
    }
    for (const [role, profile] of Object.entries(actions)) {
      const clip = byName.get(profile?.clip)
      if (!role || !clip)
        throw new Error(`[Animation] Missing clip for role: ${role}`)
      if (profile.loop !== undefined && typeof profile.loop !== 'boolean')
        throw new TypeError(`[Animation] Invalid loop: ${role}`)
      const rate = seconds(profile.rate ?? 1, 'rate', true)
      const fade = seconds(profile.fade ?? 0.1, 'fade')
      const markers = profile.markers ?? []
      if (!Array.isArray(markers))
        throw new TypeError('[Animation] markers must be an array')
      const markerIds = new Set()
      const copiedMarkers = markers.map((marker) => {
        if (typeof marker.id !== 'string' || !marker.id || markerIds.has(marker.id))
          throw new Error(`[Animation] Invalid or duplicate marker id: ${role}`)
        seconds(marker.time, 'marker time')
        if (marker.time > clip.duration)
          throw new RangeError(`[Animation] Marker outside clip: ${role}`)
        markerIds.add(marker.id)
        return immutable(marker)
      }).sort((a, b) => a.time - b.time)
      this.#roles.set(role, Object.freeze({
        role,
        clip,
        rate,
        fade,
        loop: profile.loop ?? false,
        markers: Object.freeze(copiedMarkers),
      }))
    }
  }

  get(role) {
    const entry = this.#roles.get(role)
    if (!entry)
      throw new Error(`[Animation] Unknown role: ${role}`)
    return entry
  }
}
