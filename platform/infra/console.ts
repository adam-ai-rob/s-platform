import * as aws from "@pulumi/aws";
import * as pulumi from "@pulumi/pulumi";
import type { gateway as platformGateway } from "./gateway";

type PlatformGateway = typeof platformGateway;

export async function attachPlatformConsole(gateway: PlatformGateway) {
  const [caller, regionResult] = await Promise.all([aws.getCallerIdentity({}), aws.getRegion({})]);
  const accountId = caller.accountId;
  const region = regionResult.name;

  const consoleApi = new sst.aws.Function("PlatformConsole", {
    environment: {
      STAGE: $app.stage,
      SERVICE_NAME: "s-platform-console",
    },
    handler: "functions/src/console.handler",
  });

  const consoleIntegration = new aws.apigatewayv2.Integration("PlatformConsoleIntegration", {
    apiId: gateway.nodes.api.id,
    integrationType: "AWS_PROXY",
    integrationUri: consoleApi.arn,
    integrationMethod: "POST",
    payloadFormatVersion: "2.0",
  });

  new aws.apigatewayv2.Route("PlatformConsoleRoute", {
    apiId: gateway.nodes.api.id,
    routeKey: "GET /platform/status",
    target: pulumi.interpolate`integrations/${consoleIntegration.id}`,
  });

  new aws.lambda.Permission("PlatformConsoleInvokePermission", {
    action: "lambda:InvokeFunction",
    function: consoleApi.nodes.function.name,
    principal: "apigateway.amazonaws.com",
    sourceArn: pulumi.interpolate`arn:aws:execute-api:${region}:${accountId}:${gateway.nodes.api.id}/*/GET/platform/status`,
  });

  return {
    platformConsoleUrl: pulumi.interpolate`${gateway.url}platform/status`,
  };
}
