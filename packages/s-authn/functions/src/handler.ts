import { handle } from "hono/aws-lambda";
import app from "./api";

export const handler = handle(app);
