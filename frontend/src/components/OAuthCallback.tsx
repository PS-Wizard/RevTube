import { useEffect } from 'react';

export const OAuthCallback = () => {
  useEffect(() => {
    // Extract access token from URL hash
    const hash = window.location.hash.substring(1);
    const params = new URLSearchParams(hash);
    const accessToken = params.get('access_token');
    const error = params.get('error');

    if (accessToken) {
      // Send token to parent window
      window.opener?.postMessage({
        type: 'YOUTUBE_OAUTH_SUCCESS',
        accessToken: accessToken
      }, window.location.origin);
    } else if (error) {
      window.opener?.postMessage({
        type: 'YOUTUBE_OAUTH_ERROR',
        error: error
      }, window.location.origin);
    }

    // Auto-close after short delay
    const timer = setTimeout(() => {
      window.close();
    }, 1500);

    return () => clearTimeout(timer);
  }, []);

  return (
    <div style={{
      fontFamily: '-apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif',
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'center',
      height: '100vh',
      margin: 0,
      background: 'var(--rt-color-bg-app)'
    }}>
      <div style={{
        textAlign: 'center',
        padding: '2rem',
        background: 'var(--rt-color-bg-elevated)',
        borderRadius: 'var(--rt-radius-lg)',
        boxShadow: 'var(--rt-shadow-md)'
      }}>
        <div style={{
          color: 'var(--rt-color-success)',
          fontSize: '48px',
          marginBottom: '1rem'
        }}>✓</div>
        <h2>Authorization Successful</h2>
        <p>You can close this window now.</p>
      </div>
    </div>
  );
};
