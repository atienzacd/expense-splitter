import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  acceptInvitation,
  cancelInvitation,
  createGroup,
  declineInvitation,
  getGroup,
  inviteToGroup,
  leaveGroup,
  listGroupInvitations,
  listGroups,
  listMyInvitations,
} from "../api/groups.ts";

/** Cache keys, so changes can refresh exactly what they affect. */
export const groupKeys = {
  all: ["groups"] as const,
  detail: (groupId: string) => ["groups", groupId] as const,
  invitations: (groupId: string) => ["groups", groupId, "invitations"] as const,
  mine: ["invitations"] as const,
};

export const useGroups = () => useQuery({ queryKey: groupKeys.all, queryFn: listGroups });

export const useGroup = (groupId: string) => useQuery({ queryKey: groupKeys.detail(groupId), queryFn: () => getGroup(groupId) });

export const useGroupInvitations = (groupId: string) =>
  useQuery({ queryKey: groupKeys.invitations(groupId), queryFn: () => listGroupInvitations(groupId) });

export const useMyInvitations = () => useQuery({ queryKey: groupKeys.mine, queryFn: listMyInvitations });

export function useCreateGroup() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: createGroup,
    onSuccess: () => queryClient.invalidateQueries({ queryKey: groupKeys.all }),
  });
}

export function useInvite(groupId: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (email: string) => inviteToGroup(groupId, email),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: groupKeys.invitations(groupId) }),
  });
}

export function useCancelInvitation(groupId: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (invitationId: string) => cancelInvitation(groupId, invitationId),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: groupKeys.invitations(groupId) }),
  });
}

export function useLeaveGroup(groupId: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: () => leaveGroup(groupId),
    onSuccess: () => {
      queryClient.removeQueries({ queryKey: groupKeys.detail(groupId) });
      return queryClient.invalidateQueries({ queryKey: groupKeys.all });
    },
  });
}

/** Accepting or declining changes both your invitations and (when accepting) your groups. */
export function useRespondToInvitation() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async ({ id, accept }: { id: string; accept: boolean }): Promise<void> => {
      await (accept ? acceptInvitation(id) : declineInvitation(id));
    },
    onSuccess: () =>
      Promise.all([
        queryClient.invalidateQueries({ queryKey: groupKeys.mine }),
        queryClient.invalidateQueries({ queryKey: groupKeys.all }),
      ]),
  });
}
