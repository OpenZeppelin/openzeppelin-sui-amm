import { readdir } from "node:fs/promises"
import path from "node:path"

export const listFilesByNameRecursively = async ({
  rootDir,
  fileName
}: {
  rootDir: string
  fileName: string
}): Promise<string[]> => {
  const entries = await readdir(rootDir, { withFileTypes: true })
  const matchingFiles: string[] = []

  await Promise.all(
    entries.map(async (entry) => {
      const entryPath = path.join(rootDir, entry.name)
      if (entry.isDirectory()) {
        matchingFiles.push(
          ...(await listFilesByNameRecursively({
            rootDir: entryPath,
            fileName
          }))
        )
        return
      }

      if (entry.isFile() && entry.name === fileName) {
        matchingFiles.push(entryPath)
      }
    })
  )

  return matchingFiles
}
