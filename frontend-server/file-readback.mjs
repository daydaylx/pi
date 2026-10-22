import { constants, openSync, fstatSync, readSync, closeSync } from "node:fs";
import { createHash } from "node:crypto";
import path from "node:path";

// A deliberately narrow, bounded goal predicate; no shell, arbitrary evaluator,
// or frontend-supplied success bit. Other goal types remain VERIFYING.
export function readFileGoal(filePath, expectedSha256) {
  if (!path.isAbsolute(filePath) || !/^[a-f0-9]{64}$/.test(expectedSha256))
    throw new Error("An absolute file path and expected SHA-256 are required");
  const fd = openSync(
    filePath,
    constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK,
  );
  try {
    const stat = fstatSync(fd);
    if (!stat.isFile() || stat.size > 16 * 1024 * 1024)
      throw new Error("Readback requires a regular file of at most 16 MiB");
    // Read a bounded amount even if another process grows the file after fstat.
    const buffer = Buffer.alloc(Number(stat.size) + 1);
    let length = 0;
    while (length < buffer.length) {
      const bytes = readSync(fd, buffer, length, buffer.length - length, null);
      if (!bytes) break;
      length += bytes;
    }
    if (length !== stat.size)
      throw new Error("File changed size during readback");
    const actualSha256 = createHash("sha256")
      .update(buffer.subarray(0, length))
      .digest("hex");
    return {
      filePath,
      expectedSha256,
      actualSha256,
      passed: actualSha256 === expectedSha256,
    };
  } finally {
    closeSync(fd);
  }
}
