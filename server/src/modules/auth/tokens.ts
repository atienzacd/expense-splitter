import { SignJWT, jwtVerify } from "jose";

/**
 * Access tokens are short JWTs signed with HS256. They hold only the user's id
 * (`sub`) and the id of the login session they belong to (`sid`), so nothing
 * sensitive is exposed if one is decoded. The session id lets the server
 * reject the token as soon as that session ends (logout, rotation, theft).
 */

const ALGORITHM = "HS256";
const ISSUER = "expense-splitter";

export type AccessClaims = { userId: string; sessionId: string };

export type TokenSigner = {
  sign(claims: AccessClaims): Promise<string>;
  /** Returns the claims, or null if the token is invalid, expired or incomplete. */
  verify(token: string): Promise<AccessClaims | null>;
};

export function createTokenSigner(secret: string, expiresIn: string): TokenSigner {
  const key = new TextEncoder().encode(secret);

  return {
    async sign({ userId, sessionId }) {
      return new SignJWT({ sid: sessionId })
        .setProtectedHeader({ alg: ALGORITHM })
        .setSubject(userId)
        .setIssuer(ISSUER)
        .setIssuedAt()
        .setExpirationTime(expiresIn)
        .sign(key);
    },

    async verify(token) {
      try {
        const { payload } = await jwtVerify(token, key, { algorithms: [ALGORITHM], issuer: ISSUER });
        if (typeof payload.sub !== "string" || typeof payload.sid !== "string") return null;
        return { userId: payload.sub, sessionId: payload.sid };
      } catch {
        return null;
      }
    },
  };
}
