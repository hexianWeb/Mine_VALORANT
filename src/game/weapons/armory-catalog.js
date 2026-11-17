const entries = [
  {
    id: 'classic',
    name: '制式手枪',
    category: 'sidearms',
    shortcut: '2',
  },
  {
    id: 'ghost',
    name: '鬼魅',
    category: 'sidearms',
    shortcut: '3',
    provisional: true,
  },
  {
    id: 'sheriff',
    name: '神射',
    category: 'sidearms',
    shortcut: '5',
    provisional: true,
  },
  {
    id: 'phantom',
    name: '幻影',
    category: 'rifles',
    shortcut: '1',
  },
  {
    id: 'vandal',
    name: '暴徒',
    category: 'rifles',
    shortcut: '4',
    provisional: true,
  },
  {
    id: 'judge',
    name: '判官',
    category: 'shotguns',
    shortcut: '6',
    provisional: true,
  },
  {
    id: 'odin',
    name: '奥丁',
    category: 'heavy',
    shortcut: '7',
    provisional: true,
  },
]

export const armoryCategories = Object.freeze([
  Object.freeze({ id: 'sidearms', name: '随身武器' }),
  Object.freeze({ id: 'rifles', name: '步枪' }),
  Object.freeze({ id: 'shotguns', name: '霰弹枪' }),
  Object.freeze({ id: 'heavy', name: '机关枪' }),
])

/** Static, held-slot catalog. All numerical details come from the actual runtime definitions. */
export function createArmoryCatalog({ definitions, inventory }) {
  const byDefinition = new Map(definitions.map(definition => [definition.id, definition]))
  return Object.freeze(entries.flatMap((entry) => {
    const definition = byDefinition.get(entry.id)
    return inventory.slots.flatMap((slot) => {
      const weapon = inventory.weapons.find(weapon => weapon.instanceId === slot.instanceId && weapon.definitionId === entry.id)
      if (!weapon || !definition)
        return []
      return [
        Object.freeze({
          ...entry,
          provisional: !!entry.provisional,
          slotId: slot.id,
          instanceId: weapon.instanceId,
          stats: Object.freeze({
            capacity: definition.capacity,
            fireMode: definition.fire.mode,
            fireRate: 1 / definition.fire.interval,
            adsFireRate: definition.capabilities.ads
              ? 1 / (definition.fire.adsInterval ?? definition.fire.interval)
              : null,
            fullFireRate: definition.fire.spinUp
              ? 1 / definition.fire.spinUp.interval
              : null,
            spinUp: definition.fire.spinUp?.duration ?? null,
            pellets: definition.fire.pellets ?? 1,
            reloadTactical: definition.reload.tactical.duration,
            reloadEmpty: definition.reload.empty.duration,
            draw: definition.equip.draw,
            ads: definition.capabilities.ads,
          }),
        }),
      ]
    })
  }))
}
