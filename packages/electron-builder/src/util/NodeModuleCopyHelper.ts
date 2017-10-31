import BluebirdPromise from "bluebird-lst"
import { CONCURRENCY, Filter } from "builder-util/out/fs"
import { lstat, readdir, readlink, stat, Stats } from "fs-extra-p"
import * as path from "path"
import { excludedNames, FileMatcher } from "../fileMatcher"
import { Packager } from "../packager"
import { Dependency } from "./packageDependencies"

const excludedFiles = new Set([".DS_Store", "node_modules" /* already in the queue */, "CHANGELOG.md", "ChangeLog", "changelog.md", "binding.gyp"].concat(excludedNames.split(",")))
const topLevelExcludedFiles = new Set(["karma.conf.js", ".coveralls.yml", "README.md", "readme.markdown", "README", "readme.md", "readme", "test", "__tests__", "tests", "powered-test", "example", "examples"])

/** @internal */
export class NodeModuleCopyHelper {
  readonly metadata = new Map<string, Stats>()
  readonly filter: Filter

  constructor(private readonly matcher: FileMatcher, protected readonly packager: Packager) {
    this.filter = matcher.createFilter()
  }

  protected handleFile(file: string, fileStat: Stats) {
    if (!fileStat.isSymbolicLink()) {
      return null
    }

    return readlink(file)
      .then((linkTarget): any => {
        // http://unix.stackexchange.com/questions/105637/is-symlinks-target-relative-to-the-destinations-parent-directory-and-if-so-wh
        return this.handleSymlink(fileStat, file, path.resolve(path.dirname(file), linkTarget))
      })
  }

  protected handleSymlink(fileStat: Stats, file: string, linkTarget: string) {
    const link = path.relative(this.matcher.from, linkTarget)
    if (link.startsWith("..")) {
      // outside of project, linked module (https://github.com/electron-userland/electron-builder/issues/675)
      return stat(linkTarget)
        .then(targetFileStat => {
          this.metadata.set(file, targetFileStat)
          return targetFileStat
        })
    }
    else {
      (fileStat as any).relativeLink = link
    }
    return null
  }

  async collectNodeModules(list: Array<Dependency>): Promise<Array<string>> {
    const filter = this.filter
    const metadata = this.metadata

    const result: Array<string> = []
    const queue: Array<string> = []
    for (const dep of list) {
      queue.length = 1
      queue[0] = dep.path

      if (dep.link != null) {
        this.metadata.set(dep.path, dep.stat!)
        const r = this.handleSymlink(dep.stat!, dep.path, dep.link!)
        if (r != null) {
          await r
        }
      }

      while (queue.length > 0) {
        const dirPath = queue.pop()!

        const childNames = await readdir(dirPath)
        childNames.sort()

        const isTopLevel = dirPath === dep.path
        const dirs: Array<string> = []
        // our handler is async, but we should add sorted files, so, we add file to result not in the mapper, but after map
        const sortedFilePaths = await BluebirdPromise.map(childNames, name => {
          if (excludedFiles.has(name) || name.endsWith(".h") || name.endsWith(".o") || name.endsWith(".obj") || name.endsWith(".cc") || name.endsWith(".pdb") || name.endsWith(".d.ts") || name.endsWith(".suo") || name.endsWith(".npmignore") || name.endsWith(".sln")) {
            return null
          }

          if (isTopLevel && topLevelExcludedFiles.has(name)) {
            return null
          }

          if (dirPath.endsWith("build")) {
            if (name === "gyp-mac-tool" || name === "Makefile" || name.endsWith(".mk") || name.endsWith(".gypi") || name.endsWith(".Makefile")) {
              return null
            }
          }
          else if (dirPath.endsWith("Release") && (name === ".deps" || name === "obj.target")) {
            return null
          }
          else if (name === "src" && (dirPath.endsWith("keytar") || dirPath.endsWith("keytar-prebuild"))) {
            return null
          }
          else if (dirPath.endsWith("lzma-native") && (name === "build" || name === "deps")) {
            return null
          }

          const filePath = dirPath + path.sep + name
          return lstat(filePath)
            .then(stat => {
              if (filter != null && !filter(filePath, stat)) {
                return null
              }

              metadata.set(filePath, stat)
              const consumerResult = this.handleFile(filePath, stat)
              if (consumerResult == null || !("then" in consumerResult)) {
                if (stat.isDirectory()) {
                  dirs.push(name)
                  return null
                }
                else {
                  return filePath
                }
              }
              else {
                return (consumerResult as Promise<any>)
                  .then(it => {
                    // asarUtil can return modified stat (symlink handling)
                    if ((it != null && "isDirectory" in it ? (it as Stats) : stat).isDirectory()) {
                      dirs.push(name)
                      return null
                    }
                    else {
                      return filePath
                    }
                  })
              }
            })
        }, CONCURRENCY)

        for (const child of sortedFilePaths) {
          if (child != null) {
            result.push(child)
          }
        }

        dirs.sort()
        for (const child of dirs) {
          queue.push(dirPath + path.sep + child)
        }
      }
    }
    return result
  }
}