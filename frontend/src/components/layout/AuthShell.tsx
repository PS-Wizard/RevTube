import React from "react";
import { Box } from "../ui/Box";
import { Card } from "../ui/card";
import { Flex } from "../ui/Stack";
import { Link } from "../ui/Link";
import { Typography } from "../ui/Typography";
import { TUBEKETER_SITE_URL } from "../../constants/productUrls";

export interface AuthShellProps {
  children: React.ReactNode;
}

/**
 * AuthShell — centered card layout for authentication pages
 * (sign-in helpers, verify email, reset password, accept invite).
 *
 * Ambient glow art, brand header, card column, and support footer are shared —
 * pages render only their card content. No per-page auth chrome.
 */
export const AuthShell: React.FC<AuthShellProps> = ({ children }) => {
  return (
    <Flex
      alignItems="center"
      justifyContent="space-between"
      sx={{ flexDirection: "column", minHeight: "100vh", p: { xs: 2, sm: 3 } }}
      style={{ position: "relative", overflow: "hidden", backgroundColor: "var(--background)" }}
    >
      {/* Ambient background glow */}
      <div aria-hidden style={{ pointerEvents: "none", position: "absolute", top: -160, left: "50%", zIndex: -10, height: 384, width: "100%", maxWidth: "56rem", transform: "translateX(-50%)", borderRadius: "50%", backgroundColor: "var(--primary)", opacity: 0.1, filter: "blur(130px)" }} />
      <div aria-hidden style={{ pointerEvents: "none", position: "absolute", bottom: -160, right: 40, zIndex: -10, height: 320, width: 320, borderRadius: "50%", backgroundColor: "var(--primary)", opacity: 0.05, filter: "blur(100px)" }} />

      {/* Header with brand logo */}
      <Box component="header" sx={{ display: "flex", width: "100%", justifyContent: "center", pt: { xs: 3, sm: 4 } }}>
        <a href="/">
          <img src="/TubeKeter.svg" alt="TubeKeter Analytics" style={{ height: 36, width: "auto" }} />
        </a>
      </Box>

      {/* Main Content Area */}
      <Box component="main" sx={{ my: "auto", width: "100%", maxWidth: "28rem", py: { xs: 3, sm: 4 } }}>
        <Card style={{ position: "relative", overflow: "hidden", borderRadius: 16, backgroundColor: "var(--card)", opacity: 0.9, boxShadow: "var(--rt-shadow-md)", backdropFilter: "blur(24px)" }}>
          {/* Subtle top accent gradient */}
          <div aria-hidden style={{ position: "absolute", top: 0, left: 0, right: 0, height: 4, background: "linear-gradient(to right, var(--primary), var(--primary))" }} />
          {children}
        </Card>
      </Box>

      {/* Support footer */}
      <Flex
        alignItems="center"
        justifyContent="center"
        sx={{ flexDirection: { xs: "column", sm: "row" }, gap: { xs: 0.5, sm: 2 }, pb: 3 }}
      >
        <Typography variant="caption">© {new Date().getFullYear()} TubeKeter Analytics. All rights reserved.</Typography>
        <Box component="span" sx={{ display: { xs: "none", sm: "inline" } }} style={{ color: "var(--border)" }}>•</Box>
        <Flex alignItems="center" gap={1}>
          <Typography variant="caption">Need help?</Typography>
          <Link
            component="a"
            href={TUBEKETER_SITE_URL}
            target="_blank"
            rel="noopener noreferrer"
            underline="always"
            style={{ color: "var(--foreground)" }}
          >
            Contact Support
          </Link>
        </Flex>
      </Flex>
    </Flex>
  );
};

export default AuthShell;
