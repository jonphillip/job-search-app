import { defineBackend } from '@aws-amplify/backend';
import { Stack } from 'aws-cdk-lib';
import { PolicyStatement } from 'aws-cdk-lib/aws-iam';
import { auth } from './auth/resource';
import { data } from './data/resource';
import { parseJobPosting } from './functions/parse-job-posting/resource';
import { fetchCompanyJobs } from './functions/fetch-company-jobs/resource';

/**
 * @see https://docs.amplify.aws/react/build-a-backend/ to add storage, functions, and more
 */
const backend = defineBackend({
  auth,
  data,
  parseJobPosting,
  // fetch-company-jobs needs no IAM: it only makes outbound HTTPS calls to
  // public job-board APIs from a default (non-VPC) Lambda.
  fetchCompanyJobs,
});

// Allow the parser Lambda to invoke exactly the Claude Haiku 4.5 model it uses.
// Because we call it through a cross-region inference profile, the role needs
// InvokeModel on the profile ARN plus each underlying foundation-model ARN the
// profile can route to (us-east-1 / us-east-2 / us-west-2). Not scoped to "*".
const lambda = backend.parseJobPosting.resources.lambda;
const { account, region } = Stack.of(lambda);

lambda.addToRolePolicy(
  new PolicyStatement({
    actions: ['bedrock:InvokeModel'],
    resources: [
      `arn:aws:bedrock:${region}:${account}:inference-profile/us.anthropic.claude-haiku-4-5-20251001-v1:0`,
      'arn:aws:bedrock:us-east-1::foundation-model/anthropic.claude-haiku-4-5-20251001-v1:0',
      'arn:aws:bedrock:us-east-2::foundation-model/anthropic.claude-haiku-4-5-20251001-v1:0',
      'arn:aws:bedrock:us-west-2::foundation-model/anthropic.claude-haiku-4-5-20251001-v1:0',
    ],
  }),
);

// On first invocation of a marketplace-brokered Bedrock model, Bedrock checks
// the caller's Marketplace subscription for that model. These two actions are
// what that check needs. Unlike bedrock:InvokeModel, the aws-marketplace
// ViewSubscriptions/Subscribe actions do NOT support resource-level scoping:
// they operate on the account's subscription state, not on a nameable resource,
// so IAM only accepts Resource: "*" for them. We therefore isolate them in
// their own statement with "*", leaving the bedrock:InvokeModel statement above
// tightly scoped to the specific model/profile ARNs.
lambda.addToRolePolicy(
  new PolicyStatement({
    actions: [
      'aws-marketplace:ViewSubscriptions',
      'aws-marketplace:Subscribe',
    ],
    resources: ['*'],
  }),
);
