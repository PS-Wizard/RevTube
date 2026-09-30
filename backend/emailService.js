const nodemailer = require('nodemailer');

/**
 * Create a reusable transporter from environment variables.
 * Supports any SMTP provider (Gmail, Resend, SendGrid, Mailgun, etc.)
 */
function createTransporter() {
  const host = process.env.SMTP_HOST;
  const port = parseInt(process.env.SMTP_PORT || '587', 10);
  const user = process.env.SMTP_USER;
  const pass = process.env.SMTP_PASSWORD;

  if (!host || !user || !pass) {
    throw new Error(
      'SMTP not configured. Set SMTP_HOST, SMTP_USER, and SMTP_PASSWORD environment variables.'
    );
  }

  return nodemailer.createTransport({
    host,
    port,
    secure: port === 465, // true for 465, false for 587/2587
    auth: { user, pass },
    tls: {
      rejectUnauthorized: process.env.NODE_ENV === 'production'
    }
  });
}

const FROM_NAME = process.env.SMTP_FROM_NAME || 'TubeKeter Analytics';
const FROM_ADDRESS = process.env.SMTP_FROM || process.env.SMTP_USER || 'noreply@revketer.ai';
const FRONTEND_URL = process.env.VITE_FRONTEND_URL || process.env.FRONTEND_URL || process.env.SERVICE_URL_FRONTEND || 'http://localhost:5173';

/**
 * Send organization invitation email via SMTP
 */
async function sendInvitationEmail(organizationId, organizationName, inviteeEmail, inviterEmail, role, token) {
  const inviteUrl = `${FRONTEND_URL}/accept-invite?org=${organizationId}&token=${token}`;
  const roleLabel = role === 'admin' ? 'Admin Access' : role === 'write' ? 'Write Access' : 'Read Access';

  const transporter = createTransporter();

  const info = await transporter.sendMail({
    from: `"${FROM_NAME}" <${FROM_ADDRESS}>`,
    to: inviteeEmail,
    subject: `You're invited to join ${organizationName} on TubeKeter Analytics`,
    html: `
      <div style="font-family: 'Inter', -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; max-width: 600px; margin: 0 auto; padding: 20px; color: #111827; background-color: #f9fafb;">
        <div style="text-align: center; margin-bottom: 24px;">
          <img src="${FRONTEND_URL}/TubeKeter.svg" alt="TubeKeter Analytics" style="height: 40px; margin: 0 auto;" />
        </div>
        <div style="background: white; border-radius: 8px; border: 1px solid #e5e7eb; padding: 32px; box-shadow: 0 1px 3px 0 rgba(0, 0, 0, 0.1);">
          <h2 style="color: #111827; margin-top: 0; margin-bottom: 16px; font-size: 24px; font-weight: 600; text-align: center;">You're Invited!</h2>
          <p style="font-size: 16px; line-height: 1.5; color: #4b5563; text-align: center; margin-bottom: 24px;">
            <strong>${inviterEmail}</strong> has invited you to join <strong>${organizationName}</strong> on TubeKeter Analytics.
          </p>

          <div style="background: #f9fafb; border-radius: 6px; border: 1px solid #e5e7eb; padding: 20px; margin: 24px 0;">
            <h3 style="margin-top: 0; color: #6b7280; font-size: 12px; font-weight: 600; text-transform: uppercase; letter-spacing: 0.05em; margin-bottom: 12px;">Invitation Details</h3>
            <table style="width: 100%; border-collapse: collapse;">
              <tr>
                <td style="padding: 8px 0; color: #6b7280; font-size: 14px; width: 130px; border-bottom: 1px solid #f3f4f6;">Organization</td>
                <td style="padding: 8px 0; font-weight: 600; font-size: 14px; color: #111827; border-bottom: 1px solid #f3f4f6;">${organizationName}</td>
              </tr>
              <tr>
                <td style="padding: 8px 0; color: #6b7280; font-size: 14px; border-bottom: 1px solid #f3f4f6;">Your Role</td>
                <td style="padding: 8px 0; font-weight: 600; font-size: 14px; color: #111827; border-bottom: 1px solid #f3f4f6;">${roleLabel}</td>
              </tr>
              <tr>
                <td style="padding: 8px 0; color: #6b7280; font-size: 14px;">Invited by</td>
                <td style="padding: 8px 0; font-size: 14px; color: #111827;">${inviterEmail}</td>
              </tr>
            </table>
          </div>

          <div style="margin: 32px 0; text-align: center;">
            <a href="${inviteUrl}"
               style="background: #3b82f6; color: white; padding: 12px 32px; text-decoration: none; font-weight: 500; font-size: 16px; border-radius: 6px; display: inline-block; transition: background-color 0.2s;">
              Accept Invitation
            </a>
          </div>

          <p style="color: #6b7280; font-size: 14px; text-align: center; line-height: 1.5; margin-bottom: 0;">
            This invitation expires in 7 days. If you don't want to join this organization, you can safely ignore this email.
          </p>
        </div>

        <div style="text-align: center; margin-top: 24px;">
          <p style="color: #9ca3af; font-size: 12px; margin: 0;">
            &copy; ${new Date().getFullYear()} TubeKeter Analytics. All rights reserved.
          </p>
        </div>
      </div>
    `
  });

  console.log('[EMAIL] Invitation sent to:', inviteeEmail, '| messageId:', info.messageId);
  return { success: true, messageId: info.messageId };
}

