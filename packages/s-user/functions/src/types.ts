import type { UserContext } from "@s/shared/types";

export type AppEnv = {
  Variables: {
    user: UserContext;
    traceId: string;
    spanId: string;
    traceparent: string;
  };
};
