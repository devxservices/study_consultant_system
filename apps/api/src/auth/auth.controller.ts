import { Body, Controller, Get, HttpCode, Post, Query, Req, Res, UseGuards } from '@nestjs/common';
import type { Request, Response } from 'express';
import {
  changePasswordSchema,
  forgotPasswordSchema,
  setPasswordSchema,
  mfaCodeSchema,
  mfaVerifySchema,
  signInSchema,
  type AuthUser,
  type ChangePasswordInput,
  type ForgotPasswordInput,
  type PasswordLinkInfo,
  type SetPasswordInput,
  type MfaChallengeResponse,
  type MfaCodeInput,
  type MfaVerifyInput,
  type SessionResponse,
  type SignInInput,
} from '@crm/shared';
import { zodPipe } from '../common/zod.pipe';
import { env, isProd } from '../config/env';
import { AuthService } from './auth.service';
import { MfaService } from './mfa.service';
import { PasswordLinksService } from './password-links.service';
import { AuditService } from '../audit/audit.service';
import { AllowDuringMfaSetup, AllowPlatform, AllowWhenLapsed, CurrentUser, Public, Site } from './auth.guard';
import type { ResolvedHost } from '../tenancy/tenant-resolver.service';
import { LoginThrottleGuard } from './login-throttle.guard';

const SEVEN_DAYS_MS = 7 * 24 * 60 * 60 * 1000;

function setSessionCookie(res: Response, token: string): void {
  // httpOnly so no script can read the session, sameSite=lax so it survives
  // ordinary navigation but not cross-site form posts.
  res.cookie(env().COOKIE_NAME, token, {
    httpOnly: true,
    secure: isProd(),
    sameSite: 'lax',
    domain: env().COOKIE_DOMAIN,
    maxAge: SEVEN_DAYS_MS,
    path: '/',
  });
}

@Controller('auth')
export class AuthController {
  constructor(
    private readonly auth: AuthService,
    private readonly mfa: MfaService,
    private readonly links: PasswordLinksService,
    private readonly audit: AuditService,
  ) {}

  /**
   * Email and password. Returns the session - or, for someone with two-step
   * verification on, a challenge to answer at /auth/mfa/verify, and no cookie.
   */
  @Public()
  @UseGuards(LoginThrottleGuard)
  @Post('sign-in')
  @HttpCode(200)
  async signIn(
    @Body(zodPipe(signInSchema)) body: SignInInput,
    @Site() site: ResolvedHost,
    @Res({ passthrough: true }) res: Response,
  ): Promise<SessionResponse | MfaChallengeResponse> {
    const result = await this.auth.signIn(body.email, body.password, site);
    if (result.kind === 'challenge') return { mfaRequired: true, challenge: result.challenge };
    setSessionCookie(res, result.token);
    return { user: result.user, expiresIn: SEVEN_DAYS_MS / 1000 };
  }

  /** The second step: a code from the authenticator app, or a recovery code. */
  @Public()
  @UseGuards(LoginThrottleGuard)
  @Post('mfa/verify')
  @HttpCode(200)
  async verifyMfa(
    @Body(zodPipe(mfaVerifySchema)) body: MfaVerifyInput,
    @Res({ passthrough: true }) res: Response,
  ): Promise<SessionResponse> {
    const { token, user } = await this.auth.completeMfa(body.challenge, {
      code: body.code,
      recoveryCode: body.recoveryCode,
    });
    setSessionCookie(res, token);
    return { user, expiresIn: SEVEN_DAYS_MS / 1000 };
  }

  /** Public: clearing a cookie needs no valid session - a suspended user must still be able to. */
  @Public()
  @Post('sign-out')
  @HttpCode(204)
  async signOut(@Req() req: Request, @Res({ passthrough: true }) res: Response): Promise<void> {
    const cookies = (req as Request & { cookies?: Record<string, string> }).cookies;
    await this.auth.recordSignOut(cookies?.[env().COOKIE_NAME] ?? null);
    res.clearCookie(env().COOKIE_NAME, { path: '/', domain: env().COOKIE_DOMAIN });
  }

