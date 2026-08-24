import { readdirSync, readFileSync, statSync } from 'node:fs'
import { join } from 'node:path'
import {
  type DepartmentManifest,
  DepartmentManifestSchema,
  err,
  type FridayError,
  fridayError,
  ok,
  type Result,
} from '@friday/contracts'

/**
 * Reading the departments FRIDAY actually has.
 *
 * ★ **The manifest is the security boundary** (ADR-0007), so this function
 * decides the whole of what FRIDAY can do. A capability that is not declared
 * in a manifest here cannot be routed to, cannot be authorized, and cannot
 * run. That is why nothing is skipped: a department folder whose manifest
 * failed to parse would silently remove capabilities, and "FRIDAY says she
 * cannot do that" would be indistinguishable from a typo in a JSON file.
 *
 * ★ **An empty directory is not an error, and a malformed one is.** The
 * asymmetry is deliberate and is the opposite of `loadPolicySet`'s. A Guardian
 * with no rules refuses everything while looking strict — dangerous. FRIDAY
 * with no departments can simply do nothing, which is merely useless, and the
 * caller can say so plainly instead of refusing to start.
 *
 * Reference: docs/01-bible/13-department-architecture.md · docs/adr/0007
 */

/** The file every department directory must contain. */
const MANIFEST = 'department.json'

/**
 * Loads every department manifest under a directory.
 *
 * @param directory - `paths.departmentsDir`. Each immediate subdirectory is a
 *   department and must contain a `department.json`.
 * @returns The manifests, sorted by id so composition is deterministic, or the
 *   first one that could not be read.
 */
export function loadDepartments(
  directory: string,
): Result<readonly DepartmentManifest[], FridayError> {
  let entries: string[]

  try {
    entries = readdirSync(directory).sort()
  } catch (cause) {
    return err(
      fridayError({
        code: 'CONFIG_INVALID',
        message:
          `FRIDAY looked for her departments in ${directory} and there is no such folder.\n\n` +
          '  That is where what she can do is declared. Create it, or point ' +
          'FRIDAY_DEPARTMENTS_DIR somewhere that exists.',
        detail: { directory },
        cause,
      }),
    )
  }

  const manifests: DepartmentManifest[] = []
  const seen = new Set<string>()

  for (const entry of entries) {
    const path = join(directory, entry, MANIFEST)
    if (!isFile(path)) continue

    const loaded = readManifest(path)
    if (!loaded.ok) return loaded

    // ★ Two departments claiming one id is two answers to "who does this?".
    // The router would take the first and the second would be unreachable —
    // and nothing would say so.
    if (seen.has(loaded.value.id)) {
      return err(
        fridayError({
          code: 'CONFIG_INVALID',
          message:
            `Two departments are both called "${loaded.value.id}". ` +
            'A department id is how FRIDAY decides who does a thing, so it has to be unique.',
          detail: { id: loaded.value.id, path },
        }),
      )
    }

    seen.add(loaded.value.id)
    manifests.push(loaded.value)
  }

  return ok(manifests.sort((left, right) => left.id.localeCompare(right.id)))
}

/**
 * A directory entry that is not a department is passed over.
 *
 * ★ Only a *missing manifest* is passed over — never a malformed one. A
 * `README.md` or a `_template` folder is not a department and never claimed to
 * be; a `department.json` that will not parse is a department that meant to be
 * one, and dropping it quietly is how a capability disappears.
 */
function isFile(path: string): boolean {
  try {
    return statSync(path).isFile()
  } catch {
    return false
  }
}

function readManifest(path: string): Result<DepartmentManifest, FridayError> {
  let contents: unknown

  try {
    contents = JSON.parse(readFileSync(path, 'utf8')) as unknown
  } catch (cause) {
    return err(
      fridayError({
        code: 'CONFIG_INVALID',
        message: `A department manifest is not valid JSON, so FRIDAY will not load it: ${path}`,
        detail: { path },
        cause,
      }),
    )
  }

  const parsed = DepartmentManifestSchema.safeParse(contents)

  if (!parsed.success) {
    return err(
      fridayError({
        code: 'CONFIG_INVALID',
        message:
          `A department manifest is malformed and FRIDAY will not load it: ${path}\n\n` +
          '  A manifest declares what she is allowed to do, so she will not ' +
          'guess at one she cannot read.',
        detail: { path, issues: parsed.error.issues.map((issue) => issue.path.join('.')) },
      }),
    )
  }

  return ok(parsed.data)
}
