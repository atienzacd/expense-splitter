import { screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it } from "vitest";
import { ana, loggedInAs, mockApi, renderAt, requestsMade } from "../test/render.tsx";

const groupId = "0196f3a0-0000-7000-8000-0000000000a1";
const ben = { id: "0196f3a0-0000-7000-8000-000000000002", name: "Ben Cruz", email: "ben@example.com" };

const trip = {
  id: groupId,
  name: "Baguio trip",
  createdAt: "2026-11-04T00:00:00.000Z",
  createdById: ana.id,
  members: [
    { ...ana, joinedAt: "2026-11-04T00:00:00.000Z" },
    { ...ben, joinedAt: "2026-11-04T00:00:00.000Z" },
  ],
};

const noInvitations = {
  "GET /api/invitations": { status: 200, body: { invitations: [] } },
  [`GET /api/groups/${groupId}/invitations`]: { status: 200, body: { invitations: [] } },
  [`GET /api/groups/${groupId}/expenses`]: { status: 200, body: { expenses: [] } },
  [`GET /api/groups/${groupId}/balances`]: { status: 200, body: { balances: [], transfers: [] } },
  [`GET /api/groups/${groupId}/settlements`]: { status: 200, body: { settlements: [] } },
};

describe("groups list", () => {
  it("shows your groups with their member counts", async () => {
    mockApi({
      ...loggedInAs(ana),
      ...noInvitations,
      "GET /api/groups": {
        status: 200,
        body: { groups: [{ id: groupId, name: "Baguio trip", createdAt: "", memberCount: 3 }] },
      },
    });
    renderAt("/groups");

    const link = await screen.findByRole("link", { name: /Baguio trip/ });
    expect(link).toHaveAttribute("href", `/groups/${groupId}`);
    expect(link).toHaveTextContent("3 members");
  });

  it("explains what to do when you have no groups", async () => {
    mockApi({ ...loggedInAs(ana), ...noInvitations, "GET /api/groups": { status: 200, body: { groups: [] } } });
    renderAt("/groups");

    expect(await screen.findByText(/No groups yet/)).toBeInTheDocument();
  });

  it("creates a group and opens it", async () => {
    const fetchMock = mockApi({
      ...loggedInAs(ana),
      ...noInvitations,
      "GET /api/groups": { status: 200, body: { groups: [] } },
      "POST /api/groups": { status: 201, body: { group: { id: groupId, name: "Baguio trip", createdAt: "" } } },
      [`GET /api/groups/${groupId}`]: { status: 200, body: { group: trip } },
    });
    const { router } = renderAt("/groups");
    const user = userEvent.setup();

    await user.click(await screen.findByRole("button", { name: "Create group" }));
    expect(screen.getByLabelText("Group name")).toHaveAccessibleDescription("Give the group a name");
    expect(requestsMade(fetchMock)).not.toContain("POST /api/groups");

    await user.type(screen.getByLabelText("Group name"), "Baguio trip");
    await user.click(screen.getByRole("button", { name: "Create group" }));

    expect(await screen.findByRole("heading", { name: "Baguio trip", level: 1 })).toBeInTheDocument();
    expect(router.state.location.pathname).toBe(`/groups/${groupId}`);
  });
});

describe("your invitations", () => {
  const invitation = {
    id: "0196f3a0-0000-7000-8000-0000000000b1",
    createdAt: "",
    group: { id: groupId, name: "Baguio trip" },
    invitedBy: { id: ben.id, name: "Ben Cruz" },
  };

  it("can be accepted, which opens the group", async () => {
    const fetchMock = mockApi({
      ...loggedInAs(ana),
      "GET /api/groups": { status: 200, body: { groups: [] } },
      "GET /api/invitations": { status: 200, body: { invitations: [invitation] } },
      [`POST /api/invitations/${invitation.id}/accept`]: { status: 200, body: { group: invitation.group } },
      [`GET /api/groups/${groupId}`]: { status: 200, body: { group: trip } },
      [`GET /api/groups/${groupId}/invitations`]: { status: 200, body: { invitations: [] } },
    });
    const { router } = renderAt("/groups");
    const user = userEvent.setup();

    const card = await screen.findByRole("region", { name: "Invitations" });
    expect(card).toHaveTextContent("Ben Cruz invited you to Baguio trip");
    await user.click(within(card).getByRole("button", { name: "Accept" }));

    expect(await screen.findByRole("heading", { name: "Baguio trip", level: 1 })).toBeInTheDocument();
    expect(router.state.location.pathname).toBe(`/groups/${groupId}`);
    expect(requestsMade(fetchMock)).toContain(`POST /api/invitations/${invitation.id}/accept`);
  });

  it("can be declined", async () => {
    let declined = false;
    const fetchMock = mockApi({
      ...loggedInAs(ana),
      "GET /api/groups": { status: 200, body: { groups: [] } },
      "GET /api/invitations": () => ({ status: 200, body: { invitations: declined ? [] : [invitation] } }),
      [`POST /api/invitations/${invitation.id}/decline`]: () => {
        declined = true;
        return { status: 204 };
      },
    });
    renderAt("/groups");
    const user = userEvent.setup();

    await user.click(await screen.findByRole("button", { name: "Decline" }));

    await expect.poll(() => screen.queryByRole("region", { name: "Invitations" })).toBeNull();
    expect(requestsMade(fetchMock)).toContain(`POST /api/invitations/${invitation.id}/decline`);
  });
});

