import { BrowserRouter, Routes, Route, Navigate, useNavigate } from 'react-router-dom';
import React, { useEffect, Suspense, lazy, useRef } from 'react';
import { Toaster } from 'react-hot-toast';
import { QueryClientProvider } from '@tanstack/react-query';
import { ReactQueryDevtools } from '@tanstack/react-query-devtools';
import { AuthProvider } from './contexts/AuthContext';
import { FeatureConfigProvider } from './contexts/FeatureConfigContext';
import { OrganizationProvider } from './contexts/OrganizationContext';
import { DialogProvider } from './contexts/DialogContext';
import { ThemeProvider as AppThemeProvider } from './contexts/ThemeContext';
import { useAuth } from './hooks/useAuth';
import { useOrganization } from './hooks/useOrganization';
import { requestNotificationPermission } from './services/nativeNotify';
import { ErrorBoundary } from './components/ErrorBoundary';
import { InstallPrompt } from './components/InstallPrompt';
import { BrandLoader } from './components/BrandLoader';
import { Button, Box, Container } from './components/ui';
import { TooltipProvider } from './components/ui/tooltip';
import { queryClient } from './lib/queryClient';
import './App.css';


const loadDashboardPage = () =>
  import('./pages/dashboard/DashboardPage.tsx').then(module => ({ default: module.DashboardPage }));

// Lazy load even the auth components for faster initial load
const SignIn = lazy(() => import('./components/SignIn').then(m => ({ default: m.SignIn })));
const OAuthCallback = lazy(() => import('./components/OAuthCallback').then(m => ({ default: m.OAuthCallback })));
const Layout = lazy(() => import('./components/Layout').then(m => ({ default: m.Layout })));
const VerificationRequired = lazy(() => import('./components/VerificationRequired').then(m => ({ default: m.VerificationRequired })));
const FeatureGuard = lazy(() => import('./components/FeatureGuard').then(m => ({ default: m.FeatureGuard })));

// Lazy loaded pages (route-grouped folders under ./pages — one folder per route)
const VerifyEmailPage = lazy(() => import('./pages/auth/VerifyEmailPage').then(module => ({ default: module.VerifyEmailPage })));
const ResetPasswordPage = lazy(() => import('./pages/auth/ResetPasswordPage').then(module => ({ default: module.ResetPasswordPage })));
const VideosPage = lazy(() => import('./pages/videos/VideosPage').then(module => ({ default: module.VideosPage })));
const PlaylistPage = lazy(() => import('./pages/playlist/PlaylistPage').then(module => ({ default: module.PlaylistPage })));
const ComparePage = lazy(() => import('./pages/compare/ComparePage').then(module => ({ default: module.ComparePage })));
const SpecificVideosPage = lazy(() => import('./pages/specific-videos/SpecificVideosPage').then(module => ({ default: module.SpecificVideosPage })));
const DashboardPage = lazy(loadDashboardPage);
const ChannelPage = lazy(() => import('./pages/channel/ChannelPage').then(module => ({ default: module.ChannelPage })));
const AdminPage = lazy(() => import('./pages/admin/AdminPage').then(module => ({ default: module.AdminPage })));
const ChatPage = lazy(() => import('./pages/chat/ChatPage').then(module => ({ default: module.ChatPage })));
const ReadmePage = lazy(() => import('./pages/readme/ReadmePage').then(module => ({ default: module.ReadmePage })));
const ThumbnailOptimizerPage = lazy(() => import('./pages/thumbnail-optimizer/ThumbnailOptimizerPage').then(module => ({ default: module.ThumbnailOptimizerPage })));
const PlaylistOptimizerPage = lazy(() => import('./pages/playlist-optimizer/PlaylistOptimizerPage').then(module => ({ default: module.PlaylistOptimizerPage })));
const VideoAuditPage = lazy(() => import('./pages/video-audit/VideoAuditPage').then(module => ({ default: module.VideoAuditPage })));
const AuditOrchestratorPage = lazy(() => import('./pages/audit-orchestrator').then(module => ({ default: module.AuditOrchestratorPage })));
const AuditOrchestratorDetailPage = lazy(() => import('./pages/audit-orchestrator/AuditOrchestratorDetailPage').then(module => ({ default: module.AuditOrchestratorDetailPage })));
const OrganizationPage = lazy(() => import('./pages/organization/OrganizationPage'));
const OrgAnalyticsPage = lazy(() => import('./pages/organization/OrgAnalyticsPage').then(module => ({ default: module.OrgAnalyticsPage })));
const AcceptInvitePage = lazy(() => import('./pages/auth/AcceptInvitePage'));
const ProfilePage = lazy(() => import('./pages/profile/ProfilePage').then(module => ({ default: module.ProfilePage })));
const GoalsPage = lazy(() => import('./pages/goals/GoalsPage').then(module => ({ default: module.GoalsPage })));
const GoalDetailPage = lazy(() => import('./pages/goals/GoalDetailPage').then(module => ({ default: module.GoalDetailPage })));
const AnomaliesPage = lazy(() => import('./pages/anomalies/AnomaliesPage').then(module => ({ default: module.AnomaliesPage })));
const MyDashboardPage = lazy(() => import('./pages/my-dashboard').then(module => ({ default: module.MyDashboardPage })));
const OptimizedListPage = lazy(() => import('./pages/optimized/OptimizedListPage').then(module => ({ default: module.OptimizedListPage })));

