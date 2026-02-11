import fs from "node:fs/promises"
import path from "node:path"

import { formatErrorMessage } from "@sui-amm/tooling-core/utils/errors"
import type { ToolingContext } from "./factory.ts"
import { logWarning } from "./log.ts"
import { resolveMoveCliEnvironmentName } from "./move.ts"
import { getSuiCliEnvironmentChainId } from "./suiCli.ts"
import { isErrnoWithCode } from "./utils/fs.ts"
import { escapeRegExp } from "./utils/regex.ts"

type MoveEnvironmentSyncResult = {
  updatedFiles: string[]
}

export type MoveEnvironmentChainIdSyncResult = {
  updatedFiles: string[]
  chainId?: string
  didAttempt: boolean
}

const resolveLineEnding = (contents: string) =>
  contents.includes("\r\n") ? "\r\n" : "\n"

const getLineStartOffsets = (contents: string) => {
  const offsets = [0]
  for (let index = 0; index < contents.length; index += 1) {
    if (contents[index] === "\n") offsets.push(index + 1)
  }
  return offsets
}

const listMoveTomlFiles = async (rootPath: string): Promise<string[]> => {
  const entries = await fs.readdir(rootPath, { withFileTypes: true })
  const files: string[] = []

  await Promise.all(
    entries.map(async (entry) => {
      const fullPath = path.join(rootPath, entry.name)
      if (entry.isDirectory()) {
        files.push(...(await listMoveTomlFiles(fullPath)))
      } else if (entry.isFile() && entry.name === "Move.toml") {
        files.push(fullPath)
      }
    })
  )

  return files
}

const findSectionBlock = (
  contents: string,
  sectionName: string
): { block: string; start: number; end: number } | undefined => {
  const escapedSection = escapeRegExp(sectionName)
  const lines = contents.split(/\r?\n/)
  const lineOffsets = getLineStartOffsets(contents)
  const sectionHeaderRegex = new RegExp(
    `^\\s*\\[${escapedSection}\\]\\s*(#.*)?$`
  )
  const anySectionHeaderRegex = /^\s*\[[^\]]+\]\s*(#.*)?$/

  const headerIndex = lines.findIndex((line) => sectionHeaderRegex.test(line))
  if (headerIndex < 0) return undefined

  const nextHeaderIndex = lines.findIndex(
    (line, index) => index > headerIndex && anySectionHeaderRegex.test(line)
  )

  const start = lineOffsets[headerIndex] ?? 0
  const end =
    nextHeaderIndex >= 0
      ? (lineOffsets[nextHeaderIndex] ?? contents.length)
      : contents.length

  return { block: contents.slice(start, end), start, end }
}

const trimLeadingEmptyLines = (contents: string) =>
  contents.replace(/^(?:\s*\r?\n)+/, "")

const trimTrailingEmptyLines = (contents: string) =>
  contents.replace(/(?:\r?\n\s*)+$/, "")

const ensureTrailingNewline = (
  contents: string,
  lineEnding: string,
  shouldPreserveTrailingNewline: boolean
) => {
  if (!shouldPreserveTrailingNewline) return contents
  return contents.endsWith("\n") ? contents : `${contents}${lineEnding}`
}

const removePublishedSectionForNetwork = (
  contents: string,
  networkName: string
): { updatedContents: string; didUpdate: boolean } => {
  return removeMoveTomlSection(contents, `published.${networkName}`)
}

const removeMoveTomlSection = (
  contents: string,
  sectionName: string
): { updatedContents: string; didUpdate: boolean } => {
  const sectionBlock = findSectionBlock(contents, sectionName)
  if (!sectionBlock) return { updatedContents: contents, didUpdate: false }

  const lineEnding = resolveLineEnding(contents)
  const shouldPreserveTrailingNewline = contents.endsWith("\n")
  const before = trimTrailingEmptyLines(contents.slice(0, sectionBlock.start))
  const after = trimLeadingEmptyLines(contents.slice(sectionBlock.end))
  const separator =
    before && after
      ? `${lineEnding}${lineEnding}`
      : before && !after
        ? lineEnding
        : ""
  const combined = `${before}${separator}${after}`

  return {
    updatedContents: ensureTrailingNewline(
      combined,
      lineEnding,
      shouldPreserveTrailingNewline
    ),
    didUpdate: true
  }
}

