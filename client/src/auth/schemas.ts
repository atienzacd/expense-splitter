import { z } from "zod";

// The same limits the server enforces, checked first so mistakes show instantly.
const email = z.string().trim().min(1, "Enter your email").pipe(z.email("Enter a valid email address"));

export const loginSchema = z.object({
  email,
  password: z.string().min(1, "Enter your password"),
});

export const registerSchema = z.object({
  name: z.string().trim().min(1, "Enter your name").max(100, "Use at most 100 characters"),
  email,
  password: z.string().min(8, "Use at least 8 characters").max(128, "Use at most 128 characters"),
});
