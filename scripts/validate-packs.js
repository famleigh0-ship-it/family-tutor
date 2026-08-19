#!/usr/bin/env node
// Standalone CLI so pack content can be validated without going through
// Vite/TypeScript. Reads the pack JSON files directly off disk and runs
// the same shape + integrity checks the app's loader uses at runtime.
//
// Usage: node scripts/validate-packs.js

import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import path from 'node:path'
import { validatePackShape, checkPackIntegrity } from '../src/packs/validatePack.js'

const rootDir = path.dirname(path.dirname(fileURLToPath(import.meta.url)))
const packFiles = [
  path.join(rootDir, 'course-packs', 'ap-physics-1', 'pack.json'),
  path.join(rootDir, 'course-packs', 'calc-ab-bc', 'pack.json'),
  path.join(rootDir, 'course-packs', 'ap-human-geography', 'pack.json'),
  path.join(rootDir, 'course-packs', 'nmsqt-2026', 'pack.json'),
  path.join(rootDir, 'course-packs', 'ap-us-history', 'pack.json')
]

let allPassed = true

for (const file of packFiles) {
  const label = path.relative(rootDir, file)
  const raw = JSON.parse(readFileSync(file, 'utf-8'))

  try {
    const pack = validatePackShape(raw)
    const errors = checkPackIntegrity(pack)

    if (errors.length === 0) {
      console.log(`PASS  ${label} (${pack.id})`)
    } else {
      allPassed = false
      console.log(`FAIL  ${label} (${pack.id})`)
      for (const err of errors) console.log(`      - ${err}`)
    }
  } catch (err) {
    allPassed = false
    console.log(`FAIL  ${label}`)
    console.log(`      - ${err.message}`)
  }
}

if (!allPassed) {
  console.log('\nOne or more packs failed validation.')
  process.exit(1)
}

console.log('\nAll packs passed validation.')
