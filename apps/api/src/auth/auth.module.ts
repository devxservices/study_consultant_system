import { Global, Module } from '@nestjs/common';
import { JwtModule } from '@nestjs/jwt';
import { env } from '../config/env';
import { AUTH_PROVIDER } from './auth-provider';
import { LocalAuthProvider } from './local-auth.provider';
import { AuthService } from './auth.service';
import { AuthController } from './auth.controller';
import { MfaService } from './mfa.service';
import { PasswordLinksService } from './password-links.service';
import { PermissionsService } from '../team/permissions.service';

/**
 * To move to a hosted provider, swap the AUTH_PROVIDER binding below for a
 * ClerkAuthProvider / SupabaseAuthProvider. Nothing else needs to change.
 */
@Global()
@Module({
  imports: [
    JwtModule.register({
      secret: env().JWT_SECRET,
      // Cast: @nestjs/jwt types expiresIn as a literal duration union, not string.
      signOptions: { expiresIn: env().JWT_EXPIRES_IN as unknown as number },
    }),
  ],
  controllers: [AuthController],
  providers: [
    AuthService,
    MfaService,
    PasswordLinksService,
    PermissionsService,
    { provide: AUTH_PROVIDER, useClass: LocalAuthProvider },
  ],
  exports: [AuthService, MfaService, PasswordLinksService, PermissionsService],
})
export class AuthModule {}
