import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
/** Exact V1 source from production 69a7442; only import paths adapted for fixtures. */
export function verifyV1Integrity() {
  for (const [file, expected] of [
    [
      "ma-confluence-entry.ts",
      "a2d8fabb7154e662999b5f88d04984ab72ab7d7b9e90156056e851cb92a2c109",
    ],
    [
      "trade-guide.ts",
      "ffdf6e0648cf0fed2b7cea27022ad3d3937b5e86dfd9c4b55f70162693f11212",
    ],
  ]) {
    const bytes = readFileSync(
      new URL(
        "../../apps/web/tests/fixtures/ma-entry-v1/" + file,
        import.meta.url,
      ),
    );
    assert.equal(
      createHash("sha256").update(bytes).digest("hex"),
      expected,
      "Immutable V1 fixture changed: " + file,
    );
  }
}
