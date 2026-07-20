import { type ClientSchema, a, defineData } from '@aws-amplify/backend';
import { parseJobPosting } from '../functions/parse-job-posting/resource';

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
      location: a.string(),
      notes: a.string(),
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

  // Shape returned by the AI job-posting parser. Every field is nullable:
  // the model returns null for anything not present in the source text.
  ParsedJobPosting: a.customType({
    companyName: a.string(),
    roleTitle: a.string(),
    location: a.string(),
    salaryMin: a.integer(),
    salaryMax: a.integer(),
    url: a.string(),
  }),

  parseJobPosting: a
    .query()
    .arguments({ text: a.string().required() })
    .returns(a.ref('ParsedJobPosting'))
    .handler(a.handler.function(parseJobPosting))
    .authorization((allow) => [allow.authenticated()]),
});

export type Schema = ClientSchema<typeof schema>;

export const data = defineData({
  schema,
  authorizationModes: {
    defaultAuthorizationMode: 'userPool',
  },
});
