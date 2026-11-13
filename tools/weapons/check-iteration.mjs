import assert from 'node:assert/strict'
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import path from 'node:path'
import process from 'node:process'
import { pathToFileURL } from 'node:url'
import validator from 'gltf-validator'
import { validateWeaponIteration } from './iteration-validation.mjs'
import { validateWeaponPackage } from './package-validation.mjs'
import { createWorkflowTiming } from './workflow-timing.mjs'

export async function checkWeaponIteration(args) {
  assert.ok(args[0] && !args[0].startsWith('--'), 'Pass a weapon package directory')
  const directory = path.resolve(args[0])
  const options = {}
  let release = false
  let reportFile
  for (let i = 1; i < args.length; i++) {
    if (args[i] === '--release') {
      release = true
    }
    else if (args[i] === '--no-cache') {
      options.cache = false
    }
    else {
      const key = { '--cache-root': 'cacheRoot', '--report': 'report' }[args[i]]
      assert.ok(key && args[i + 1] && !args[i + 1].startsWith('--'), `Unknown/missing option: ${args[i]}`)
      const value = path.resolve(args[++i])
      if (key === 'report')
        reportFile = value
      else options[key] = value
    }
  }
  if (reportFile) {
    const relative = path.relative(directory, reportFile)
    assert.ok(relative === '..' || relative.startsWith(`..${path.sep}`) || path.isAbsolute(relative), 'Keep timing reports outside the asset package')
  }
  const timing = createWorkflowTiming()
  let report
  try {
    if (release) {
      const audit = JSON.parse(await readFile(path.join(directory, 'source-audit.json'), 'utf8'))
      const result = await timing.measure('release-validation', () => validateWeaponPackage(directory, { validator, poseSamples: audit.poseSamples }))
      report = {
        ...result,
        profile: 'release',
        modelCache: { hit: false },
        timings: timing.snapshot(),
      }
    }
    else {
      report = await validateWeaponIteration(directory, options)
    }
    return report
  }
  catch (error) {
    report = { passed: false, failure: error.message, timings: error.timings ?? timing.snapshot() }
    throw error
  }
  finally {
    if (reportFile) {
      await mkdir(path.dirname(reportFile), { recursive: true })
      await writeFile(reportFile, `${JSON.stringify(report, null, 2)}\n`)
    }
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  checkWeaponIteration(process.argv.slice(2)).then(report => console.log(JSON.stringify(report, null, 2))).catch((error) => {
    console.error(error)
    process.exitCode = 1
  })
}
