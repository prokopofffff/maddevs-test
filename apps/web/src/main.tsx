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
import { createBrowserRouter, Navigate, RouterProvider } from "react-router";
import { ApiError } from "./api.ts";
import { OrganizerLayout } from "./components/OrganizerLayout.tsx";
import { AuthPage } from "./pages/AuthPage.tsx";
import { EventAdminPage } from "./pages/EventAdminPage.tsx";
import { EventFormPage } from "./pages/EventFormPage.tsx";
import { MyEventsPage } from "./pages/MyEventsPage.tsx";
import { MyRegistrationPage } from "./pages/MyRegistrationPage.tsx";
import { NotFoundPage } from "./pages/NotFoundPage.tsx";
import { PublicEventPage } from "./pages/PublicEventPage.tsx";

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      // Ответы 4xx не повторяем: они не исправятся сами.
      retry: (count, error) => !(error instanceof ApiError && error.status < 500) && count < 2,
    },
  },
});

const router = createBrowserRouter([
  { path: "/", element: <Navigate to="/organizer" replace /> },
  { path: "/login", element: <AuthPage mode="login" key="login" /> },
  { path: "/signup", element: <AuthPage mode="signup" key="signup" /> },
  { path: "/e/:eventId", element: <PublicEventPage /> },
  { path: "/r/:token", element: <MyRegistrationPage /> },
  {
    path: "/organizer",
    element: <OrganizerLayout />,
    children: [
      { index: true, element: <MyEventsPage /> },
      { path: "events/new", element: <EventFormPage key="new" /> },
      { path: "events/:id", element: <EventAdminPage /> },
      { path: "events/:id/edit", element: <EventFormPage key="edit" /> },
    ],
  },
  { path: "*", element: <NotFoundPage /> },
]);

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <QueryClientProvider client={queryClient}>
      <RouterProvider router={router} />
    </QueryClientProvider>
  </StrictMode>,
);
