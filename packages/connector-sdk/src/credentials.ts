import {
  type ConnectorManifest,
  err,
  type FridayError,
  fridayError,
  ok,
  type Result,
} from '@friday/contracts'
import type { OperationContext } from './connector.js'

/**
 * How a connector asks for a credential, and what it gets back.
 *
 * Chapter 14 states the rule this file exists to make structural:
 * **connectors never store, and never see, long-lived credentials.** A
 * connector asks the Credential Broker for a short-lived scoped token, holds
 * it in memory, and lets it expire.
 *
 * What that buys, in the chapter's own terms: a compromised connector leaks a
 * token that dies in minutes rather than a refresh token that lasts forever,
 * every credential use is audited, revocation is instant and central, and the
 * database contains no secrets — so a stolen backup is not a breach of the
 * owner's accounts.
 *
 * ★ **This file is the connector's side of that boundary only.** The broker
 * itself lives in the kernel, holds the Keychain, and performs the exchange.
 * Nothing here obtains, stores, or refreshes a real credential, and nothing
 * here knows how OAuth works.
 *
 * Reference: docs/01-bible/14-connector-framework.md · Chapter 17 · Article V
 */

/** What a connector must say to be given anything. */
export interface CredentialRequest {
  /** Which connector is asking. The broker checks this against the manifest. */
  readonly connectorId: string

  /**
   * Which operation it is asking for.
   *
   * ★ Present so the audit trail records *why* a credential was issued, not
   * merely that it was. "The calendar connector used your token at 14:02" is
   * far less useful than "…to run `create-event`, for the plan you approved".
   */
  readonly operationId: string

  /** Never wider than the manifest declares — refused otherwise. */
  readonly scopes: readonly string[]

  /** Ties the issuance to the request that caused it. */
  readonly correlationId: string
}

/**
 * A short-lived, scoped credential.
 *
 * ★ **The secret is behind a method call, and everything else redacts.**
 * `toString` and `toJSON` both yield a placeholder, so a template literal, a
 * `JSON.stringify`, a thrown error, and a log line all produce
 * `[redacted credential]` rather than the token. Getting the actual value
 * requires calling `reveal()`, which is a single greppable word in review.
 *
 * Chapter 22 puts a redaction layer in the logger, and this is deliberately
 * not relying on it: that layer is a second line of defence, and a secret
 * that never reaches it is better than one it has to catch.
 */
export interface IssuedCredential {
  readonly connectorId: string
  readonly scopes: readonly string[]

  /** When this stops working. Short by design — minutes, not days. */
  readonly expiresAt: number

  /** The secret. Deliberately awkward to reach by accident. */
  reveal(): string

  toString(): string
  toJSON(): string
}

/** What the kernel's broker must implement. Nothing here implements it. */
export interface CredentialBroker {
  issue(request: CredentialRequest): Promise<Result<IssuedCredential, FridayError>>

  /**
   * Withdraw everything issued to a connector.
   *
   * Central and immediate, per Chapter 14: revoking here means every connector
   * loses access at once, rather than each being asked nicely.
   */
  revoke(connectorId: string): Promise<Result<void, FridayError>>
}

const REDACTED = '[redacted credential]'

/**
 * Wraps a raw token so it cannot be printed by accident.
 *
 * @param input - The connector, scopes, expiry, and the secret itself.
 * @returns A credential that redacts everywhere except `reveal()`.
 */
export function issuedCredential(input: {
  readonly connectorId: string
  readonly scopes: readonly string[]
  readonly expiresAt: number
  readonly token: string
}): IssuedCredential {
  // Closed over rather than stored as a property, so it cannot be reached by
  // spreading, enumerating, or serialising the object.
  const secret = input.token

  return {
    connectorId: input.connectorId,
    scopes: [...input.scopes],
    expiresAt: input.expiresAt,
    reveal: () => secret,
    toString: () => REDACTED,
    toJSON: () => REDACTED,
  }
}

/**
 * Whether a credential is still usable.
 *
 * @param credential - The credential in hand.
 * @param now - The current time.
 * @returns True while it has not expired.
 */
export function isCredentialLive(credential: IssuedCredential, now: number): boolean {
  return now < credential.expiresAt
}

/**
 * Checks a request against what the connector actually declared.
 *
 * ★ Chapter 14: *"Scope minimization is enforced at issuance. A connector
 * declaring `calendar.readonly` receives a token with only that scope, even if
 * the underlying OAuth grant is broader."* This is the check that makes that
 * sentence true — the narrowest point in the system, and the right place to
 * refuse.
 *
 * Refusing is not a failure to be retried. A connector asking for a scope it
 * did not declare is either a bug or an overreach, and both want a human.
 *
 * @param manifest - The asking connector's manifest.
 * @param request - What it asked for.
 * @returns The approved scopes, or a refusal naming the first bad one.
 */
export function checkRequestedScopes(
  manifest: ConnectorManifest,
  request: CredentialRequest,
): Result<readonly string[], FridayError> {
  if (request.connectorId !== manifest.id) {
    return err(
      fridayError({
        code: 'SCOPE_NOT_DECLARED',
        message: `${request.connectorId} asked for a credential belonging to ${manifest.id}.`,
        detail: { asked: request.connectorId, manifest: manifest.id },
        correlationId: request.correlationId,
      }),
    )
  }

  const declared = new Set(manifest.auth.scopes)
  const undeclared = request.scopes.filter((scope) => !declared.has(scope))

  if (undeclared.length > 0) {
    return err(
      fridayError({
        code: 'SCOPE_NOT_DECLARED',
        message: `${manifest.id} asked for ${undeclared.join(', ')}, which it does not declare.`,
        detail: { connector: manifest.id, undeclared },
        correlationId: request.correlationId,
      }),
    )
  }

  // An empty request is not "everything" — it is a connector that forgot to
  // say what it needs, and defaulting it to the full grant is exactly the
  // over-broad issuance the manifest exists to prevent.
  if (request.scopes.length === 0) {
    return err(
      fridayError({
        code: 'SCOPE_NOT_DECLARED',
        message: `${manifest.id} asked for a credential without saying what for.`,
        detail: { connector: manifest.id },
        correlationId: request.correlationId,
      }),
    )
  }

  return ok([...request.scopes])
}

/**
 * Builds the request a connector should send for one operation.
 *
 * @param manifest - The connector's manifest.
 * @param operationId - The operation about to run.
 * @param scopes - The narrowest scopes that operation needs.
 * @param context - The call, for the correlation id.
 * @returns A well-formed request.
 */
export function credentialRequestFor(
  manifest: ConnectorManifest,
  operationId: string,
  scopes: readonly string[],
  context: OperationContext,
): CredentialRequest {
  return {
    connectorId: manifest.id,
    operationId,
    scopes: [...scopes],
    correlationId: context.correlationId,
  }
}
