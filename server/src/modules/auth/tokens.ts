import { SignJWT, jwtVerify } from "jose";

/**
 * Access tokens are short JWTs signed with HS256. They hold only the user's id
 * (the `sub` claim), so nothing sensitive is exposed if one is decoded.
 */

const ALGORITHM = "HS256";
const ISSUER = "expense-splitter";

export type TokenSigner = {
  sign(userId: string): Promise<string>;
  /** Returns the user id, or null if the token is invalid or expired. */
  verify(token: string): Promise<string | null>;
};

export function createTokenSigner(secret: string, expiresIn: string): TokenSigner {
  const key = new TextEncoder().encode(secret);

  return {
    async sign(userId) {
      return new SignJWT()
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
        return payload.sub ?? null;
      } catch {
        return null;
      }
    },
  };
}
