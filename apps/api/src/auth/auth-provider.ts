/**
 * The seam that keeps authentication swappable.
 *
 * Today a LocalAuthProvider checks a bcrypt hash in our own users table, which
 * is what makes the app runnable offline with no third-party signup. Moving to
 * Clerk / Supabase Auth / Auth0 means writing one more implementation of this
 * interface and changing the binding in AuthModule - no controller, guard or
 * service in the rest of the codebase changes, because they all deal in
 * AuthUser rather than in passwords or provider SDKs.
 */
export const AUTH_PROVIDER = Symbol('AUTH_PROVIDER');

export interface CredentialResult {
  /** Our internal users.id. Providers map their own id onto this. */
  userId: string;
}

export interface AuthProvider {
  readonly name: string;

  /**
   * Email + password sign-in, within one consultancy (tenantId) or among the
   * platform admins (null). The same email can belong to different people in
   * different consultancies, so the tenant is part of the lookup, not a check
   * made afterwards. Hosted providers that own the login screen return null
   * here and implement verifyExternalToken instead.
   */
  authenticate(
    email: string,
    password: string,
    tenantId: string | null,
  ): Promise<CredentialResult | null>;

  /**
   * Verify a token minted by an external provider (a Clerk session JWT, a
   * Supabase access token) and map it onto our users row.
   */
  verifyExternalToken?(token: string): Promise<CredentialResult | null>;
}
