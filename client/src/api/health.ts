import { api } from "./client.ts";

export type Health = { status: "ok"; database: "ok" };

export const getHealth = () => api<Health>("/health");
