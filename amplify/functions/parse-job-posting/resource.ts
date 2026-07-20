import { defineFunction } from '@aws-amplify/backend';

/**
 * Bedrock-backed job-posting parser. The model id is a cross-region
 * inference profile for Claude Haiku 4.5 (verified available in this
 * account/region). IAM permission for bedrock:InvokeModel is granted,
 * scoped to this model, in amplify/backend.ts.
 */
export const parseJobPosting = defineFunction({
  name: 'parse-job-posting',
  entry: './handler.ts',
  timeoutSeconds: 60,
  memoryMB: 512,
  runtime: 20,
  environment: {
    MODEL_ID: 'us.anthropic.claude-haiku-4-5-20251001-v1:0',
  },
});
