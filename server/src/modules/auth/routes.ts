import type { FastifyInstance, preHandlerAsyncHookHandler } from "fastify";
import { z } from "zod";
import { Prisma, type PrismaClient } from "../../generated/prisma/client.ts";
import { emailFingerprint, logSecurityEvent } from "../../security.ts";
import { DUMMY_HASH, hashPassword, verifyPassword } from "./password.ts";
import type { TokenSigner } from "./tokens.ts";

export type AuthRoutesOptions = {
  prisma: PrismaClient;
  tokens: TokenSigner;
  authenticate: preHandlerAsyncHookHandler;
  rateLimit: { max: number; timeWindow: string };
};

// Emails are compared case-insensitively by always storing them lowercased.
const email = z.string().trim().toLowerCase().pipe(z.email().max(254));

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

// Never select passwordHash into a response by accident.
const publicUser = { id: true, name: true, email: true } as const;

export async function authRoutes(app: FastifyInstance, options: AuthRoutesOptions): Promise<void> {
  const { prisma, tokens, authenticate } = options;
  const rateLimited = { config: { rateLimit: options.rateLimit } };

  app.post("/register", rateLimited, async (request, reply) => {
    const body = registerBody.parse(request.body);
    const passwordHash = await hashPassword(body.password);

    try {
      const user = await prisma.user.create({
        data: { name: body.name, email: body.email, passwordHash },
        select: publicUser,
      });
      logSecurityEvent(request, "auth.registered", { userId: user.id });
      return reply.status(201).send({ user, token: await tokens.sign(user.id) });
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

    // Unknown emails are still checked against a dummy hash so both failures
    // take the same time and return the same message.
    const passwordOk = await verifyPassword(body.password, user?.passwordHash ?? DUMMY_HASH);
    if (!user || !passwordOk) {
      logSecurityEvent(request, "auth.login_failed", {
        emailFingerprint: emailFingerprint(body.email),
        reason: user ? "wrong_password" : "unknown_email",
      });
      return reply.status(401).send({ error: "InvalidCredentials", message: "Email or password is incorrect" });
    }

    logSecurityEvent(request, "auth.login_succeeded", { userId: user.id });
    return { user: { id: user.id, name: user.name, email: user.email }, token: await tokens.sign(user.id) };
  });

  app.get("/me", { preHandler: authenticate }, async (request, reply) => {
    const user = await prisma.user.findUnique({ where: { id: request.userId }, select: publicUser });
    if (!user) {
      return reply.status(401).send({ error: "Unauthorized", message: "Log in to continue" });
    }
    return { user };
  });
}
