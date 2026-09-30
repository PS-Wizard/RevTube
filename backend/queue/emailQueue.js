/**
 * Email queue processor -- handles async email sending (invitations,
 * ownership transfers, and future notification types).
 *
 * Job data format (varies by type):
 *   invitation:       { type:'sendInvitationEmail', organizationId, organizationName, inviteeEmail, inviterEmail, role, token }
 *   ownershipTransfer: { type:'sendOwnershipTransferEmail', organizationId, organizationName, newOwnerEmail, currentOwnerEmail, token }
 */

function createEmailProcessor(deps) {
  const { sendInvitationEmail, sendOwnershipTransferEmail, sendAuditCompleteEmail } = deps;

  return async function processEmail(job) {
    const jobType = job.data.type;

    if (!jobType) {
      throw new Error('Email job missing "type" field');
    }

    console.log(`[Queue] email:${jobType} → sending (job ${job.id})`);

    switch (jobType) {
      case 'sendInvitationEmail': {
        const { organizationId, organizationName, inviteeEmail, inviterEmail, role, token } = job.data;
        if (!organizationId || !inviteeEmail || !token) {
          throw new Error('Invitation email missing required fields');
        }
        const result = await sendInvitationEmail(
          organizationId, organizationName, inviteeEmail, inviterEmail, role, token,
        );
        job.updateProgress(100);
        console.log(`[Queue] email:invitation → sent to ${inviteeEmail} (messageId: ${result.messageId})`);
        return result;
      }

      case 'sendOwnershipTransferEmail': {
        const { organizationId, organizationName, newOwnerEmail, currentOwnerEmail, token } = job.data;
        if (!organizationId || !newOwnerEmail || !token) {
          throw new Error('Ownership transfer email missing required fields');
        }
        const result = await sendOwnershipTransferEmail(
          organizationId, organizationName, newOwnerEmail, currentOwnerEmail, token,
        );
        job.updateProgress(100);
        console.log(`[Queue] email:ownershipTransfer → sent to ${newOwnerEmail} (messageId: ${result.messageId})`);
        return result;
      }

      case 'sendAuditCompleteEmail': {
        const { toEmail, channelName, score, auditType } = job.data;
        if (!toEmail) {
          throw new Error('Audit complete email missing toEmail');
        }
        const result = await sendAuditCompleteEmail(toEmail, { channelName, score, auditType });
        job.updateProgress(100);
        console.log(`[Queue] email:auditComplete → sent to ${toEmail} (messageId: ${result.messageId})`);
        return result;
      }

      default:
        throw new Error(`Unknown email job type: ${jobType}`);
    }
  };
}

module.exports = { createEmailProcessor };
