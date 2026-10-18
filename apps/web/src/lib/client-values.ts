import type { ClientProfile } from '@crm/shared';
import type { ClientFormValues } from '@/components/client-form';

/*
 * Lives outside the form's 'use client' module because the edit pages - server
 * components - call it to turn a saved profile into the form's starting values.
 */
/** Form values from a saved profile, for the edit page. */
export function profileValues(p: ClientProfile): Partial<ClientFormValues> {
  return {
    dateOfBirth: p.dateOfBirth ?? '',
    nationality: p.nationality ?? '',
    passportNumber: p.passportNumber ?? '',
    passportExpiry: p.passportExpiry ?? '',
    highestQualification: p.highestQualification ?? '',
    lastInstitution: p.lastInstitution ?? '',
    lastGrade: p.lastGrade ?? '',
    graduationYear: p.graduationYear ? String(p.graduationYear) : '',
    englishTest: p.englishTest ?? '',
    englishScore: p.englishScore ?? '',
    englishTestDate: p.englishTestDate ?? '',
    intendedLevel: p.intendedLevel ?? '',
    intendedField: p.intendedField ?? '',
    preferredCountries: p.preferredCountries.join(', '),
    budget: p.budget ?? '',
    leadSource: p.leadSource ?? '',
    emergencyContactName: p.emergencyContactName ?? '',
    emergencyContactPhone: p.emergencyContactPhone ?? '',
  };
}