describe("group page", () => {
  const groupApi = (extra = {}) => ({
    ...loggedInAs(ana),
    ...noInvitations,
    [`GET /api/groups/${groupId}`]: { status: 200, body: { group: trip } },
    ...extra,
  });

  it("lists the members and marks you", async () => {
    mockApi(groupApi());
    renderAt(`/groups/${groupId}`);

    const members = await screen.findByRole("region", { name: "Members (2)" });
    expect(within(members).getByText("Ana Santos")).toBeInTheDocument();
    expect(within(members).getByText("(you)")).toBeInTheDocument();
    expect(within(members).getByText("ben@example.com")).toBeInTheDocument();
  });

  it("says when the group doesn't exist or you're not in it", async () => {
    mockApi(groupApi({ [`GET /api/groups/${groupId}`]: { status: 404, body: { error: "GroupNotFound", message: "" } } }));
    renderAt(`/groups/${groupId}`);

    expect(await screen.findByRole("heading", { name: "Group not found" })).toBeInTheDocument();
  });

  it("invites someone and lists the invitation as waiting", async () => {
    let invited = false;
    mockApi(
      groupApi({
        [`POST /api/groups/${groupId}/invitations`]: () => {
          invited = true;
          return { status: 202, body: { message: "Invitation sent" } };
        },
        [`GET /api/groups/${groupId}/invitations`]: () => ({
          status: 200,
          body: {
            invitations: invited
              ? [{ id: "inv-1", email: "carla@example.com", createdAt: "", invitedBy: { id: ana.id, name: "Ana" } }]
              : [],
          },
        }),
      }),
    );
    renderAt(`/groups/${groupId}`);
    const user = userEvent.setup();

    await user.type(await screen.findByLabelText("Their email"), "carla@example.com");
    await user.click(screen.getByRole("button", { name: "Send invite" }));

    expect(await screen.findByText(/Invitation sent to carla@example.com/)).toBeInTheDocument();
    expect(await screen.findByRole("button", { name: "Cancel invitation for carla@example.com" })).toBeInTheDocument();
    expect(screen.getByLabelText("Their email")).toHaveValue("");
  });

  it("says when the person is already a member", async () => {
    mockApi(
      groupApi({
        [`POST /api/groups/${groupId}/invitations`]: {
          status: 409,
          body: { error: "AlreadyAMember", message: "Already a member" },
        },
      }),
    );
    renderAt(`/groups/${groupId}`);
    const user = userEvent.setup();

    await user.type(await screen.findByLabelText("Their email"), "ben@example.com");
    await user.click(screen.getByRole("button", { name: "Send invite" }));

    expect(await screen.findByText("That person is already in this group.")).toBeInTheDocument();
  });

  it("asks before leaving, and explains when you still owe money", async () => {
    mockApi(
      groupApi({
        [`POST /api/groups/${groupId}/leave`]: {
          status: 409,
          body: { error: "BalanceNotSettled", message: "You still owe money in this group. Settle up before leaving." },
        },
      }),
    );
    renderAt(`/groups/${groupId}`);
    const user = userEvent.setup();

    await user.click(await screen.findByRole("button", { name: "Leave group" }));
    await user.click(screen.getByRole("button", { name: "Yes, leave group" }));

    expect(await screen.findByRole("alert")).toHaveTextContent("You still owe money in this group");
  });

  it("leaves and returns to the groups list", async () => {
    mockApi(
      groupApi({
        [`POST /api/groups/${groupId}/leave`]: { status: 204 },
        "GET /api/groups": { status: 200, body: { groups: [] } },
      }),
    );
    const { router } = renderAt(`/groups/${groupId}`);
    const user = userEvent.setup();

    await user.click(await screen.findByRole("button", { name: "Leave group" }));
    await user.click(screen.getByRole("button", { name: "Yes, leave group" }));

    expect(await screen.findByText(/No groups yet/)).toBeInTheDocument();
    expect(router.state.location.pathname).toBe("/groups");
  });
});
