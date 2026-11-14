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
  ghost_shoot: 'ceab17e7a257808ada95f1720367c36218b99d78afefc5c064db23f4ad09457f',
  ghost_draw: '76146cc5a899625979e247123660944113791181525bf88d30f5a50aefb371fa',
  ghost_reload: 'c9bafa4819fa2b634d8656cd9da315ea265cf4b34646ed5e394bd77dc35e10e8',
  ghost_inspect: 'ff3d3e466afb6beeedcee584092dcc5cf8236b1d876c0a8b51d1698cc5046009',
  vandal_shoot: '2862b6c89f56255f7efa6f31399cad317897019fdc567c59acdc683abf5604ed',
  vandal_draw: '7f0caeb56f927a6af4d22daacc0e0d4a3b46d67768fa0c056d86e53148ea660b',
  vandal_reload: 'e05a8b1b9cbb58354ae476073d65cb7aaa9e1fd5e5ba7034e9d1d89a0af69ba7',
  vandal_inspect: 'b314467b86f512749cf0393564d0b544ef4c0f69977eb85c1fcd96ba8a6496cf',
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
  ghost: profile('ghost'),
  vandal: profile('vandal'),
})
