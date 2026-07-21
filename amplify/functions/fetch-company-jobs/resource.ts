import { defineFunction } from '@aws-amplify/backend';

/**
 * Pure fetch/normalize of a company's public job board (Greenhouse or Ashby).
 * No Bedrock, no IAM — just outbound HTTPS to a public API from a default
 * (non-VPC) Lambda, which needs no extra permissions.
 */
export const fetchCompanyJobs = defineFunction({
  name: 'fetch-company-jobs',
  entry: './handler.ts',
  timeoutSeconds: 30,
  memoryMB: 256,
  runtime: 20,
});
