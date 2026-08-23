#!/usr/bin/env node

import { mkdir, writeFile } from 'node:fs/promises'
import { dirname, resolve } from 'node:path'
import { pathToFileURL } from 'node:url'
import {
  createPolicyReport,
  formatPolicyReport,
  getPolicyUsage,
  parsePolicyArgs,
  PolicyUsageError,
} from './policy-lib.mjs'

export async function main(argv = process.argv.slice(2)) {
  try {
    const options = parsePolicyArgs(argv)
    if (options.help) {
      process.stdout.write(getPolicyUsage())
      return 0
    }

    const report = await createPolicyReport({
      policyPath: options.policyPath,
      root: options.root,
    })
    const serialized = `${JSON.stringify(report, null, 2)}\n`
    if (options.output) {
      await mkdir(dirname(options.output), { recursive: true })
      await writeFile(options.output, serialized, { encoding: 'utf8', mode: 0o600 })
    }

    process.stdout.write(options.json ? serialized : formatPolicyReport(report))
    if (options.output && !options.json) {
      process.stdout.write(`JSON report: ${options.output}\n`)
    }
    return report.valid ? 0 : 1
  } catch (error) {
    if (error instanceof PolicyUsageError) {
      process.stderr.write(`Policy usage error: ${error.message}\n\n${getPolicyUsage()}`)
      return 2
    }
    const message = error instanceof Error ? error.message : String(error)
    process.stderr.write(`Policy execution error: ${message}\n`)
    return 2
  }
}

const isDirectExecution =
  process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href

if (isDirectExecution) {
  process.exitCode = await main()
}
