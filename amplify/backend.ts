import { defineBackend } from '@aws-amplify/backend';
import { Stack } from 'aws-cdk-lib';
import { PolicyStatement } from 'aws-cdk-lib/aws-iam';
import type { IFunction } from 'aws-cdk-lib/aws-lambda';
import { auth } from './auth/resource';
import { data } from './data/resource';
import { parseJobPosting } from './functions/parse-job-posting/resource';
import { fetchCompanyJobs } from './functions/fetch-company-jobs/resource';
import { scoreRole } from './functions/score-role/resource';

/**
 * @see https://docs.amplify.aws/react/build-a-backend/ to add storage, functions, and more
 */
const backend = defineBackend({
  auth,
  data,
  parseJobPosting,
  scoreRole,
  // fetch-company-jobs needs no IAM: it only makes outbound HTTPS calls to
  // public job-board APIs from a default (non-VPC) Lambda.
  fetchCompanyJobs,
});

/**
 * Grants a Lambda everything it needs to invoke the Claude Haiku 4.5
 * cross-region inference profile via Bedrock:
 *
 * - bedrock:InvokeModel, scoped to the profile ARN plus each underlying
 *   foundation-model ARN the profile can route to (us-east-1 / us-east-2 /
 *   us-west-2). Not scoped to "*".
 * - aws-marketplace:ViewSubscriptions/Subscribe, which Bedrock checks on
 *   first invocation of a marketplace-brokered model. Unlike InvokeModel,
 *   these operate on the account's subscription state rather than a
 *   nameable resource, so IAM only accepts Resource: "*" for them — kept in
 *   their own statement so the InvokeModel grant above stays tightly scoped.
 */
function grantHaikuBedrockAccess(lambda: IFunction) {
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

  lambda.addToRolePolicy(
    new PolicyStatement({
      actions: [
        'aws-marketplace:ViewSubscriptions',
        'aws-marketplace:Subscribe',
      ],
      resources: ['*'],
    }),
  );
}

grantHaikuBedrockAccess(backend.parseJobPosting.resources.lambda);
grantHaikuBedrockAccess(backend.scoreRole.resources.lambda);
