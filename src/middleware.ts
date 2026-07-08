import { isCognitoAuth } from "@/lib/auth-provider";
import clerkMiddleware from "@/middleware-clerk";
import cognitoMiddleware from "@/middleware-cognito";
import { middlewareConfig } from "@/middleware-shared";

const handler = isCognitoAuth() ? cognitoMiddleware : clerkMiddleware;

export default handler;
export const config = middlewareConfig;
