import type { RouteObject } from "react-router";
import { RequireAuth } from "./auth/RequireAuth.tsx";
import { Layout } from "./components/Layout.tsx";
import { GroupPage } from "./pages/GroupPage.tsx";
import { GroupsPage } from "./pages/GroupsPage.tsx";
import { HomePage } from "./pages/HomePage.tsx";
import { LoginPage } from "./pages/LoginPage.tsx";
import { NotFoundPage } from "./pages/NotFoundPage.tsx";
import { RegisterPage } from "./pages/RegisterPage.tsx";

// Shared by the real browser router and the in-memory router used in tests.
export const routes: RouteObject[] = [
  {
    element: <Layout />,
    children: [
      { index: true, element: <HomePage /> },
      { path: "login", element: <LoginPage /> },
      { path: "register", element: <RegisterPage /> },
      {
        // Everything in here needs a login.
        element: <RequireAuth />,
        children: [
          { path: "groups", element: <GroupsPage /> },
          { path: "groups/:groupId", element: <GroupPage /> },
        ],
      },
      { path: "*", element: <NotFoundPage /> },
    ],
  },
];
