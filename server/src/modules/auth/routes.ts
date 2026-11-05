import type { FastifyInstance, FastifyReply, preHandlerAsyncHookHandler } from "fastify";
import { z } from "zod";
import { Prisma, type PrismaClient } from "../../generated/prisma/client.ts";
import { email, publicUserSelect } from "../../lib/schemas.ts";
import { logSecurityEvent } from "../../security.ts";
import { clearLoginCookies, type CookieSettings, REFRESH_COOKIE, setLoginCookies } from "./cookies.ts";
import { checkCredentials, hashPassword } from "./password.ts";
import { createSession, revokeSession, rotateSession } from "./sessions.ts";
import type { TokenSigner } from "./tokens.ts";

export type AuthRoutesOptions = {
  prisma: PrismaClient;
  tokens: TokenSigner;
  authenticate: preHandlerAsyncHookHandler;
  rateLimit: { max: number; timeWindow: string };
  cookies: CookieSettings;
  /** Keyed fingerprint used instead of the email in security logs. */
  fingerprintEmail: (email: string) => string;
};

const registerBody = z.object({
  name: z.string().trim().min(1).max(100),
  email,
  // The upper limit stops huge inputs from tying up the server while hashing.
  password: z.string().min(8, "Password must be at least 8 characters").max(128),
});

const loginBody = z.object({
  email,
  password: z.string().min(1).max(128),
});

const sessionExpired = { error: "SessionExpired", message: "Your session has ended. Please log in again." };

export async function authRoutes(app: FastifyInstance, options: AuthRoutesOptions): Promise<void> {
  const { prisma, tokens, authenticate, cookies } = options;
  const rateLimited = { config: { rateLimit: options.rateLimit } };

  /** Starts a new session and hands the browser its cookies. Tokens never go in the response body. */
  async function logIn(reply: FastifyReply, userId: string): Promise<void> {
    const session = await createSession(prisma, userId, cookies.refreshTtlSeconds);
    setLoginCookies(reply, cookies, {
      accessToken: await tokens.sign({ userId, sessionId: session.sessionId }),
      refreshToken: session.token,
    });
  }

  app.post("/register", rateLimited, async (request, reply) => {
    const body = registerBody.parse(request.body);
    const passwordHash = await hashPassword(body.password);

    try {
      const user = await prisma.user.create({
        data: { name: body.name, email: body.email, passwordHash },
        select: publicUserSelect,
      });
      logSecurityEvent(request, "auth.registered", { userId: user.id });
      await logIn(reply, user.id);
      return reply.status(201).send({ user });
    } catch (error) {
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") {
        return reply.status(409).send({ error: "EmailTaken", message: "An account with this email already exists" });
      }
      throw error;
    }
  });

  app.post("/login", rateLimited, async (request, reply) => {
    const body = loginBody.parse(request.body);
    const user = await prisma.user.findUnique({ where: { email: body.email } });

    // Both failures return the same message and take the same time.
    const passwordOk = await checkCredentials(body.password, user?.passwordHash);
    if (!user || !passwordOk) {
      logSecurityEvent(request, "auth.login_failed", {
        emailFingerprint: options.fingerprintEmail(body.email),
        reason: user ? "wrong_password" : "unknown_email",
      });
      return reply.status(401).send({ error: "InvalidCredentials", message: "Email or password is incorrect" });
    }

    logSecurityEvent(request, "auth.login_succeeded", { userId: user.id });
    await logIn(reply, user.id);
    return { user: { id: user.id, name: user.name, email: user.email } };
  });

  // Swaps the refresh token for a new pair of tokens. The browser calls this
  // when the access token expires.
  app.post("/refresh", rateLimited, async (request, reply) => {
    const token = request.cookies[REFRESH_COOKIE];
    const outcome = token ? await rotateSession(prisma, token, cookies.refreshTtlSeconds) : { status: "invalid" as const };

    if (outcome.status === "reused") {
      logSecurityEvent(request, "auth.refresh_token_reused", { userId: outcome.userId });
    }
    if (outcome.status !== "rotated") {
      clearLoginCookies(reply, cookies);
      return reply.status(401).send(sessionExpired);
    }

    const user = await prisma.user.findUnique({ where: { id: outcome.userId }, select: publicUserSelect });
    if (!user) {
      clearLoginCookies(reply, cookies);
      return reply.status(401).send(sessionExpired);
    }
    setLoginCookies(reply, cookies, {
      accessToken: await tokens.sign({ userId: user.id, sessionId: outcome.sessionId }),
      refreshToken: outcome.token,
    });
    return { user };
  });

  // Ends this device's session on the server, not just in the browser.
  app.post("/logout", async (request, reply) => {
    const token = request.cookies[REFRESH_COOKIE];
    const userId = token ? await revokeSession(prisma, token) : null;
    if (userId) logSecurityEvent(request, "auth.logged_out", { userId });
    clearLoginCookies(reply, cookies);
    return reply.status(204).send();
  });

  app.get("/me", { preHandler: authenticate }, async (request, reply) => {
    const user = await prisma.user.findUnique({ where: { id: request.userId }, select: publicUserSelect });
    if (!user) {
      return reply.status(401).send({ error: "Unauthorized", message: "Log in to continue" });
    }
    return { user };
  });
}