// Protected Route wrapper
function ProtectedRoute({ children }: { children: React.ReactNode }) {
  const { isAuthenticated, isEmailVerified, isCheckingAuth, authError, setAuthError } = useAuth();
  const navigate = useNavigate();
  // Track the previous auth state so we can detect a fresh login (was logged
  // out -> just signed in) and land the user on the Channel Analytics Dashboard
  // instead of whatever page was active before signing out.
  const prevAuthenticatedRef = useRef(isAuthenticated);

  // After full authentication, honour any saved post-login redirect (e.g. invite links)
  useEffect(() => {
    if (isAuthenticated && isEmailVerified && !isCheckingAuth) {
      const redirect = sessionStorage.getItem('postLoginRedirect');
      if (redirect) {
        sessionStorage.removeItem('postLoginRedirect');
        navigate(redirect, { replace: true });
      } else if (!prevAuthenticatedRef.current) {
        // Fresh re-login (no invite redirect): always go to the dashboard.
        navigate('/dashboard', { replace: true });
      }
    }
    prevAuthenticatedRef.current = isAuthenticated;
  }, [isAuthenticated, isEmailVerified, isCheckingAuth, navigate]);

  // Show loading while checking authentication — branded spinner + shimmer
  if (isCheckingAuth) {
    return <BrandLoader variant="fullscreen" message="Checking authentication" subMessage="Securing your TubeKeter session…" />;
  }

  // Show sign-in screen if not authenticated
  if (!isAuthenticated) {
    return (
      <Suspense fallback={<BrandLoader variant="fullscreen" message="Loading" subMessage="Preparing sign-in…" />}>
        <SignIn 
          onSignInSuccess={() => setAuthError(null)}
          onSignInError={(error) => setAuthError(error)}
        />
        {authError && (
          <div className="auth-error-toast" role="alert">
            <div className="auth-error-toast__icon">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <circle cx="12" cy="12" r="10" />
                <path d="M12 8v4m0 4h.01" />
              </svg>
            </div>
            <div className="auth-error-toast__body">
              <p className="auth-error-toast__title">Connection Error</p>
              <p className="auth-error-toast__text">{authError}</p>
            </div>
            <Button variant="ghost" size="icon" onClick={() => setAuthError(null)} aria-label="Dismiss">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <path d="M18 6L6 18M6 6l12 12" />
              </svg>
            </Button>
          </div>
        )}
      </Suspense>
    );
  }

  // Check email verification for email/password users
  // (Google users are usually pre-verified)
  if (!isEmailVerified) {
    return (
      <Suspense fallback={<BrandLoader variant="fullscreen" message="Loading" subMessage="Almost there…" />}>
        <VerificationRequired />
      </Suspense>
    );
  }

  return <>{children}</>;
}

// Admin-only route wrapper
function AdminRoute({ children }: { children: React.ReactNode }) {
  const { role, isCheckingAuth } = useAuth();
  if (isCheckingAuth || role === null) return null;
  if (role !== 'admin') return <Navigate to="/channel" replace />;
  return <>{children}</>;
}

