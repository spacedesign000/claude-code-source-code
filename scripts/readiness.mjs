#!/usr/bin/env node

import { mkdir, writeFile } from 'node:fs/promises'
import { dirname, resolve } from 'node:path'
import { pathToFileURL } from 'node:url'
import {
  CliUsageError,
  formatHumanReport,
  getUsage,
  parseArgs,
  runReadiness,
} from './readiness-lib.mjs'

export async function main(argv = process.argv.slice(2)) {
  try {
    const options = parseArgs(argv)
    if (options.help) {
      process.stdout.write(getUsage())
      return 0
    }

    const report = await runReadiness({
      root: options.root,
      strict: options.strict,
    })
    const serialized = `${JSON.stringify(report, null, 2)}\n`

    if (options.output) {
      await mkdir(dirname(options.output), { recursive: true })
      await writeFile(options.output, serialized, { encoding: 'utf8', mode: 0o600 })
    }

    process.stdout.write(options.json ? serialized : formatHumanReport(report))
    if (options.output && !options.json) {
      process.stdout.write(`JSON report: ${options.output}\n`)
    }
    return report.gate.exitCode
  } catch (error) {
    if (error instanceof CliUsageError) {
      process.stderr.write(`Readiness usage error: ${error.message}\n\n${getUsage()}`)
      return 2
    }

    const message = error instanceof Error ? error.message : String(error)
    process.stderr.write(`Readiness execution error: ${message}\n`)
    return 2
  }
}

const isDirectExecution =
  process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href

if (isDirectExecution) {
  process.exitCode = await main()
}
