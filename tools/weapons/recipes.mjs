const common = {
  assetVersion: 'v1',
  scene: '80_ThreeJS_Export',
  armatures: [
    'root',
    'views',
    'camera',
    'positioning',
  ],
  materials: {
    weapon: ['Weapon_Skin'],
    armsLeft: ['Character_Left'],
    armsRight: ['Character_Right'],
  },
  sockets: { muzzle: 'muzzle_flash', shell: 'shell' },
  actions: {
    idle: 'static_idle',
    draw: 'draw',
    holster: 'put_away',
    fire: 'shoot',
    fireAds: 'shoot_aim',
    reloadTactical: 'reload_tactical',
    reloadEmpty: 'reload_empty',
    inspect: 'inspect',
    aimStart: 'aim_start',
    aim: 'aim',
    aimEnd: 'aim_end',
  },
  requiredActions: [
    'idle',
    'draw',
    'holster',
    'fire',
    'reloadTactical',
    'reloadEmpty',
    'inspect',
  ],
}

// Paths are authoring inputs, never inferred by the browser from filenames.
export const recipes = {
  classic: {
    ...common,
    weaponId: 'classic',
    skinId: 'smite',
    blend: 'skin_work_folder/classic_skin_work/Classic_Smite_Animated.blend',
    texture: 'skin_work_folder/classic_skin_work/classic_smite_weapon.png',
    meshes: [
      'Arms_Left',
      'Arms_Right',
      'Weapon_Body',
      'Weapon_Magazine',
    ],
    clipCount: 31,
  },
  phantom: {
    ...common,
    weaponId: 'phantom',
    skinId: 'tactiplay',
    blend: 'skin_work_folder/phantom_skin_work/Phantom_Tactiplay_Animated.blend',
    texture: 'skin_work_folder/phantom_skin_work/phantom_tactiplay_weapon.png',
    meshes: [
      'Arms_Left',
      'Arms_Right',
      'Weapon_Body',
      'Weapon_Magazine',
      'Weapon_SpareMagazine',
    ],
    clipCount: 30,
  },
}
