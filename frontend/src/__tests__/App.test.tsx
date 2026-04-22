import React from "react";
import { render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import App from "../App";
import { AuthContext, AuthContextValue } from "../context/AuthContext";

const authValue: AuthContextValue = {
  user: {
    id: "user-1",
    email: "user@example.com",
    publicKey: null,
    roles: ["user"],
    tier: "free",
    emailVerified: true,
  },
  accessToken: "token",
  csrfToken: "csrf",
  loading: false,
  error: null,
  sessionExpiresAt: new Date(Date.now() + 60000).toISOString(),
  loginWithEmail: jest.fn(),
  loginWithWallet: jest.fn(),
  loginWithSocial: jest.fn(),
  signup: jest.fn(),
  logout: jest.fn(),
  logoutAll: jest.fn(),
  refresh: jest.fn(),
  hasRole: () => true,
};

describe("ChenAIKit Frontend", () => {
  test("renders navigation", () => {
    render(
      <AuthContext.Provider value={authValue}>
        <MemoryRouter initialEntries={["/"]}>
          <App />
        </MemoryRouter>
      </AuthContext.Provider>,
    );

    expect(screen.getByText(/Dashboard/i)).toBeInTheDocument();
    expect(screen.getByText(/Credit Scoring/i)).toBeInTheDocument();
    expect(screen.getByText(/Growth Hub/i)).toBeInTheDocument();
  });
});
