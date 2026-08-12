const packModules = import.meta.glob('/course-packs/*/pack.json', { eager: true })

const packsById = Object.fromEntries(
  Object.values(packModules).map((mod) => {
    const pack = mod.default ?? mod
    return [pack.id, pack]
  })
)

export function loadCoursePack(packId) {
  const pack = packsById[packId]
  if (!pack) throw new Error(`Unknown course pack: ${packId}`)
  return pack
}

export function listCoursePacks() {
  return Object.values(packsById)
}
