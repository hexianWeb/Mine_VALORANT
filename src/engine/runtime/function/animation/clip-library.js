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

export function overlaps(a, b) {
  return a.node === b.node && a.property === b.property
    && (a.index === undefined || b.index === undefined || String(a.index) === String(b.index))
}

function bindingTarget(root, track, nodes) {
  const path = PropertyBinding.parseTrackName(track.name)
  if (path.objectName)
    throw new Error(`[Animation] Unsupported compound binding: ${track.name}`)
  const matches = nodes.get(path.nodeName)
  if (matches?.length > 1)
    throw new Error(`[Animation] Ambiguous node binding: ${track.name}`)
  const node = PropertyBinding.findNode(root, path.nodeName)
  if (!node || node[path.propertyName] === undefined)
    throw new Error(`[Animation] Missing binding: ${track.name}`)
  const index = path.propertyIndex === undefined
    ? undefined
    : path.propertyName === 'morphTargetInfluences'
      ? node.morphTargetDictionary?.[path.propertyIndex] ?? path.propertyIndex
      : path.propertyIndex
  if (index !== undefined && node[path.propertyName][index] === undefined)
    throw new Error(`[Animation] Missing property index: ${track.name}`)
  return { node, property: path.propertyName, index }
}

function validateBindings(root, clip, nodes) {
  for (const track of clip.tracks) {
    bindingTarget(root, track, nodes)
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
  #controls = new Map()

  constructor({ root, clips, actions, controls = {} } = {}) {
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
    if (!controls || typeof controls !== 'object' || Array.isArray(controls))
      throw new TypeError('[Animation] controls must be a record')
    for (const [role, profile] of Object.entries(controls)) {
      const clip = byName.get(profile?.clip)
      if (!role || !clip || !Array.isArray(profile.tracks) || !profile.tracks.length
        || Object.keys(profile).some(key => !['clip', 'tracks'].includes(key))) {
        throw new Error(`[Animation] Invalid control profile: ${role}`)
      }
      const names = new Set()
      const tracks = profile.tracks.map((name) => {
        const matches = clip.tracks.filter(track => track.name === name)
        if (names.has(name) || matches.length !== 1)
          throw new Error(`[Animation] Missing or duplicate control track: ${role}/${name}`)
        names.add(name)
        const track = matches[0]
        const target = bindingTarget(root, track, nodes)
        const property = target.node[target.property]
        const values = target.index !== undefined
          ? [property[target.index]]
          : property.toArray?.() ?? (Array.isArray(property)
            ? property
            : [property])
        // Use the source factory, including GLTF CUBICSPLINE's tangent/value layout.
        const size = track.createInterpolant().valueSize
        if (size !== values.length || !values.every(Number.isFinite)
          || ['bool', 'string'].includes(track.ValueTypeName)) {
          throw new Error(`[Animation] Invalid numeric control binding: ${name}`)
        }
        return Object.freeze({
          track,
          ...target,
          size,
        })
      })
      if (tracks.some((track, index) => tracks.slice(0, index).some(other => overlaps(track, other))))
        throw new Error(`[Animation] Overlapping control profile: ${role}`)
      this.#controls.set(role, Object.freeze({
        role,
        clip,
        tracks: Object.freeze(tracks),
      }))
    }
  }

  get(role) {
    const entry = this.#roles.get(role)
    if (!entry)
      throw new Error(`[Animation] Unknown role: ${role}`)
    return entry
  }

  getControl(role) {
    const entry = this.#controls.get(role)
    if (!entry)
      throw new Error(`[Animation] Unknown control: ${role}`)
    return entry
  }
}
