import { z } from 'zod';

/**
 * The student profile: everything a consultant needs to judge which
 * universities and visa routes a student can realistically apply to.
 *
 * All of it is optional. A client record starts as a name and a phone number
 * during the first call, and the profile fills in over the following visits.
 */

export const QUALIFICATIONS = [
  'matric',
  'intermediate',
  'a_levels',
  'diploma',
  'bachelor',
  'master',
  'phd',
  'other',
] as const;
export type Qualification = (typeof QUALIFICATIONS)[number];
export const QUALIFICATION_LABEL: Record<Qualification, string> = {
  matric: 'Matric / O-Levels',
  intermediate: 'Intermediate (FSc / FA / ICS)',
  a_levels: 'A-Levels',
  diploma: 'Diploma',
  bachelor: 'Bachelor’s degree',
  master: 'Master’s degree',
  phd: 'PhD',
  other: 'Other',
};

export const STUDY_LEVELS = ['foundation', 'diploma', 'bachelor', 'master', 'phd', 'other'] as const;
export type StudyLevel = (typeof STUDY_LEVELS)[number];
export const STUDY_LEVEL_LABEL: Record<StudyLevel, string> = {
  foundation: 'Foundation',
  diploma: 'Diploma',
  bachelor: 'Bachelor’s',
  master: 'Master’s',
  phd: 'PhD',
  other: 'Other',
};

export const ENGLISH_TESTS = ['ielts', 'pte', 'toefl', 'duolingo', 'oet', 'none'] as const;
export type EnglishTest = (typeof ENGLISH_TESTS)[number];
export const ENGLISH_TEST_LABEL: Record<EnglishTest, string> = {
  ielts: 'IELTS',
  pte: 'PTE Academic',
  toefl: 'TOEFL iBT',
  duolingo: 'Duolingo',
  oet: 'OET',
  none: 'Not taken yet',
};

/** Where the enquiry came from - the question every marketing spend is judged by. */
export const LEAD_SOURCES = [
  'walk_in',
  'referral',
  'facebook',
  'instagram',
  'website',
  'whatsapp',
  'event',
  'other',
] as const;
export type LeadSource = (typeof LEAD_SOURCES)[number];
export const LEAD_SOURCE_LABEL: Record<LeadSource, string> = {
  walk_in: 'Walk-in',
  referral: 'Referral',
  facebook: 'Facebook',
  instagram: 'Instagram',
  website: 'Website',
  whatsapp: 'WhatsApp',
  event: 'Education fair / event',
  other: 'Other',
};

/** A calendar date with no time zone attached: "2027-01-31". */
export const dateOnlySchema = z
  .string()
  .trim()
  .regex(/^\d{4}-\d{2}-\d{2}$/, 'Use a date like 2027-01-31')
  .refine((s) => !Number.isNaN(new Date(`${s}T00:00:00Z`).getTime()), 'That is not a real date');

const optionalText = (max: number) => z.string().trim().max(max).nullable().optional();

/**
 * Every profile field, all optional and all clearable with null. Shared by
 * client creation and editing so the two can never accept different shapes.
 */
export const clientProfileSchema = z.object({
  dateOfBirth: dateOnlySchema.nullable().optional(),
  nationality: optionalText(60),
  passportNumber: z
    .string()
    .trim()
    .toUpperCase()
    .max(20)
    .regex(/^[A-Z0-9]*$/, 'Letters and digits only')
    .nullable()
    .optional(),
  passportExpiry: dateOnlySchema.nullable().optional(),
  highestQualification: z.enum(QUALIFICATIONS).nullable().optional(),
  lastInstitution: optionalText(160),
  lastGrade: optionalText(40),
  graduationYear: z.coerce.number().int().min(1960).max(2100).nullable().optional(),
  englishTest: z.enum(ENGLISH_TESTS).nullable().optional(),
  englishScore: optionalText(20),
  englishTestDate: dateOnlySchema.nullable().optional(),
  intendedLevel: z.enum(STUDY_LEVELS).nullable().optional(),
  intendedField: optionalText(120),
  preferredCountries: z.array(z.string().trim().min(2).max(60)).max(10).nullable().optional(),
  budget: optionalText(80),
  leadSource: z.enum(LEAD_SOURCES).nullable().optional(),
  emergencyContactName: optionalText(120),
  emergencyContactPhone: optionalText(24),
});
export type ClientProfileInput = z.infer<typeof clientProfileSchema>;

export interface ClientProfile {
  dateOfBirth: string | null;
  nationality: string | null;
  passportNumber: string | null;
  passportExpiry: string | null;
  highestQualification: Qualification | null;
  lastInstitution: string | null;
  lastGrade: string | null;
  graduationYear: number | null;
  englishTest: EnglishTest | null;
  englishScore: string | null;
  englishTestDate: string | null;
  intendedLevel: StudyLevel | null;
  intendedField: string | null;
  preferredCountries: string[];
  budget: string | null;
  leadSource: LeadSource | null;
  emergencyContactName: string | null;
  emergencyContactPhone: string | null;
}

/**
 * Most student visas need a passport valid well beyond arrival - six months is
 * the common floor. Measured against today, since the travel date is often
 * not known when this matters most.
 */
export function passportWarning(expiry: string | null | undefined): 'expired' | 'soon' | null {
  if (!expiry) return null;
  const days = (new Date(`${expiry}T00:00:00Z`).getTime() - Date.now()) / 86_400_000;
  if (days < 0) return 'expired';
  if (days < 183) return 'soon';
  return null;
}

/** Offers come with or without strings attached, and the strings are what the next month is about. */
export const OFFER_TYPES = ['conditional', 'unconditional'] as const;
export type OfferType = (typeof OFFER_TYPES)[number];
export const OFFER_TYPE_LABEL: Record<OfferType, string> = {
  conditional: 'Conditional offer',
  unconditional: 'Unconditional offer',
};
