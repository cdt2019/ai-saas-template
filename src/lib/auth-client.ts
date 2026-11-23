"use client";

import { createAuthClient } from "better-auth/react";
import { emailOTPClient, inferAdditionalFields } from "better-auth/client/plugins";
import type { Auth } from "./auth";

/** 浏览器端认证客户端：signIn / signUp / signOut / useSession 等 */
export const authClient = createAuthClient({
  plugins: [inferAdditionalFields<Auth>(), emailOTPClient()],
});

export const { useSession, signIn, signUp, signOut } = authClient;