/**
 * Send ownership transfer invitation email via SMTP
 */
async function sendOwnershipTransferEmail(organizationId, organizationName, newOwnerEmail, currentOwnerEmail, token) {
  const transferUrl = `${FRONTEND_URL}/accept-invite?type=transfer&org=${organizationId}&token=${token}`;

  const transporter = createTransporter();

  const info = await transporter.sendMail({
    from: `"${FROM_NAME}" <${FROM_ADDRESS}>`,
    to: newOwnerEmail,
    subject: `Ownership Transfer: ${organizationName} on TubeKeter Analytics`,
    html: `
      <div style="font-family: 'Inter', -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; max-width: 600px; margin: 0 auto; padding: 20px; color: #111827; background-color: #f9fafb;">
        <div style="text-align: center; margin-bottom: 24px;">
          <img src="${FRONTEND_URL}/TubeKeter.svg" alt="TubeKeter Analytics" style="height: 40px; margin: 0 auto;" />
        </div>
        <div style="background: white; border-radius: 8px; border: 1px solid #e5e7eb; padding: 32px; box-shadow: 0 1px 3px 0 rgba(0, 0, 0, 0.1);">
          <h2 style="color: #111827; margin-top: 0; margin-bottom: 16px; font-size: 24px; font-weight: 600; text-align: center;">Ownership Transfer Request</h2>
          <p style="font-size: 16px; line-height: 1.5; color: #4b5563; text-align: center; margin-bottom: 24px;">
            <strong>${currentOwnerEmail}</strong> wants to transfer ownership of <strong>${organizationName}</strong> to you on TubeKeter Analytics.
          </p>

          <div style="background: #fffbeb; border-left: 4px solid #f59e0b; padding: 16px 20px; margin: 24px 0; border-radius: 0 6px 6px 0;">
            <p style="margin: 0; color: #b45309; font-size: 14px; font-weight: 600;">Important</p>
            <p style="margin: 6px 0 0; color: #b45309; font-size: 14px; line-height: 1.5;">
              By accepting, you will become the organization owner with full control.
              ${currentOwnerEmail} will become an Admin member.
            </p>
          </div>

          <div style="background: #f9fafb; border-radius: 6px; border: 1px solid #e5e7eb; padding: 20px; margin: 24px 0;">
            <h3 style="margin-top: 0; color: #6b7280; font-size: 12px; font-weight: 600; text-transform: uppercase; letter-spacing: 0.05em; margin-bottom: 12px;">Transfer Details</h3>
            <table style="width: 100%; border-collapse: collapse;">
              <tr>
                <td style="padding: 8px 0; color: #6b7280; font-size: 14px; width: 130px; border-bottom: 1px solid #f3f4f6;">Organization</td>
                <td style="padding: 8px 0; font-weight: 600; font-size: 14px; color: #111827; border-bottom: 1px solid #f3f4f6;">${organizationName}</td>
              </tr>
              <tr>
                <td style="padding: 8px 0; color: #6b7280; font-size: 14px; border-bottom: 1px solid #f3f4f6;">Current Owner</td>
                <td style="padding: 8px 0; font-size: 14px; color: #111827; border-bottom: 1px solid #f3f4f6;">${currentOwnerEmail}</td>
              </tr>
              <tr>
                <td style="padding: 8px 0; color: #6b7280; font-size: 14px;">New Owner</td>
                <td style="padding: 8px 0; font-weight: 600; font-size: 14px; color: #111827;">${newOwnerEmail}</td>
              </tr>
            </table>
          </div>

          <div style="margin: 32px 0; display: flex; gap: 12px; justify-content: center;">
            <a href="${transferUrl}"
               style="background: #3b82f6; color: white; padding: 12px 24px; text-decoration: none; font-weight: 500; font-size: 14px; border-radius: 6px; display: inline-block; transition: background-color 0.2s;">
              Accept Ownership
            </a>
            <a href="${transferUrl}"
               style="background: white; color: #374151; padding: 11px 24px; text-decoration: none; font-weight: 500; font-size: 14px; border-radius: 6px; border: 1px solid #d1d5db; display: inline-block; transition: background-color 0.2s;">
              View Details
            </a>
          </div>

          <p style="color: #6b7280; font-size: 14px; text-align: center; line-height: 1.5; margin-bottom: 0;">
            This invitation expires in 7 days. If you decline or don't respond, <strong>${currentOwnerEmail}</strong> will remain the owner.
          </p>
        </div>

        <div style="text-align: center; margin-top: 24px;">
          <p style="color: #9ca3af; font-size: 12px; margin: 0;">
            &copy; ${new Date().getFullYear()} TubeKeter Analytics. All rights reserved.
          </p>
        </div>
      </div>
    `
  });

  console.log('[EMAIL] Ownership transfer email sent to:', newOwnerEmail, '| messageId:', info.messageId);
  return { success: true, messageId: info.messageId };
}

