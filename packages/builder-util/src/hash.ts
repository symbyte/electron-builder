import BluebirdPromise from "bluebird-lst"
import { createHash } from "crypto"
import { createReadStream } from "fs"

export function hashFile(file: string, algorithm: string = "sha512", encoding: "base64" | "hex" = "base64", options?: any) {
  return new BluebirdPromise<string>((resolve, reject) => {
    const hash = createHash(algorithm)
    hash
      .on("error", reject)
      .setEncoding(encoding)

    createReadStream(file, options)
      .on("error", reject)
      .on("end", () => {
        hash.end()
        resolve(hash.read() as string)
      })
      .pipe(hash, {end: false})
  })
}