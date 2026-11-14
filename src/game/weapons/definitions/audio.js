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
  sheriff_shoot: 'd24f978e0c83a49a6c4b5f800b847f661dece4776118981fae69a636d566112b',
  sheriff_draw: '9ddbc34cf3167b82e50ce3410c1c532d076e7af3539c41aa399d657a4d282b54',
  sheriff_reload: 'adc33e99c444dfe8659272aadd948fdf27efbd715fa10c8faa47ec0cd9c9657e',
  sheriff_inspect: '9e87c98ad08771f392e2bfc3a69896a4bbb20d79f66a3e341a7461f98bcfd9f2',
  judge_shoot: 'c4e9ad88e3f87bbeac15b17f5a348c5517b06289ed8f92583694724c03af7855',
  judge_draw: '0a1325afff59ce1741b2eb37b6bec4f946b221679dd2bfa81b1aa6e5a668070a',
  judge_reload: '886c964a93a49ec6533fe5fca0f71a61acc7b39821ae32bd3f99b05b299eb129',
  judge_inspect: '0317c5a08fc88ea7acd1b038a30ca61e9a5c64e44666f15027a964a6ac716dcf',
  odin_shoot: 'dfd4be930b6f879d73b8ee5d9ce6feadfd2961ca3afaded262fb7d126f9fdc9e',
  odin_draw: '9c3d9ebc9de14803c551974a4218dfe11eeda8a575a1e74f9220a5953f5f0c12',
  odin_reload: '547862e65b90a666fa571fcdab7aa1659005490c06f645446f96860370e1cd8f',
  odin_inspect: '1074135015bc642c37fe00164a12d5d6d88e38366292cab1573f9b6ca06ee9fa',
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
  sheriff: profile('sheriff'),
  judge: profile('judge'),
  odin: profile('odin'),
})
