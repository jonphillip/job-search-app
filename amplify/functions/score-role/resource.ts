import { defineFunction } from '@aws-amplify/backend';

/**
 * Bedrock-backed role-fit scorer. Same cross-region Claude Haiku 4.5
 * inference profile as parse-job-posting. IAM (bedrock:InvokeModel +
 * marketplace subscription checks) is granted in amplify/backend.ts.
 */
export const scoreRole = defineFunction({
  name: 'score-role',
  entry: './handler.ts',
  timeoutSeconds: 60,
  memoryMB: 512,
  runtime: 20,
  environment: {
    MODEL_ID: 'us.anthropic.claude-haiku-4-5-20251001-v1:0',
  },
});
