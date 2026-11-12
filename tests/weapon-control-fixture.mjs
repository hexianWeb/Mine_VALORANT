import { readFile } from 'node:fs/promises'
import { AnimationClip, Bone, Group, InterpolateDiscrete, Vector3, VectorKeyframeTrack } from 'three/webgpu'

export async function controlFixture(id) {
  return JSON.parse(await readFile(new URL(`./fixtures/weapon-controls/${id}-controls.json`, import.meta.url), 'utf8'))
}

export function controlRig(data) {
  const root = new Group()
  root.name = 'ControlFixture'
  const bones = new Map(data.bones.map(({ name }) => {
    const bone = new Bone()
    bone.name = name
    return [name, bone]
  }))
  for (const { name, parent } of data.bones) (bones.get(parent) ?? root).add(bones.get(name))
  const clips = data.clips.map(clip => new AnimationClip(clip.name, clip.duration, clip.tracks.map(track => new VectorKeyframeTrack(
    track.name,
    track.keys.map(key => (key[0] - data.timeOriginFrame) / data.fps),
    track.keys.flatMap(key => key.slice(1)),
    track.interpolation === 'CONSTANT'
      ? InterpolateDiscrete
      : undefined,
  ))))
  return { root, bones, clips }
}

export function visibleIndicators(root, data) {
  const scale = new Vector3()
  return data.runtimeControls.ammoDisplay.tracks.filter((track) => {
    root.getObjectByName(track.split('.')[0]).getWorldScale(scale)
    return scale.x > 0.5 && scale.y > 0.5 && scale.z > 0.5
  }).length
}