// Organization route wrapper - allows pro users, global admins, or any org member.
// Members of all roles (owner, admin, write, read) must be able to reach the
// Organization page so they can manage their membership (e.g. leave the org).
function OrganizationRoute({ children }: { children: React.ReactNode }) {
  const { userPackage, role, isCheckingAuth } = useAuth();
  const { canAccessOrganization, loading } = useOrganization();

  // Wait until auth + profile sync + org data are all ready
  if (isCheckingAuth || userPackage === null || loading) return null;

  // Allow access if user has pro, is global admin, or is any org member.
  if (userPackage === 'pro' || role === 'admin' || canAccessOrganization) {
    return <>{children}</>;
  }

  return <Navigate to="/channel" replace />;
}

// Global loading fallback for Suspense — branded logo + spinner + shimmer
function PageLoader() {
  return <BrandLoader variant="page" message="Loading page" subMessage="Fetching TubeKeter data…" />;
}

function AppRoutes() {
  // Request OS notification permission once at app start, when still undecided.
  // Audits run server-side (BullMQ) and keep running even if the tab closes, so
  // a granted OS permission lets us surface a real Windows/OS notification when
  // an audit finishes while the user is away. Idempotent: no-op if already
  // granted/denied, and degrades gracefully when the API is unsupported.
  useEffect(() => {
    void requestNotificationPermission();
  }, []);

  useEffect(() => {
    const g = globalThis as typeof globalThis & {
      requestIdleCallback?: (cb: IdleRequestCallback, opts?: IdleRequestOptions) => number;
      cancelIdleCallback?: (id: number) => void;
    };

    const preload = () => {
      void loadDashboardPage();
    };

    if (typeof g.requestIdleCallback === 'function') {
      const idleId = g.requestIdleCallback(preload, { timeout: 3000 });
      return () => g.cancelIdleCallback?.(idleId);
    }

    const timeoutId = globalThis.setTimeout(preload, 1200);
    return () => globalThis.clearTimeout(timeoutId);
  }, []);

  return (
    <ErrorBoundary>
      <Box sx={{ minHeight: '100vh', bgcolor: 'background.default' }}>
        <Container maxWidth={false} disableGutters sx={{ px: 0 }}>
          <Suspense fallback={<PageLoader />}>
            <Routes>
              <Route path="/oauth-callback" element={<OAuthCallback />} />
              <Route path="/verify-email" element={<VerifyEmailPage />} />
              <Route path="/reset-password" element={<ResetPasswordPage />} />
              <Route path="/accept-invite" element={<AcceptInvitePage />} />
              <Route path="/" element={
                <ProtectedRoute>
                  <Suspense fallback={<PageLoader />}>
                    <Layout />
                  </Suspense>
                </ProtectedRoute>
              }>
                <Route index element={<Navigate to="/dashboard" replace />} />
                <Route path="dashboard" element={<Suspense fallback={<PageLoader />}><FeatureGuard pageKey="dashboard"><DashboardPage /></FeatureGuard></Suspense>} />
                <Route path="goals" element={<Suspense fallback={<PageLoader />}><FeatureGuard pageKey="goals"><GoalsPage /></FeatureGuard></Suspense>} />
                <Route path="goals/:goalId" element={<Suspense fallback={<PageLoader />}><FeatureGuard pageKey="goals"><GoalDetailPage /></FeatureGuard></Suspense>} />
                <Route path="videos" element={<Suspense fallback={<PageLoader />}><FeatureGuard pageKey="videos"><VideosPage /></FeatureGuard></Suspense>} />
                <Route path="channel" element={<Suspense fallback={<PageLoader />}><FeatureGuard pageKey="channel"><ChannelPage /></FeatureGuard></Suspense>} />
                <Route path="playlist" element={<Suspense fallback={<PageLoader />}><FeatureGuard pageKey="playlists"><PlaylistPage /></FeatureGuard></Suspense>} />
                <Route path="compare" element={<Suspense fallback={<PageLoader />}><FeatureGuard pageKey="compare"><ComparePage /></FeatureGuard></Suspense>} />
                <Route path="specific-videos" element={<Suspense fallback={<PageLoader />}><FeatureGuard pageKey="specificVideos"><SpecificVideosPage /></FeatureGuard></Suspense>} />
                <Route path="anomalies" element={<Suspense fallback={<PageLoader />}><FeatureGuard pageKey="anomalies"><AnomaliesPage /></FeatureGuard></Suspense>} />
                <Route path="my-dashboard" element={<Suspense fallback={<PageLoader />}><FeatureGuard pageKey="customDashboard"><MyDashboardPage /></FeatureGuard></Suspense>} />
                <Route path="profile" element={<Suspense fallback={<PageLoader />}><ProfilePage /></Suspense>} />
                <Route path="organization" element={<Suspense fallback={<PageLoader />}><OrganizationRoute><OrganizationPage /></OrganizationRoute></Suspense>} />
                <Route path="organization/analytics" element={<Suspense fallback={<PageLoader />}><OrganizationRoute><OrgAnalyticsPage /></OrganizationRoute></Suspense>} />
                <Route path="admin/users" element={<Suspense fallback={<PageLoader />}><AdminRoute><AdminPage /></AdminRoute></Suspense>} />
                <Route path="admin/features" element={<Suspense fallback={<PageLoader />}><AdminRoute><AdminPage /></AdminRoute></Suspense>} />
                <Route path="admin/system" element={<Suspense fallback={<PageLoader />}><AdminRoute><AdminPage /></AdminRoute></Suspense>} />
                <Route path="admin/ai-chat" element={<Suspense fallback={<PageLoader />}><AdminRoute><AdminPage /></AdminRoute></Suspense>} />
                <Route path="admin/thumbnail-optimizer" element={<Suspense fallback={<PageLoader />}><AdminRoute><AdminPage /></AdminRoute></Suspense>} />
                <Route path="admin/playlist-optimizer" element={<Suspense fallback={<PageLoader />}><AdminRoute><AdminPage /></AdminRoute></Suspense>} />
                <Route path="admin/audit-criteria" element={<Suspense fallback={<PageLoader />}><AdminRoute><AdminPage /></AdminRoute></Suspense>} />
                <Route path="admin/public-audit" element={<Suspense fallback={<PageLoader />}><AdminRoute><AdminPage /></AdminRoute></Suspense>} />
                <Route path="chat" element={<Suspense fallback={<PageLoader />}><FeatureGuard pageKey="chat"><ChatPage /></FeatureGuard></Suspense>} />
                <Route path="thumbnail-optimizer" element={<Suspense fallback={<PageLoader />}><FeatureGuard pageKey="thumbnailOptimizer"><ThumbnailOptimizerPage /></FeatureGuard></Suspense>} />
                <Route path="playlist-optimizer" element={<Suspense fallback={<PageLoader />}><FeatureGuard pageKey="playlistOptimizer"><PlaylistOptimizerPage /></FeatureGuard></Suspense>} />
                {/* Full Audit — the unified orchestrator (replaces the old /audit + /channelaudit pages) */}
                <Route path="audit-orchestrator" element={<Suspense fallback={<PageLoader />}><FeatureGuard pageKey="audit"><AuditOrchestratorPage /></FeatureGuard></Suspense>} />
                <Route path="audit-orchestrator/:id" element={<Suspense fallback={<PageLoader />}><FeatureGuard pageKey="audit"><AuditOrchestratorDetailPage /></FeatureGuard></Suspense>} />
                <Route path="video-audit" element={<Suspense fallback={<PageLoader />}><FeatureGuard pageKey="videoAudit"><VideoAuditPage /></FeatureGuard></Suspense>} />
                <Route path="readme" element={<Suspense fallback={<PageLoader />}><ReadmePage /></Suspense>} />
                <Route path="optimized" element={<Suspense fallback={<PageLoader />}><FeatureGuard pageKey="optimized"><OptimizedListPage /></FeatureGuard></Suspense>} />
              </Route>
            </Routes>
          </Suspense>
        </Container>
      </Box>
    </ErrorBoundary>
  );
}

function App() {
  return (
    <QueryClientProvider client={queryClient}>
      <AppThemeProvider>
        <ThemedApp />
      </AppThemeProvider>
      {import.meta.env.DEV ? <ReactQueryDevtools initialIsOpen={false} /> : null}
    </QueryClientProvider>
  );
}

function ThemedApp() {
  return (
    <AuthProvider>
      <FeatureConfigProvider>
        <OrganizationProvider>
          <DialogProvider>
            <BrowserRouter>
              <TooltipProvider delayDuration={300}>
                <Toaster position="bottom-right" toastOptions={{ duration: 4000 }} />
                <InstallPrompt />
                <AppRoutes />
              </TooltipProvider>
            </BrowserRouter>
          </DialogProvider>
        </OrganizationProvider>
      </FeatureConfigProvider>
    </AuthProvider>
  );
}

export default App;
