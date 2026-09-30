import { useAuth } from '../hooks/useAuth';
import { toast } from 'react-hot-toast';
import { Button } from './ui';
import { TUBEKETER_SITE_URL } from '../constants/productUrls';

export function VerificationRequired() {
  const { user, handleSignOut, resendVerificationEmail, setAuthError } = useAuth();
  
  const onResendEmail = async () => {
    try {
      await resendVerificationEmail();
      toast.success('Verification email sent! Please check your inbox.');
    } catch {
      setAuthError('Failed to resend verification email. Please try again later.');
    }
  };

  return (
    <div className="signin-container">
      <div className="signin-left">
        <div className="brand-section">
          <div className="brand-header">
            <div className="brand-title-container">
              <img 
                src="/logo.png" 
                alt="TubeKeter" 
                className="brand-logo"
              />
              <div className="brand-text">
                <h1 className="product-name">TubeKeter Analytics</h1>
                <p className="value-prop">YouTube analytics for data-driven growth</p>
              </div>
            </div>
          </div>

          <div className="features-showcase">
            <div className="feature-item">
              <svg className="feature-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <path d="M21 16V8a2 2 0 0 0-1-1.73l-7-4a2 2 0 0 0-2 0l-7 4A2 2 0 0 0 3 8v8a2 2 0 0 0 1 1.73l7 4a2 2 0 0 0 2 0l7-4A2 2 0 0 0 21 16z"></path>
                <polyline points="3.27 6.96 12 12.01 20.73 6.96"></polyline>
                <line x1="12" y1="22.08" x2="12" y2="12"></line>
              </svg>
              <div className="feature-content">
                <h3>Fetch Video Metadata</h3>
                <p>Extract comprehensive data from playlists and channels</p>
              </div>
            </div>

            <div className="feature-item">
              <svg className="feature-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"></path>
                <polyline points="7 10 12 15 17 10"></polyline>
                <line x1="12" y1="15" x2="12" y2="3"></line>
              </svg>
              <div className="feature-content">
                <h3>Export to CSV or Copy to Clipboard</h3>
                <p>Download your data in spreadsheet-friendly format</p>
              </div>
            </div>

            <div className="feature-item">
              <svg className="feature-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <polyline points="23 6 13.5 15.5 8.5 10.5 1 18"></polyline>
                <polyline points="17 6 23 6 23 12"></polyline>
              </svg>
              <div className="feature-content">
                <h3>Progressive Loading</h3>
                <p>Real-time updates as data loads from YouTube</p>
              </div>
            </div>
          </div>
        </div>

        <div className="signin-left-footer">
          <img 
            src="/logo.png" 
            alt="TubeKeter" 
            className="footer-logo"
          />
          <a className="footer-text" href={TUBEKETER_SITE_URL} target="_blank" rel="noopener noreferrer">
            tubeketer.ai
          </a>
        </div>
      </div>
      
      <div className="signin-right">
        <div className="signin-form">
          <div className="verification-sent-inline">
            <div className="verification-icon">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <path d="M4 4h16c1.1 0 2 .9 2 2v12c0 1.1-.9 2-2 2H4c-1.1 0-2-.9-2-2V6c0-1.1.9-2 2-2z"></path>
                <polyline points="22,6 12,13 2,6"></polyline>
              </svg>
            </div>
            <h1 className="signin-title">Verify your email</h1>
            <p className="signin-subtitle">
              Your account has been created, but you need to verify your email address to access TubeKeter Analytics.
            </p>
            <p className="user-email-display">
              Logged in as: <strong>{user?.email}</strong>
            </p>
            
            <div className="verification-actions">
              <Button variant="primary" onClick={onResendEmail}>
                Resend Verification Email
              </Button>
              <Button variant="secondary" onClick={() => window.location.reload()}>
                I've Verified My Email
              </Button>
            </div>

            <div className="auth-mode-toggle">
              <p>Want to use a different account? <Button variant="ghost" onClick={handleSignOut}>Sign Out</Button></p>
            </div>
          </div>
        </div>
        
        <div className="signin-footer">
          <span>Need help with verification? </span>
          <a href={TUBEKETER_SITE_URL} target="_blank" rel="noopener noreferrer">
            Contact support
          </a>
        </div>
      </div>
    </div>
  );
}
