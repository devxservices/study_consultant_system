import {
  ENGLISH_TEST_LABEL,
  LEAD_SOURCE_LABEL,
  QUALIFICATION_LABEL,
  STUDY_LEVEL_LABEL,
  passportWarning,
  type ClientProfile,
} from '@crm/shared';
import { formatDate } from '@/lib/format';
import { Card, Pill } from './ui';

function age(dob: string | null): string | null {
  if (!dob) return null;
  const d = new Date(`${dob}T00:00:00Z`);
  const years = Math.floor((Date.now() - d.getTime()) / (365.25 * 86_400_000));
  return `${formatDate(dob)} (${years})`;
}

/**
 * The student profile at a glance, grouped the way a consultant reads it:
 * can they travel, what have they studied, is their English enough, what do
 * they want. Missing facts show as a dash, so gaps are visible, not hidden.
 */
export function ClientProfileCard({ profile }: { profile: ClientProfile }) {
  const warn = passportWarning(profile.passportExpiry);
  const english =
    profile.englishTest && profile.englishTest !== 'none'
      ? `${ENGLISH_TEST_LABEL[profile.englishTest]}${profile.englishScore ? ` ${profile.englishScore}` : ''}`
      : profile.englishTest === 'none'
        ? 'Not taken yet'
        : null;

  const groups: { title: string; rows: [string, React.ReactNode][] }[] = [
    {
      title: 'Identity',
      rows: [
        ['Born', age(profile.dateOfBirth)],
        ['Nationality', profile.nationality],
        ['Passport', profile.passportNumber],
        [
          'Expires',
          profile.passportExpiry ? (
            <span className="inline-flex items-center gap-1.5">
              {formatDate(profile.passportExpiry)}
              {warn && <Pill tone={warn === 'expired' ? 'bad' : 'warn'}>{warn === 'expired' ? 'Expired' : 'Under 6 months'}</Pill>}
            </span>
          ) : null,
        ],
      ],
    },
    {
      title: 'Education',
      rows: [
        ['Qualification', profile.highestQualification ? QUALIFICATION_LABEL[profile.highestQualification] : null],
        ['Institution', profile.lastInstitution],
        ['Result', profile.lastGrade],
        ['Completed', profile.graduationYear ? String(profile.graduationYear) : null],
        ['English', english],
        ['Test date', profile.englishTestDate ? formatDate(profile.englishTestDate) : null],
      ],
    },
    {
      title: 'Goals',
      rows: [
        ['Level', profile.intendedLevel ? STUDY_LEVEL_LABEL[profile.intendedLevel] : null],
        ['Subject', profile.intendedField],
        ['Countries', profile.preferredCountries.length ? profile.preferredCountries.join(', ') : null],
        ['Budget', profile.budget],
        ['Came via', profile.leadSource ? LEAD_SOURCE_LABEL[profile.leadSource] : null],
      ],
    },
    {
      title: 'Emergency contact',
      rows: [
        ['Name', profile.emergencyContactName],
        ['Phone', profile.emergencyContactPhone],
      ],
    },
  ];

  return (
    <Card className="p-4">
      <h2 className="mb-3 text-[15.5px] font-medium text-ink-950">Student profile</h2>
      <div className="space-y-4">
        {groups.map((g) => (
          <div key={g.title}>
            <p className="mb-1.5 text-[12px] font-medium text-ink-500">{g.title}</p>
            <dl className="space-y-1.5 text-[13px]">
              {g.rows.map(([label, value]) => (
                <div key={label} className="flex items-baseline justify-between gap-3">
                  <dt className="shrink-0 text-ink-400">{label}</dt>
                  <dd className="min-w-0 text-right font-medium text-ink-800">{value ?? <span className="font-normal text-ink-300">—</span>}</dd>
                </div>
              ))}
            </dl>
          </div>
        ))}
      </div>
    </Card>
  );
}
