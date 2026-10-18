import { z } from 'zod';

const password = z.string().min(8, 'Use at least 8 characters').max(200, 'That password is too long');

/** Anyone changing their own password proves they know the current one. */
export const changePasswordSchema = z.object({
  currentPassword: z.string().min(1, 'Enter your current password'),
  newPassword: password,
});
export type ChangePasswordInput = z.infer<typeof changePasswordSchema>;

/** A manager setting a staff member's password when they are locked out. */
export const resetPasswordSchema = z.object({ password });
export type ResetPasswordInput = z.infer<typeof resetPasswordSchema>;

/** A manager adjusting a consultant: capacity, countries, or switching their login off. */
export const updateStaffSchema = z.object({
  maxActiveClients: z.coerce.number().int().min(1).max(500).optional(),
  countries: z.array(z.string().trim().min(2).max(60)).max(20).optional(),
  active: z.boolean().optional(),
});
export type UpdateStaffInput = z.infer<typeof updateStaffSchema>;

/** "Forgot my password": the email to send a link to, on the site it was asked on. */
export const forgotPasswordSchema = z.object({
  email: z.string().trim().toLowerCase().email('Enter the email you sign in with').max(254),
});
export type ForgotPasswordInput = z.infer<typeof forgotPasswordSchema>;

/** Choosing a password from a link (a reset or an invitation). */
export const setPasswordSchema = z.object({
  token: z.string().trim().min(20).max(200),
  password,
});
export type SetPasswordInput = z.infer<typeof setPasswordSchema>;

/** What a valid link says about itself, so the page can greet the right person. */
export interface PasswordLinkInfo {
  purpose: 'reset' | 'invite';
  firstName: string;
  email: string;
}

/** A link made for someone by staff: emailed when possible, and shown so it can also be sent another way. */
export interface PasswordLinkResult {
  link: string;
  emailed: boolean;
  expiresAt: string;
}