  /**
   * A password change signs out every other device. This one gets a fresh
   * session, so the person who changed it carries on where they are.
   */
  @AllowPlatform()
  @AllowWhenLapsed()
  @Post('password')
  @HttpCode(204)
  async changePassword(
    @CurrentUser() user: AuthUser,
    @Body(zodPipe(changePasswordSchema)) body: ChangePasswordInput,
    @Res({ passthrough: true }) res: Response,
  ): Promise<void> {
    await this.auth.changePassword(user, body.currentPassword, body.newPassword);
    setSessionCookie(res, await this.auth.reissue(user));
  }

  /** "Sign out everywhere else": every other session ends; this one is renewed. */
  @AllowPlatform()
  @AllowWhenLapsed()
  @Post('sessions/end-others')
  @HttpCode(204)
  async endOtherSessions(
    @CurrentUser() user: AuthUser,
    @Res({ passthrough: true }) res: Response,
  ): Promise<void> {
    await this.auth.endSessions(user.id);
    setSessionCookie(res, await this.auth.reissue(user));
    await this.audit.record(user, { action: 'user.sessions_ended', entityType: 'user', entityId: user.id });
  }

  /* ---------------------------------------------------------------- */
  /* Choosing a password from a link                                    */
  /* ---------------------------------------------------------------- */

  /** "Forgot my password". The same answer whether or not the email has an account here. */
  @Public()
  @UseGuards(LoginThrottleGuard)
  @Post('password/forgot')
  @HttpCode(204)
  async forgotPassword(
    @Body(zodPipe(forgotPasswordSchema)) body: ForgotPasswordInput,
    @Site() site: ResolvedHost,
  ): Promise<void> {
    await this.links.requestReset(site, body.email);
  }

  /** Whether a link is still good, and whom it is for. */
  @Public()
  @Get('password/link')
  passwordLink(@Query('token') token: string | undefined, @Site() site: ResolvedHost): Promise<PasswordLinkInfo> {
    return this.links.inspect(site, String(token ?? ''));
  }

  /** Sets the password from a link. The person then signs in as usual. */
  @Public()
  @UseGuards(LoginThrottleGuard)
  @Post('password/set')
  @HttpCode(200)
  setPassword(
    @Body(zodPipe(setPasswordSchema)) body: SetPasswordInput,
    @Site() site: ResolvedHost,
  ): Promise<{ email: string }> {
    return this.links.complete(site, body.token, body.password);
  }

  /** Used by the web app on every page load to establish who is signed in. */
  @AllowPlatform()
  @AllowDuringMfaSetup()
  @Get('me')
  me(@CurrentUser() user: AuthUser): { user: AuthUser } {
    return { user };
  }

  /* ---------------------------------------------------------------- */
  /* Two-step verification for the signed-in person                     */
  /* ---------------------------------------------------------------- */

  @AllowPlatform()
  @AllowDuringMfaSetup()
  @Get('mfa')
  mfaStatus(@CurrentUser() user: AuthUser) {
    return this.mfa.status(user);
  }

  /** A new secret and its QR code. Nothing is switched on until a code confirms it. */
  @AllowPlatform()
  @AllowDuringMfaSetup()
  @AllowWhenLapsed()
  @Post('mfa/setup')
  @HttpCode(200)
  mfaSetup(@CurrentUser() user: AuthUser, @Site() site: ResolvedHost) {
    const issuer = site.kind === 'tenant' ? site.tenant.name : 'Consultancy CRM admin';
    return this.mfa.startSetup(user, issuer);
  }

  /** Confirms the set-up with a first code; returns the recovery codes, once. */
  @AllowPlatform()
  @AllowDuringMfaSetup()
  @AllowWhenLapsed()
  @Post('mfa/enable')
  @HttpCode(200)
  mfaEnable(@CurrentUser() user: AuthUser, @Body(zodPipe(mfaCodeSchema)) body: MfaCodeInput) {
    return this.mfa.enable(user, body.code);
  }

  @AllowPlatform()
  @AllowWhenLapsed()
  @Post('mfa/disable')
  @HttpCode(204)
  async mfaDisable(@CurrentUser() user: AuthUser, @Body(zodPipe(mfaCodeSchema)) body: MfaCodeInput) {
    await this.mfa.disable(user, body.code);
  }

  @AllowPlatform()
  @AllowWhenLapsed()
  @Post('mfa/recovery-codes')
  @HttpCode(200)
  mfaRegenerate(@CurrentUser() user: AuthUser, @Body(zodPipe(mfaCodeSchema)) body: MfaCodeInput) {
    return this.mfa.regenerate(user, body.code);
  }
}
