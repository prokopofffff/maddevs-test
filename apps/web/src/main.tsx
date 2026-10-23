import "@fontsource/onest/400.css";
import "@fontsource/onest/500.css";
import "@fontsource/onest/600.css";
import "@fontsource/onest/700.css";
import "@fontsource/onest/800.css";
import "./styles/template.css";
import "./styles/app.css";

import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { createBrowserRouter, RouterProvider } from "react-router";
import { ApiError } from "./api.ts";
import { AccountLayout } from "./components/AccountLayout.tsx";
import { SiteLayout } from "./components/SiteLayout.tsx";
import { AuthPage } from "./pages/AuthPage.tsx";
import { CatalogPage } from "./pages/CatalogPage.tsx";
import { CheckinPage } from "./pages/CheckinPage.tsx";
import { EventAdminPage } from "./pages/EventAdminPage.tsx";
import { EventFormPage } from "./pages/EventFormPage.tsx";
import { MyEventsPage } from "./pages/MyEventsPage.tsx";
import { MyRegistrationsPage } from "./pages/MyRegistrationsPage.tsx";
import { MyRegistrationPage } from "./pages/MyRegistrationPage.tsx";
import { NotFoundPage } from "./pages/NotFoundPage.tsx";
import { PublicEventPage } from "./pages/PublicEventPage.tsx";
import { SupportPage } from "./pages/SupportPage.tsx";
import { SupportEventPage } from "./pages/support/SupportEventPage.tsx";
import { SupportEventsPage } from "./pages/support/SupportEventsPage.tsx";

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      // Ответы 4xx не повторяем: они не исправятся сами.
      retry: (count, error) => !(error instanceof ApiError && error.status < 500) && count < 2,
    },
  },
});

const router = createBrowserRouter([
  {
    element: <SiteLayout />,
    children: [
      { path: "/", element: <CatalogPage /> },
      { path: "/login", element: <AuthPage mode="login" key="login" /> },
      { path: "/signup", element: <AuthPage mode="signup" key="signup" /> },
      { path: "/e/:eventId", element: <PublicEventPage /> },
      { path: "/r/:token", element: <MyRegistrationPage /> },
      { path: "/me", element: <MyRegistrationsPage /> },
      {
        path: "/organizer",
        element: <AccountLayout role="organizer" />,
        children: [
          { index: true, element: <MyEventsPage /> },
          { path: "events/new", element: <EventFormPage key="new" /> },
          { path: "events/:id", element: <EventAdminPage /> },
          { path: "events/:id/edit", element: <EventFormPage key="edit" /> },
        ],
      },
      {
        path: "/support",
        element: <AccountLayout role="support" />,
        children: [
          { index: true, element: <SupportPage /> },
          { path: "events", element: <SupportEventsPage /> },
          { path: "events/:id", element: <SupportEventPage /> },
        ],
      },
      { path: "*", element: <NotFoundPage /> },
    ],
  },
  // Экран входа — без шапки, только для владельца события (S9, D-023).
  {
    path: "/organizer/events/:id/checkin",
    element: <AccountLayout role="organizer" bare />,
    children: [{ index: true, element: <CheckinPage /> }],
  },
]);

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <QueryClientProvider client={queryClient}>
      <RouterProvider router={router} />
    </QueryClientProvider>
  </StrictMode>,
);