/**
 * Send an audit-complete email via SMTP (video audit or channel audit).
 */
async function sendAuditCompleteEmail(toEmail, { channelName, score, auditType }) {
  const isVideo = auditType === 'video';
  const isThumb = auditType === 'thumbnail';
  const isPlaylist = auditType === 'playlist';
  const link = `${FRONTEND_URL}/${isVideo ? 'video-audit' : isThumb ? 'thumbnail-optimizer' : isPlaylist ? 'playlist-optimizer' : 'audit'}`;
  const title = isVideo ? 'Video Audit' : isThumb ? 'Thumbnail Optimizer' : isPlaylist ? 'Playlist Optimizer' : 'Channel Audit';
  const subject = `Your ${channelName || 'channel'} ${isVideo ? 'video audit' : isThumb ? 'thumbnail analysis' : isPlaylist ? 'playlist analysis' : 'audit'} is ready`;
  const scoreLine = isThumb || isPlaylist ? 'See your results inside.' : score != null ? `Score: ${score}/100` : 'See your results inside.';

  const transporter = createTransporter();

  const info = await transporter.sendMail({
    from: `"${FROM_NAME}" <${FROM_ADDRESS}>`,
    to: toEmail,
    subject,
    html: `
      <div style="font-family: 'Inter', -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; max-width: 600px; margin: 0 auto; padding: 20px; color: #111827; background-color: #f9fafb;">
        <div style="text-align: center; margin-bottom: 24px;">
          <img src="${FRONTEND_URL}/TubeKeter.svg" alt="TubeKeter Analytics" style="height: 40px; margin: 0 auto;" />
        </div>
        <div style="background: white; border-radius: 8px; border: 1px solid #e5e7eb; padding: 32px; box-shadow: 0 1px 3px 0 rgba(0, 0, 0, 0.1);">
          <h2 style="color: #111827; margin-top: 0; margin-bottom: 16px; font-size: 24px; font-weight: 600; text-align: center;">${title} Complete</h2>
          <p style="font-size: 16px; line-height: 1.5; color: #4b5563; text-align: center; margin-bottom: 16px;">
            Your audit for <strong>${channelName || 'your channel'}</strong> is ready to review.
          </p>
          <div style="background: #f9fafb; border-radius: 6px; border: 1px solid #e5e7eb; padding: 16px; margin: 24px 0; text-align: center;">
            <p style="margin: 0; color: #6b7280; font-size: 13px; text-transform: uppercase; letter-spacing: 0.05em;">${scoreLine}</p>
          </div>
          <div style="margin: 32px 0; text-align: center;">
            <a href="${link}"
               style="background: #3b82f6; color: white; padding: 12px 32px; text-decoration: none; font-weight: 500; font-size: 16px; border-radius: 6px; display: inline-block; transition: background-color 0.2s;">
              View Results
            </a>
          </div>
        </div>
        <div style="text-align: center; margin-top: 24px;">
          <p style="color: #9ca3af; font-size: 12px; margin: 0;">
            &copy; ${new Date().getFullYear()} TubeKeter Analytics. All rights reserved.
          </p>
        </div>
      </div>
    `
  });

  console.log('[EMAIL] Audit complete email sent to:', toEmail, '| messageId:', info.messageId);
  return { success: true, messageId: info.messageId };
}

module.exports = {
  sendInvitationEmail,
  sendOwnershipTransferEmail,
  sendAuditCompleteEmail
};
