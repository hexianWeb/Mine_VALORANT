// Explicit local roles. Full action tracks play once, never once per moving part/marker.
// Gains leave headroom for overlapping shots; source Ogg bytes are never altered.
const hashes = {
  classic_shoot: '75a7ebca89e30b94772300df5ec823dd3ccb1de0ba446b331215b595b1ae4509',
  classic_draw: '7afdcfb88224d3992d6a9bbde82f715578307051a8933133383016826f63585c',
  classic_reload: '3c91f5ba63b5ad6c3ef64fd07eaf63282cfcd3baaecfcaead85fd2227ff1a990',
  classic_inspect: '676f2ac51a8783e02d124c94668f78b4f44c29176135b2854db8a754d37096f5',
  phantom_shoot: 'eff95bfb12222f8183c1bfbcc95ec6379a106f9ffbdcf4d735358dfab68da8fd',
  phantom_draw: 'e495efa46fb449a502c99c5809a6696ba2cea70ed75cc5b3e35ccf12be8b7850',
  phantom_reload: '51dc1c9f233451b1a62c0418d6bbad0bc6e4204dd7a99ee209ecefb1177c2fa4',
  phantom_inspect: '83ba2ab667d8c2a7965fd19e2ec8f022919d8f530655cc5b41f714d763238265',
}

function profile(weaponId) {
  const cues = Object.fromEntries(['shoot', 'draw', 'reload', 'inspect'].map((role) => {
    const id = `${weaponId}_${role}`
    return [
      id,
      Object.freeze({
        id,
        url: `/audio/${weaponId}/${id}.ogg`,
        sha256: hashes[id],
        gain: role === 'shoot'
          ? 0.25
          : 0.22,
      }),
    ]
  }))
  return Object.freeze({
    cues: Object.freeze(cues),
    fire: `${weaponId}_shoot`,
    draw: `${weaponId}_draw`,
    reloadTactical: `${weaponId}_reload`,
    reloadEmpty: `${weaponId}_reload`,
    inspect: `${weaponId}_inspect`,
  })
}

export const weaponAudioProfiles = Object.freeze({
  classic: profile('classic'),
  phantom: profile('phantom'),
})
