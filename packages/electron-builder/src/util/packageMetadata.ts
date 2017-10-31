import { isEmptyOrSpaces, log, warn } from "builder-util"
import { readFile, readJson } from "fs-extra-p"
import * as path from "path"
import { Metadata } from "../options/metadata"

const normalizeData = require("normalize-package-data")

/** @internal */
export async function readPackageJson(file: string): Promise<any> {
  const data = await readJson(file)
  await authors(file, data)
  normalizeData(data)
  return data
}

async function authors(file: string, data: any) {
  if (data.contributors != null) {
    return
  }

  let authorData
  try {
    authorData = await readFile(path.resolve(path.dirname(file), "AUTHORS"), "utf8")
  }
  catch (ignored) {
    return
  }

  data.contributors = authorData
    .split(/\r?\n/g)
    .map(it => it.replace(/^\s*#.*$/, "").trim())
}

/** @internal */
export function checkMetadata(metadata: Metadata, devMetadata: any | null, appPackageFile: string, devAppPackageFile: string): void {
  const errors: Array<string> = []
  const reportError = (missedFieldName: string) => {
    errors.push(`Please specify '${missedFieldName}' in the package.json (${appPackageFile})`)
  }

  const checkNotEmpty = (name: string, value: string | null | undefined) => {
    if (isEmptyOrSpaces(value)) {
      reportError(name)
    }
  }

  if ((metadata as any).directories != null) {
    errors.push(`"directories" in the root is deprecated, please specify in the "build"`)
  }

  checkNotEmpty("name", metadata.name)

  if (isEmptyOrSpaces(metadata.description)) {
    warn(`description is missed in the package.json (${appPackageFile})`)
  }
  if (!metadata.author) {
    warn(`author is missed in the package.json (${appPackageFile})`)
  }
  checkNotEmpty("version", metadata.version)

  if (devMetadata != null) {
    checkDependencies(devMetadata.dependencies, errors)
  }
  if (metadata !== devMetadata) {
    checkDependencies(metadata.dependencies, errors)

    if (metadata.build != null) {
      errors.push(`'build' in the application package.json (${appPackageFile}) is not supported since 3.0 anymore. Please move 'build' into the development package.json (${devAppPackageFile})`)
    }
  }

  const devDependencies = (metadata as any).devDependencies
  if (devDependencies != null && "electron-rebuild" in devDependencies) {
    log('electron-rebuild not required if you use electron-builder, please consider to remove excess dependency from devDependencies\n\nTo ensure your native dependencies are always matched electron version, simply add script `"postinstall": "electron-builder install-app-deps" to your `package.json`')
  }

  if (errors.length > 0) {
    throw new Error(errors.join("\n"))
  }
}

function checkDependencies(dependencies: { [key: string]: string } | null | undefined, errors: Array<string>) {
  if (dependencies == null) {
    return
  }

  const deps = ["electron", "electron-prebuilt", "electron-rebuild"]
  if (process.env.ALLOW_ELECTRON_BUILDER_AS_PRODUCTION_DEPENDENCY !== "true") {
    deps.push("electron-builder")
  }
  for (const name of deps) {
    if (name in dependencies) {
      errors.push(`Package "${name}" is only allowed in "devDependencies". `
        + `Please remove it from the "dependencies" section in your package.json.`)
    }
  }
}