const hasDepReplacementSection = (contents: string, environmentName: string) =>
  new RegExp(
    `^\\s*\\[dep-replacements\\.${escapeRegExp(environmentName)}\\]\\s*(#.*)?$`,
    "m"
  ).test(contents)

const hasEnvironmentEntry = (contents: string, environmentName: string) => {
  const environmentBlock = findSectionBlock(contents, "environments")
  if (!environmentBlock) return false

  const entryRegex = new RegExp(
    `^\\s*${escapeRegExp(environmentName)}\\s*=\\s*"[^"]*"\\s*(#.*)?$`
  )

  return environmentBlock.block
    .split(/\r?\n/)
    .some((line) => entryRegex.test(line))
}

const resolveSectionEntryIndent = (lines: string[], headerIndex: number) => {
  const entryLine = lines.slice(headerIndex + 1).find((line) => {
    const trimmed = line.trim()
    return trimmed.length > 0 && !trimmed.startsWith("#")
  })
  return entryLine?.match(/^\s*/)?.[0] ?? ""
}

const updateEnvironmentBlock = ({
  block,
  environmentName,
  chainId
}: {
  block: string
  environmentName: string
  chainId: string
}): { updatedBlock: string; didUpdate: boolean } => {
  const lineEnding = resolveLineEnding(block)
  const lines = block.split(/\r?\n/)
  const headerIndex = lines.findIndex((line) =>
    /^\s*\[environments\]\s*(#.*)?$/.test(line)
  )
  if (headerIndex < 0) return { updatedBlock: block, didUpdate: false }

  const escapedEnvironmentName = escapeRegExp(environmentName)
  const entryRegex = new RegExp(
    `^(\\s*)${escapedEnvironmentName}\\s*=\\s*"([^"]*)"(?:(\\s*#.*))?$`
  )
  const entryIndex = lines.findIndex((line) => entryRegex.test(line))

  if (entryIndex >= 0) {
    const match = lines[entryIndex]?.match(entryRegex)
    const existingChainId = match?.[2]
    if (existingChainId === chainId) {
      return { updatedBlock: block, didUpdate: false }
    }
    const indent = match?.[1] ?? ""
    const commentSuffix = match?.[3] ?? ""
    lines[entryIndex] =
      `${indent}${environmentName} = "${chainId}"${commentSuffix}`
    return { updatedBlock: lines.join(lineEnding), didUpdate: true }
  }

  const indent = resolveSectionEntryIndent(lines, headerIndex)
  const lastContentIndex = (() => {
    for (let index = lines.length - 1; index > headerIndex; index -= 1) {
      if (lines[index].trim().length > 0) return index
    }
    return headerIndex
  })()
  const insertIndex = lastContentIndex + 1
  lines.splice(insertIndex, 0, `${indent}${environmentName} = "${chainId}"`)
  return { updatedBlock: lines.join(lineEnding), didUpdate: true }
}

const updateDependencyReplacementBlock = ({
  block,
  dependencyName,
  replacementEntry
}: {
  block: string
  dependencyName: string
  replacementEntry: string
}): { updatedBlock: string; didUpdate: boolean } => {
  const lineEnding = resolveLineEnding(block)
  const lines = block.split(/\r?\n/)
  const headerIndex = lines.findIndex((line) =>
    /^\s*\[dep-replacements\.[^\]]+\]\s*(#.*)?$/.test(line)
  )
  if (headerIndex < 0) return { updatedBlock: block, didUpdate: false }

  const escapedDependencyName = escapeRegExp(dependencyName)
  const entryRegex = new RegExp(
    `^(\\s*)${escapedDependencyName}\\s*=\\s*\\{[^}]*\\}(?:(\\s*#.*))?$`
  )
  const entryIndex = lines.findIndex((line) => entryRegex.test(line))

  if (entryIndex >= 0) {
    const match = lines[entryIndex]?.match(entryRegex)
    const indent = match?.[1] ?? ""
    const commentSuffix = match?.[2] ?? ""
    const nextLine = `${indent}${replacementEntry}${commentSuffix}`
    if (lines[entryIndex] === nextLine)
      return { updatedBlock: block, didUpdate: false }
    lines[entryIndex] = nextLine
    return { updatedBlock: lines.join(lineEnding), didUpdate: true }
  }

  const indent = resolveSectionEntryIndent(lines, headerIndex)
  const lastContentIndex = (() => {
    for (let index = lines.length - 1; index > headerIndex; index -= 1) {
      if (lines[index].trim().length > 0) return index
    }
    return headerIndex
  })()
  const insertIndex = lastContentIndex + 1
  lines.splice(insertIndex, 0, `${indent}${replacementEntry}`)
  return { updatedBlock: lines.join(lineEnding), didUpdate: true }
}

const insertDepReplacementBlock = (contents: string, block: string): string => {
  const lineEnding = resolveLineEnding(contents)
  const normalizedBlock = block.split(/\r?\n/).join(lineEnding)
  const prefix = contents.endsWith("\n") ? contents : `${contents}${lineEnding}`
  return `${prefix}${normalizedBlock}${lineEnding}`
}

const updateMoveTomlDependencyReplacement = ({
  contents,
  environmentName,
  dependencyName,
  replacementEntry
}: {
  contents: string
  environmentName: string
  dependencyName: string
  replacementEntry: string
}): { updatedContents: string; didUpdate: boolean } => {
  const lineEnding = resolveLineEnding(contents)
  const sectionName = `dep-replacements.${environmentName}`
  const sectionBlock = findSectionBlock(contents, sectionName)
  const newEntryBlock = `[${sectionName}]${lineEnding}${replacementEntry}`

  if (!sectionBlock) {
    return {
      updatedContents: insertDepReplacementBlock(contents, newEntryBlock),
      didUpdate: true
    }
  }

  const { updatedBlock, didUpdate } = updateDependencyReplacementBlock({
    block: sectionBlock.block,
    dependencyName,
    replacementEntry
  })
  if (!didUpdate) return { updatedContents: contents, didUpdate: false }

  return {
    updatedContents:
      contents.slice(0, sectionBlock.start) +
      updatedBlock +
      contents.slice(sectionBlock.end),
    didUpdate: true
  }
}

const updateDependenciesBlockEntry = ({
  block,
  dependencyName,
  replacementEntry
}: {
  block: string
  dependencyName: string
  replacementEntry: string
}): { updatedBlock: string; didUpdate: boolean } => {
  const lineEnding = resolveLineEnding(block)
  const lines = block.split(/\r?\n/)
  const headerIndex = lines.findIndex((line) =>
    /^\s*\[dependencies\]\s*(#.*)?$/.test(line)
  )
  if (headerIndex < 0) return { updatedBlock: block, didUpdate: false }

  const escapedDependencyName = escapeRegExp(dependencyName)
  const entryRegex = new RegExp(
    `^(\\s*)${escapedDependencyName}\\s*=\\s*\\{[^}]*\\}(?:(\\s*#.*))?$`
  )
  const entryIndex = lines.findIndex((line) => entryRegex.test(line))

  if (entryIndex >= 0) {
    const match = lines[entryIndex]?.match(entryRegex)
    const indent = match?.[1] ?? ""
    const commentSuffix = match?.[2] ?? ""
    const nextLine = `${indent}${replacementEntry}${commentSuffix}`
    if (lines[entryIndex] === nextLine)
      return { updatedBlock: block, didUpdate: false }
    lines[entryIndex] = nextLine
    return { updatedBlock: lines.join(lineEnding), didUpdate: true }
  }

  const indent = resolveSectionEntryIndent(lines, headerIndex)
  const lastContentIndex = (() => {
    for (let index = lines.length - 1; index > headerIndex; index -= 1) {
      if (lines[index].trim().length > 0) return index
    }
    return headerIndex
  })()
  const insertIndex = lastContentIndex + 1
  lines.splice(insertIndex, 0, `${indent}${replacementEntry}`)
  return { updatedBlock: lines.join(lineEnding), didUpdate: true }
}

const updateMoveTomlDependencySource = ({
  contents,
  dependencyName,
  replacementEntry
}: {
  contents: string
  dependencyName: string
  replacementEntry: string
}): { updatedContents: string; didUpdate: boolean } => {
  const lineEnding = resolveLineEnding(contents)
  const sectionBlock = findSectionBlock(contents, "dependencies")
  const newEntryBlock = `[dependencies]${lineEnding}${replacementEntry}`

  if (!sectionBlock) {
    return {
      updatedContents: insertDepReplacementBlock(contents, newEntryBlock),
      didUpdate: true
    }
  }

  const { updatedBlock, didUpdate } = updateDependenciesBlockEntry({
    block: sectionBlock.block,
    dependencyName,
    replacementEntry
  })
  if (!didUpdate) return { updatedContents: contents, didUpdate: false }

  return {
    updatedContents:
      contents.slice(0, sectionBlock.start) +
      updatedBlock +
      contents.slice(sectionBlock.end),
    didUpdate: true
  }
}

const parseDependencyReplacementEntry = ({
  block,
  dependencyName
}: {
  block: string
  dependencyName: string
}):
  | { publishedAt?: string; originalId?: string; local?: string }
  | undefined => {
  const escapedDependencyName = escapeRegExp(dependencyName)
  const entryRegex = new RegExp(
    `^\\s*${escapedDependencyName}\\s*=\\s*\\{([^}]*)\\}\\s*$`
  )
  const lines = block.split(/\r?\n/)

  for (const line of lines) {
    if (/^\s*\[.+\]\s*(#.*)?$/.test(line)) continue
    const sanitized = line.split("#")[0]?.trim()
    if (!sanitized) continue
    const match = sanitized.match(entryRegex)
    if (!match) continue

    const entryBody = match[1] ?? ""
    const extractField = (fieldName: string) =>
      entryBody.match(
        new RegExp(`${escapeRegExp(fieldName)}\\s*=\\s*"([^"]+)"`, "i")
      )?.[1]

    return {
      publishedAt: extractField("published-at"),
      originalId: extractField("original-id"),
      local: extractField("local")
    }
  }

  return undefined
}

export const readMoveTomlDependencyReplacement = async ({
  moveTomlPath,
  environmentName,
  dependencyName
}: {
  moveTomlPath: string
  environmentName: string
  dependencyName: string
}): Promise<
  { publishedAt?: string; originalId?: string; local?: string } | undefined
> => {
  const contents = await fs.readFile(moveTomlPath, "utf8")
  const sectionName = `dep-replacements.${environmentName}`
  const sectionBlock = findSectionBlock(contents, sectionName)
  if (!sectionBlock) return undefined

  return parseDependencyReplacementEntry({
    block: sectionBlock.block,
    dependencyName
  })
}

export const syncMoveTomlDependencyReplacementEntry = async ({
  moveTomlPath,
  environmentName,
  dependencyName,
  replacementEntry,
  dryRun = false
}: {
  moveTomlPath: string
  environmentName: string
  dependencyName: string
  replacementEntry: string
  dryRun?: boolean
}): Promise<{ moveTomlPath: string; didUpdate: boolean }> => {
  const contents = await fs.readFile(moveTomlPath, "utf8")
  const { updatedContents, didUpdate } = updateMoveTomlDependencyReplacement({
    contents,
    environmentName,
    dependencyName,
    replacementEntry
  })

  if (didUpdate && !dryRun) {
    await fs.writeFile(moveTomlPath, updatedContents)
  }

  return { moveTomlPath, didUpdate }
}

const insertEnvironmentBlock = (contents: string, block: string): string => {
  const lineEnding = resolveLineEnding(contents)
  const normalizedBlock = block.split(/\r?\n/).join(lineEnding)
  const insertionMatch = contents.match(
    /^\s*\[(addresses|dev-dependencies)\]\s*(#.*)?$/m
  )

  if (insertionMatch?.index === undefined) {
    const prefix = contents.endsWith("\n")
      ? contents
      : `${contents}${lineEnding}`
    return `${prefix}${normalizedBlock}${lineEnding}`
  }

  const before = contents.slice(0, insertionMatch.index)
  const after = contents.slice(insertionMatch.index)

  const prefix = before.endsWith("\n") ? before : `${before}${lineEnding}`
  const suffix =
    after.startsWith("\n") || after.startsWith("\r\n")
      ? after
      : `${lineEnding}${after}`

  return `${prefix}${normalizedBlock}${suffix}`
}

const updateMoveTomlEnvironmentChainId = ({
  contents,
  environmentName,
  chainId
}: {
  contents: string
  environmentName: string
  chainId: string
}): { updatedContents: string; didUpdate: boolean } => {
  const lineEnding = resolveLineEnding(contents)
  const shouldManageEnvironment =
    hasDepReplacementSection(contents, environmentName) ||
    hasEnvironmentEntry(contents, environmentName)

  if (!shouldManageEnvironment) {
    return { updatedContents: contents, didUpdate: false }
  }

  const environmentBlock = findSectionBlock(contents, "environments")
  const newEntryBlock = `[environments]${lineEnding}${environmentName} = "${chainId}"`

  if (!environmentBlock) {
    return {
      updatedContents: insertEnvironmentBlock(contents, newEntryBlock),
      didUpdate: true
    }
  }

  const { updatedBlock, didUpdate } = updateEnvironmentBlock({
    block: environmentBlock.block,
    environmentName,
    chainId
  })
  if (!didUpdate) return { updatedContents: contents, didUpdate: false }

  return {
    updatedContents:
      contents.slice(0, environmentBlock.start) +
      updatedBlock +
      contents.slice(environmentBlock.end),
    didUpdate: true
  }
}

const forceMoveTomlEnvironmentChainId = ({
  contents,
  environmentName,
  chainId
}: {
  contents: string
  environmentName: string
  chainId: string
}): { updatedContents: string; didUpdate: boolean } => {
  const lineEnding = resolveLineEnding(contents)
  const environmentBlock = findSectionBlock(contents, "environments")
  const newEntryBlock = `[environments]${lineEnding}${environmentName} = "${chainId}"`

  if (!environmentBlock) {
    return {
      updatedContents: insertEnvironmentBlock(contents, newEntryBlock),
      didUpdate: true
    }
  }

  const { updatedBlock, didUpdate } = updateEnvironmentBlock({
    block: environmentBlock.block,
    environmentName,
    chainId
  })
  if (!didUpdate) return { updatedContents: contents, didUpdate: false }

  return {
    updatedContents:
      contents.slice(0, environmentBlock.start) +
      updatedBlock +
      contents.slice(environmentBlock.end),
    didUpdate: true
  }
}

/**
 * Resolves the chain identifier from RPC, falling back to Sui CLI env config.
 */
export const resolveChainIdentifier = async (
  { environmentName }: { environmentName?: string },
  { suiClient }: ToolingContext
): Promise<string | undefined> => {
  try {
    return await suiClient.getChainIdentifier()
  } catch {
    return await getSuiCliEnvironmentChainId(environmentName)
  }
}

/**
 * Ensures the Move.toml environments entry matches the localnet chain id.
 * The localnet environment name is normalized to `test-publish`.
 * Use dryRun to report drift without writing changes.
 */
export const syncLocalnetMoveEnvironmentChainId = async (
  {
    moveRootPath,
    environmentName,
    dryRun = false
  }: {
    moveRootPath: string
    environmentName: string | undefined
    dryRun?: boolean
  },
  toolingContext: ToolingContext
): Promise<MoveEnvironmentChainIdSyncResult> => {
  const resolvedEnvironmentName = resolveMoveCliEnvironmentName(environmentName)
  if (resolvedEnvironmentName !== "test-publish")
    return { updatedFiles: [], didAttempt: false }

  const chainIdEnvironmentName =
    environmentName === "test-publish" ? "localnet" : environmentName
  const chainId = await resolveChainIdentifier(
    { environmentName: chainIdEnvironmentName },
    toolingContext
  )

  if (!chainId) return { updatedFiles: [], chainId, didAttempt: true }

  const { updatedFiles } = await syncMoveEnvironmentChainId({
    moveRootPath,
    environmentName: resolvedEnvironmentName,
    chainId,
    dryRun
  })

  return { updatedFiles, chainId, didAttempt: true }
}

/**
 * Syncs Move.toml environment chain IDs under the provided move root.
 * Use dryRun to report potential updates without writing files.
 */
export const syncMoveEnvironmentChainId = async ({
  moveRootPath,
  environmentName,
  chainId,
  dryRun = false
}: {
  moveRootPath: string
  environmentName: string
  chainId: string
  dryRun?: boolean
}): Promise<MoveEnvironmentSyncResult> => {
  const updatedFiles: string[] = []

  try {
    const moveTomlFiles = await listMoveTomlFiles(moveRootPath)
    await Promise.all(
      moveTomlFiles.map(async (moveTomlPath) => {
        const contents = await fs.readFile(moveTomlPath, "utf8")
        const { updatedContents, didUpdate } = updateMoveTomlEnvironmentChainId(
          {
            contents,
            environmentName,
            chainId
          }
        )
        if (!didUpdate) return
        if (!dryRun) {
          await fs.writeFile(moveTomlPath, updatedContents)
        }
        updatedFiles.push(moveTomlPath)
      })
    )
  } catch (error) {
    logWarning(
      `Failed to sync Move.toml environments under ${moveRootPath}: ${formatErrorMessage(
        error
      )}`
    )
  }

  return { updatedFiles }
}

export const syncMoveTomlDependencyPublishedIds = async ({
  moveTomlPath,
  environmentName,
  dependencyName,
  publishedAt,
  originalId,
  dryRun = false
}: {
  moveTomlPath: string
  environmentName: string
  dependencyName: string
  publishedAt: string
  originalId: string
  dryRun?: boolean
}): Promise<{ moveTomlPath: string; didUpdate: boolean }> => {
  const replacementEntry = `${dependencyName} = { published-at = "${publishedAt}", original-id = "${originalId}" }`
  return await syncMoveTomlDependencyReplacementEntry({
    moveTomlPath,
    environmentName,
    dependencyName,
    replacementEntry,
    dryRun
  })
}

export const syncMoveTomlDependencyLocalPath = async ({
  moveTomlPath,
  dependencyName,
  localPath,
  dryRun = false
}: {
  moveTomlPath: string
  dependencyName: string
  localPath: string
  dryRun?: boolean
}): Promise<{ moveTomlPath: string; didUpdate: boolean }> => {
  const replacementEntry = `${dependencyName} = { local = "${localPath}" }`
  const contents = await fs.readFile(moveTomlPath, "utf8")
  const { updatedContents, didUpdate } = updateMoveTomlDependencySource({
    contents,
    dependencyName,
    replacementEntry
  })

  if (didUpdate && !dryRun) {
    await fs.writeFile(moveTomlPath, updatedContents)
  }

  return { moveTomlPath, didUpdate }
}

export const ensureMoveTomlEnvironmentChainId = async ({
  moveTomlPath,
  environmentName,
  chainId,
  dryRun = false
}: {
  moveTomlPath: string
  environmentName: string
  chainId: string
  dryRun?: boolean
}): Promise<{ moveTomlPath: string; didUpdate: boolean }> => {
  const contents = await fs.readFile(moveTomlPath, "utf8")
  const { updatedContents, didUpdate } = forceMoveTomlEnvironmentChainId({
    contents,
    environmentName,
    chainId
  })

  if (didUpdate && !dryRun) {
    await fs.writeFile(moveTomlPath, updatedContents)
  }

  return { moveTomlPath, didUpdate }
}

export const removeMoveTomlAddressesSection = async ({
  moveTomlPath,
  dryRun = false
}: {
  moveTomlPath: string
  dryRun?: boolean
}): Promise<{ moveTomlPath: string; didUpdate: boolean }> => {
  const contents = await fs.readFile(moveTomlPath, "utf8")
  const { updatedContents, didUpdate } = removeMoveTomlSection(
    contents,
    "addresses"
  )

  if (didUpdate && !dryRun) {
    await fs.writeFile(moveTomlPath, updatedContents)
  }

  return { moveTomlPath, didUpdate }
}

export const clearPublishedEntryForNetwork = async ({
  packagePath,
  networkName
}: {
  packagePath: string
  networkName: string | undefined
}): Promise<{ publishedTomlPath: string; didUpdate: boolean }> => {
  const publishedTomlPath = path.join(packagePath, "Published.toml")
  if (!networkName) return { publishedTomlPath, didUpdate: false }

  let contents: string
  try {
    contents = await fs.readFile(publishedTomlPath, "utf8")
  } catch (error) {
    if (isErrnoWithCode(error, "ENOENT"))
      return { publishedTomlPath, didUpdate: false }
    throw error
  }

  const resolvedEnvironmentName = resolveMoveCliEnvironmentName(networkName)
  const targetNetworks = new Set<string>([networkName])
  if (resolvedEnvironmentName) targetNetworks.add(resolvedEnvironmentName)

  let updatedContents = contents
  let didUpdate = false

  for (const targetNetwork of targetNetworks) {
    const result = removePublishedSectionForNetwork(
      updatedContents,
      targetNetwork
    )
    updatedContents = result.updatedContents
    didUpdate = didUpdate || result.didUpdate
  }

  if (!didUpdate) return { publishedTomlPath, didUpdate: false }

  await fs.writeFile(publishedTomlPath, updatedContents)
  return { publishedTomlPath, didUpdate: true }
}
