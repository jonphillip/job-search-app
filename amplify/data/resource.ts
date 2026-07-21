import { type ClientSchema, a, defineData } from '@aws-amplify/backend';
import { parseJobPosting } from '../functions/parse-job-posting/resource';
import { fetchCompanyJobs } from '../functions/fetch-company-jobs/resource';
import { scoreRole } from '../functions/score-role/resource';

const schema = a.schema({
  Company: a
    .model({
      name: a.string().required(),
      website: a.string(),
      notes: a.string(),
      status: a.enum(['RESEARCHING', 'TARGETING', 'COLD']),
      roles: a.hasMany('Role', 'companyId'),
      contacts: a.hasMany('Contact', 'companyId'),
    })
    .authorization((allow) => [allow.owner()]),

  Role: a
    .model({
      title: a.string().required(),
      url: a.string(),
      salaryMin: a.integer(),
      salaryMax: a.integer(),
      salaryIsEstimated: a.boolean(),
      compensationNote: a.string(),
      location: a.string(),
      description: a.string(),
      requirements: a.string().array(),
      notes: a.string(),
      // AI role-fit scoring — set by the scoreRole triage action. scoredAt
      // null means "not yet scored"; that's the queue the batch action drains.
      fitScore: a.integer(),
      attainability: a.enum(['ENTRY_FREELANCE', 'MID', 'SENIOR_ONLY']),
      scoreRationale: a.string(),
      scoreGaps: a.string(),
      scoredAt: a.datetime(),
      // "Not interested" — hides a scored role from the triage worklist
      // without touching the role itself or its score.
      triageDismissed: a.boolean(),
      companyId: a.id(),
      company: a.belongsTo('Company', 'companyId'),
      applications: a.hasMany('Application', 'roleId'),
    })
    .authorization((allow) => [allow.owner()]),

  Application: a
    .model({
      status: a.enum([
        'DRAFT',
        'APPLIED',
        'SCREENING',
        'INTERVIEW',
        'OFFER',
        'REJECTED',
        'WITHDRAWN',
      ]),
      appliedDate: a.date(),
      lastStatusChange: a.date(),
      notes: a.string(),
      roleId: a.id(),
      role: a.belongsTo('Role', 'roleId'),
    })
    .authorization((allow) => [allow.owner()]),

  Contact: a
    .model({
      name: a.string().required(),
      email: a.string(),
      linkedin: a.string(),
      title: a.string(),
      notes: a.string(),
      companyId: a.id(),
      company: a.belongsTo('Company', 'companyId'),
      interactions: a.hasMany('Interaction', 'contactId'),
    })
    .authorization((allow) => [allow.owner()]),

  Interaction: a
    .model({
      type: a.enum(['EMAIL', 'CALL', 'COFFEE', 'DM', 'EVENT']),
      date: a.date().required(),
      notes: a.string(),
      contactId: a.id(),
      contact: a.belongsTo('Contact', 'contactId'),
    })
    .authorization((allow) => [allow.owner()]),

  // The fixed picture role-fit scoring compares roles against. One per user,
  // enforced at the app level (src/lib/profile.ts always updates the existing
  // record rather than creating a second one) — owner auth already scopes
  // reads/writes to the caller, so there's nothing to leak across users.
  Profile: a
    .model({
      resumeText: a.string(),
      targetingStatement: a.string(),
    })
    .authorization((allow) => [allow.owner()]),

  // Shape returned by the AI job-posting parser. Every field is nullable:
  // the model returns null for anything not present in the source text.
  ParsedJobPosting: a.customType({
    companyName: a.string(),
    roleTitle: a.string(),
    location: a.string(),
    salaryMin: a.integer(),
    salaryMax: a.integer(),
    salaryIsEstimated: a.boolean(),
    compensationNote: a.string(),
    url: a.string(),
    description: a.string(),
    requirements: a.string().array(),
  }),

  parseJobPosting: a
    .query()
    .arguments({ text: a.string().required() })
    .returns(a.ref('ParsedJobPosting'))
    .handler(a.handler.function(parseJobPosting))
    .authorization((allow) => [allow.authenticated()]),

  // One normalized job posting fetched from a company's public job board.
  FetchedJob: a.customType({
    title: a.string(),
    location: a.string(),
    url: a.string(),
    descriptionText: a.string(),
  }),

  // Result of a job-board fetch. On failure/empty, jobs is [] and message
  // carries a human-readable explanation.
  FetchCompanyJobsResult: a.customType({
    count: a.integer(),
    message: a.string(),
    atsType: a.string(),
    slug: a.string(),
    jobs: a.ref('FetchedJob').array(),
  }),

  fetchCompanyJobs: a
    .query()
    .arguments({ url: a.string(), atsType: a.string(), slug: a.string() })
    .returns(a.ref('FetchCompanyJobsResult'))
    .handler(a.handler.function(fetchCompanyJobs))
    .authorization((allow) => [allow.authenticated()]),

  // Result of scoring one role against the user's profile. attainability is
  // a plain string here (not a.enum) — it's a transient return shape that the
  // Lambda already validates against the known set before returning; the enum
  // itself lives on the stored Role.attainability field, where it's earned.
  ScoreRoleResult: a.customType({
    fitScore: a.integer(),
    attainability: a.string(),
    rationale: a.string(),
    gaps: a.string(),
  }),

  scoreRole: a
    .query()
    .arguments({
      roleTitle: a.string().required(),
      requirements: a.string().array(),
      description: a.string(),
      resumeText: a.string().required(),
      targetingStatement: a.string(),
    })
    .returns(a.ref('ScoreRoleResult'))
    .handler(a.handler.function(scoreRole))
    .authorization((allow) => [allow.authenticated()]),
});

export type Schema = ClientSchema<typeof schema>;

export const data = defineData({
  schema,
  authorizationModes: {
    defaultAuthorizationMode: 'userPool',
  },
});
