import { api, post } from "./client.ts";

export type GroupSummary = { id: string; name: string; createdAt: string; memberCount: number };
export type Member = { id: string; name: string; email: string; joinedAt: string };
export type GroupDetails = { id: string; name: string; createdAt: string; createdById: string; members: Member[] };
export type PendingInvitation = { id: string; email: string; createdAt: string; invitedBy: { id: string; name: string } };
export type MyInvitation = {
  id: string;
  createdAt: string;
  group: { id: string; name: string };
  invitedBy: { id: string; name: string };
};

export const listGroups = async () => (await api<{ groups: GroupSummary[] }>("/groups")).groups;

export const createGroup = (name: string) => post<{ group: GroupSummary }>("/groups", { name });

export const getGroup = async (groupId: string) => (await api<{ group: GroupDetails }>(`/groups/${groupId}`)).group;

export const inviteToGroup = (groupId: string, email: string) =>
  post<{ message: string }>(`/groups/${groupId}/invitations`, { email });

export const listGroupInvitations = async (groupId: string) =>
  (await api<{ invitations: PendingInvitation[] }>(`/groups/${groupId}/invitations`)).invitations;

export const cancelInvitation = (groupId: string, invitationId: string) =>
  api<void>(`/groups/${groupId}/invitations/${invitationId}`, { method: "DELETE" });

export const leaveGroup = (groupId: string) => post<void>(`/groups/${groupId}/leave`);

export const listMyInvitations = async () => (await api<{ invitations: MyInvitation[] }>("/invitations")).invitations;

export const acceptInvitation = (invitationId: string) =>
  post<{ group: { id: string; name: string } }>(`/invitations/${invitationId}/accept`);

export const declineInvitation = (invitationId: string) => post<void>(`/invitations/${invitationId}/decline`);
