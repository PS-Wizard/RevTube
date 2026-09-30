import React, { type ReactNode } from 'react';
import { useNavigate } from 'react-router-dom';
import { Clock3, LayoutDashboard, ShieldOff } from 'lucide-react';
import { useAuth } from '../hooks/useAuth';
import { useFeatureConfig } from '../hooks/useFeatureConfig';
import { useOrganization } from '../hooks/useOrganization';
import { PremiumFeature } from './PremiumFeature';
import { Badge, Button, Card, CardContent } from './ui';

interface FeatureGuardProps {
  pageKey: string;
  children: ReactNode;
  fallbackMessage?: string;
}

function getDisabledCopy(pageKey: string, fallbackMessage?: string): { title: string; desc: string; badge: string } {
  if (fallbackMessage) return { title: pageKey.charAt(0).toUpperCase() + pageKey.slice(1), desc: fallbackMessage, badge: 'Temporarily unavailable' };
  switch (pageKey) {
    case 'videoAudit':
      return {
        title: 'Video Audit is on pause',
        desc: 'AI-powered title, description, tag & thumbnail scoring is temporarily disabled by your administrator while we tune the scoring engine. Your past audits are safe — check back soon or explore other audits in the meantime.',
        badge: 'Under maintenance',
      };
    case 'thumbnailOptimizer':
      return { title: 'Thumbnail Optimizer is paused', desc: 'Thumbnail analysis is temporarily disabled. Try the Video Audit or Playlist Optimizer, or check back shortly.', badge: 'Temporarily unavailable' };
    case 'playlistOptimizer':
      return { title: 'Playlist Optimizer is paused', desc: 'Playlist optimization is temporarily disabled. Your saved playlists are safe — check back soon.', badge: 'Temporarily unavailable' };
    default: {
      const label = pageKey.charAt(0).toUpperCase() + pageKey.slice(1).replace(/([A-Z])/g, ' $1');
      return { title: `${label} is unavailable`, desc: 'This feature is currently disabled by your administrator. Please check back later or contact support if you need access.', badge: 'Temporarily unavailable' };
    }
  }
}

export const FeatureGuard: React.FC<FeatureGuardProps> = ({
  pageKey,
  children,
  fallbackMessage
}) => {
  const { role, userPackage, isCheckingAuth, isAuthenticated } = useAuth();
  const { isPagePremiumOnly, isPageEnabled, loading } = useFeatureConfig();
  const { isPersonalContext } = useOrganization();

  const userProfileLoading = isCheckingAuth || (isAuthenticated && userPackage === null);
  const userIsPro = userPackage === 'pro' || role === 'admin';

  const shouldWaitForConfig = loading && !userIsPro && isPersonalContext;

  if (userProfileLoading || shouldWaitForConfig) {
    return (
      <div className="loading-container">
        <div className="spinner-small" style={{ width: '32px', height: '32px', borderWidth: '3px' }}></div>
      </div>
    );
  }

  // Check feature enabled status — admins can always access
  if (role !== 'admin' && !isPageEnabled(pageKey)) {
    const copy = getDisabledCopy(pageKey, fallbackMessage);
    return <DisabledState pageKey={pageKey} title={copy.title} desc={copy.desc} badge={copy.badge} />;
  }

  const premiumOnly = isPagePremiumOnly(pageKey);

  const bypassPremium = !isPersonalContext;

  if (premiumOnly && !userIsPro && !bypassPremium) {
    const pageLabel = pageKey.charAt(0).toUpperCase() + pageKey.slice(1);
    const msg = fallbackMessage || `The ${pageLabel} page requires a Pro subscription.`;
    return (
      <div className="page-guard-container" style={{ padding: '2rem', maxWidth: '800px', margin: '0 auto' }}>
        <PremiumFeature fallbackMessage={msg}><></></PremiumFeature>
      </div>
    );
  }

  return <>{children}</>;
};

const DisabledState: React.FC<{ pageKey: string; title: string; desc: string; badge: string }> = ({ pageKey, title, desc, badge }) => {
  const navigate = useNavigate();
  const isVideoAudit = pageKey === 'videoAudit';
  return (
    <div className="flex min-h-[56vh] items-center justify-center px-4 py-10">
      <Card className="w-full max-w-[480px] shadow-none">
        <CardContent className="flex flex-col items-center gap-5 px-7 py-8 text-center sm:px-8">
          <Badge variant="secondary" className="rounded-full px-2.5 py-0.5 text-[11px] font-medium tracking-wide">
            <Clock3 className="size-3" />
            {badge}
          </Badge>

          <div className="flex size-14 items-center justify-center rounded-2xl border border-dashed bg-muted text-muted-foreground" aria-hidden>
            <ShieldOff className="size-[22px]" />
          </div>

          <div className="space-y-2">
            <h2 className="text-[15px] font-semibold tracking-tight text-foreground">{title}</h2>
            <p className="mx-auto max-w-[38ch] text-sm leading-6 text-muted-foreground">{desc}</p>
          </div>

          <div className="flex flex-wrap items-center justify-center gap-2 pt-1">
            <Button size="sm" onClick={() => navigate('/dashboard')}>
              <LayoutDashboard className="size-3.5" />
              Go to Dashboard
            </Button>
            <Button variant="secondary" size="sm" onClick={() => navigate(isVideoAudit ? '/audit-orchestrator' : '/optimized')}>
              {isVideoAudit ? 'Browse Audits' : 'Explore tools'}
            </Button>
          </div>

          <p className="text-xs leading-5 text-muted-foreground/70">
            Admin? Re-enable in <span className="font-medium text-muted-foreground">Admin → Features</span>
          </p>
        </CardContent>
      </Card>
    </div>
  );
};
