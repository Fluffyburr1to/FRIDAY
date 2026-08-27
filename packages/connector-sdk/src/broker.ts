import {
  type Actor,
  type ConnectorManifest,
  err,
  type FridayError,
  fridayError,
  ok,
  type Result,
} from '@friday/contracts'
import {
  type CredentialBroker,
  type CredentialRequest,
  checkRequestedScopes,
  type IssuedCredential,
  issuedCredential,
  type RevocationRequest,
} from './credentials.js'

/**
 * The Credential Broker: the one thing that turns a stored secret into
 * something a connector may hold.
 *
 * ★ **The boundary, not the address.** [Chapter 14](../../../docs/01-bible/14-connector-framework.md)
 * calls this a kernel-level concern, meaning it is *not part of any
 * connector*. The lifecycle and the security semantics live here; where the
 * secret actually rests is supplied through a port, so this package depends on
 * nothing but `contracts` and the event bus never learns that connectors
 * exist.
 *
 * What the broker refuses, and why each refusal is its own answer:
 *
 *  - **A scope the manifest does not declare.** Chapter 14's scope
 *    minimisation, enforced at issuance — the narrowest point in the system.
 *  - **A credential that was revoked.** The store answers `revoked` rather
 *    than `absent`, and the broker passes that through unchanged, because
 *    *"you disconnected this"* and *"this was never set up"* need different
 *    answers.
 *
 * Reference: docs/01-bible/14-connector-framework.md · ADR-0050
 */

/**
 * Where secrets rest, as the broker needs them.
 *
 * ★ Deliberately two methods. The broker reads and revokes; it never
 * provisions. Setting a credential up is an owner-initiated act with its own
 * authorization, and a broker that could also write would be a broker that
 * could quietly replace a credential it was merely asked to fetch.
 */
export interface CredentialSource {
  read(connectorId: string): Result<string, FridayError>
  revoke(connectorId: string): Result<void, FridayError>
}

/** Told about issuance and revocation, so both reach the audit trail. */
export interface CredentialObserver {
  readonly onIssued?:
    | ((event: {
        readonly connectorId: string
        readonly operationId: string
        readonly scopes: readonly string[]
        readonly expiresAt: number
        readonly correlationId: string
      }) => void)
    | undefined

  readonly onRevoked?:
    | ((event: {
        readonly connectorId: string
        readonly requestedBy: Actor
        readonly reason: string
      }) => void)
    | undefined
}

export interface BrokerOptions {
  readonly manifests: readonly ConnectorManifest[]
  readonly source: CredentialSource
  readonly now: () => number
  readonly observer?: CredentialObserver | undefined

  /** How long a connector may hold what it is given. See `DEFAULT_LEASE_MS`. */
  readonly leaseMs?: number | undefined
}

/**
 * How long an issued credential stays usable in the connector's hands.
 *
 * ★★ **This is a lease on the handle, not a token lifetime from a provider.**
 * Chapter 14 describes a broker that exchanges a refresh token for a
 * short-lived access token, and that exchange is provider-specific and does
 * not exist yet. For a static secret — an API key — nothing upstream expires,
 * so what this bounds is how long a connector may keep holding the value
 * before asking again.
 *
 * That is worth having on its own: it caps how long a compromised connector
 * retains a usable copy, and it forces every use through the broker where it
 * is checked and recorded. But it must not be mistaken for the provider having
 * limited anything. **The real short-lived token arrives with the first
 * connector that authenticates**, as part of that connector's decision.
 */
export const DEFAULT_LEASE_MS = 15 * 60 * 1_000

/**
 * Builds the broker.
 *
 * @param options - The manifests it will honour, where secrets rest, a clock,
 *   and an optional observer.
 * @returns A broker over exactly those manifests.
 */
export function createCredentialBroker(options: BrokerOptions): CredentialBroker {
  const leaseMs = options.leaseMs ?? DEFAULT_LEASE_MS
  const manifests = new Map(options.manifests.map((manifest) => [manifest.id, manifest]))

  function manifestFor(connectorId: string): Result<ConnectorManifest, FridayError> {
    const manifest = manifests.get(connectorId)

    // ★ An unknown connector is refused rather than looked up anyway. Without
    // a manifest there is nothing to check the requested scopes against, and
    // issuing "just the stored value" would be issuing an unbounded credential
    // to something nobody declared.
    if (manifest === undefined) {
      return err(
        fridayError({
          code: 'SCOPE_NOT_DECLARED',
          message: `${connectorId} asked for a credential, and FRIDAY does not know that connector.`,
          detail: { connectorId },
        }),
      )
    }

    return ok(manifest)
  }

  return {
    issue(request: CredentialRequest): Promise<Result<IssuedCredential, FridayError>> {
      const manifest = manifestFor(request.connectorId)
      if (!manifest.ok) return Promise.resolve(manifest)

      // Scope minimisation, before anything is read. A connector overreaching
      // must not cause a secret to be materialised at all.
      const scopes = checkRequestedScopes(manifest.value, request)
      if (!scopes.ok) return Promise.resolve(scopes)

      const secret = options.source.read(request.connectorId)
      if (!secret.ok) return Promise.resolve(secret)

      const expiresAt = options.now() + leaseMs

      const credential = issuedCredential({
        connectorId: request.connectorId,
        scopes: scopes.value,
        expiresAt,
        token: secret.value,

        // ★ The broker's own clock, so the lease is checked against the same
        // time that set it. A credential holding a different clock could
        // outlive its own expiry.
        now: options.now,
      })

      // ★ Recorded with the operation, so the trail says WHY a credential was
      // issued rather than only that it was. Never the secret — `credential`
      // redacts itself, and this passes the scopes rather than the value.
      options.observer?.onIssued?.({
        connectorId: request.connectorId,
        operationId: request.operationId,
        scopes: scopes.value,
        expiresAt,
        correlationId: request.correlationId,
      })

      return Promise.resolve(ok(credential))
    },

    revoke(request: RevocationRequest): Promise<Result<void, FridayError>> {
      // ★ Not gated on the manifest. A connector that has been removed from
      // FRIDAY must still be revocable — refusing to withdraw access because
      // the thing holding it is no longer declared would be exactly backwards.
      const revoked = options.source.revoke(request.connectorId)
      if (!revoked.ok) return Promise.resolve(revoked)

      // ★ The actor comes from the caller and is never assumed. An earlier
      // version hardcoded the owner here, which would have put a claim in the
      // audit trail that was true only by coincidence.
      options.observer?.onRevoked?.({
        connectorId: request.connectorId,
        requestedBy: request.requestedBy,
        reason: request.reason,
      })

      return Promise.resolve(ok(undefined))
    },
  }
}
