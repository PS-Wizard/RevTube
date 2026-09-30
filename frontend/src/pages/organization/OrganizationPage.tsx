import {
  ChevronRight,
  ListVideo,
  Lock,
  Search,
  SquarePen,
  Trash2,
  Tv,
  UserPlus,
} from "lucide-react";
import React, { useEffect, useRef, useState } from "react";
import toast from "react-hot-toast";
import { useNavigate } from "react-router-dom";
import AddListModal from "../../components/AddListModal";
import { Button } from "@/components/ui";
import { EmptyState } from "../../components/EmptyState";
import InviteMemberModal from "../../components/InviteMemberModal";
import { SkeletonList } from "../../components/SkeletonLoaders";
import TransferOwnershipModal from "../../components/TransferOwnershipModal";
import { useAuth } from "../../hooks/useAuth";
import { useConfirm } from "../../hooks/useConfirm";
import { useOrganization } from "../../hooks/useOrganization";
import { queryClient } from "../../lib/queryClient";
import {
  cancelInvitation,
  getOrganizationInvitations,
  resendInvitation,
} from "../../services/invitationService";
import {
  addChannelToOrganization,
  getOrganizationChannels,
  removeChannelFromOrganization,
  type OrganizationChannel,
} from "../../services/organizationChannelService";
import {
  getOrganizationLists,
  saveOrganizationList,
} from "../../services/organizationListService";
import {
  deleteOrganization,
  getOrganizationMembers,
  leaveOrganization,
  removeMember,
  transferOwnership,
  updateMemberRole,
  updateOrganization,
} from "../../services/organizationService";
import type { SavedList } from "../../services/savedListService";
import type {
  OrganizationInvitation,
  OrganizationMember,
} from "../../types/organization";
import { DEFAULT_LIST_COLOR } from "../../utils/chartTheme";
import { REVTUBE_DASHBOARD_WS_ROOT } from "../../utils/dashboardWorkspaceScope";
import "./OrganizationPage.css";

const formatDate = (timestamp: number) =>
  new Date(timestamp).toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
  });

const getRoleDisplayName = (role: string) => {
  switch (role) {
    case "owner":
      return "Owner";
    case "admin":
      return "Admin";
    case "write":
      return "Editor";
    case "read":
      return "Viewer";
    default:
      return role;
  }
};

const OrganizationPage: React.FC = () => {
  const { user, loginWithYouTube, isResumingOAuth } = useAuth();
  const {
    currentOrganization,
    isOwner,
    canInvite,
    canManageMembers,
    canAccessSettings,
    refreshOrganizations,
    setCurrentOrganization,
  } = useOrganization();

  const { confirm, ConfirmationModal } = useConfirm();
  const navigate = useNavigate();

  const [members, setMembers] = useState<OrganizationMember[]>([]);
  const [invitations, setInvitations] = useState<OrganizationInvitation[]>([]);
  const [channels, setChannels] = useState<OrganizationChannel[]>([]);
  const [lists, setLists] = useState<SavedList[]>([]);
  const [loading, setLoading] = useState(true);
  const [showInviteModal, setShowInviteModal] = useState(false);
  const [showTransferModal, setShowTransferModal] = useState(false);
  const [expandedChannels, setExpandedChannels] = useState<Set<string>>(
    new Set(),
  );
  const [showAddListModal, setShowAddListModal] = useState(false);
  const [addListChannelId, setAddListChannelId] = useState<string | null>(null);
  const [orgName, setOrgName] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [resendTimers, setResendTimers] = useState<Record<string, number>>({});
  const [editingName, setEditingName] = useState(false);
  const nameInputRef = useRef<HTMLInputElement>(null);
  const [memberSearch, setMemberSearch] = useState("");

  useEffect(() => {
    const interval = setInterval(() => {
      setResendTimers((prev) => {
        let updated = false;
        const next = { ...prev };
        for (const key in next) {
          if (next[key] > 0) {
            next[key] -= 1;
            updated = true;
          }
        }
        return updated ? next : prev;
      });
    }, 1000);
    return () => clearInterval(interval);
  }, []);

  useEffect(() => {
    if (currentOrganization) {
      setOrgName(currentOrganization.name);
      loadOrganizationData();
    }
  }, [currentOrganization]);

  useEffect(() => {
    if (editingName && nameInputRef.current) {
      nameInputRef.current.focus();
      nameInputRef.current.select();
    }
  }, [editingName]);

  const loadOrganizationData = async () => {
    if (!currentOrganization) return;
    try {
      setLoading(true);
      const [membersData, invitationsData, channelsData, listsData] =
        await Promise.all([
          getOrganizationMembers(currentOrganization.id),
          getOrganizationInvitations(currentOrganization.id),
          getOrganizationChannels(currentOrganization.id),
          getOrganizationLists(currentOrganization.id),
        ]);
      setMembers(membersData);
      setInvitations(invitationsData);
      setChannels(channelsData);
      setLists(listsData);
    } catch (err) {
      setError("Failed to load organization data");
    } finally {
      setLoading(false);
    }
  };

  /* ── Hero: rename ─────────────────────────────────────────────── */
  const handleSaveOrgName = async () => {
    if (!currentOrganization || !orgName.trim() || !canAccessSettings) return;
    if (orgName.trim() === currentOrganization.name) {
      setEditingName(false);
      return;
    }
    try {
      setSaving(true);
      await updateOrganization(currentOrganization.id, {
        name: orgName.trim(),
      });
      await refreshOrganizations();
      toast.success("Organization name updated");
      setError(null);
      setEditingName(false);
    } catch (err: any) {
      toast.error(err.message || "Failed to update organization name");
    } finally {
      setSaving(false);
    }
  };

  const handleCancelEdit = () => {
    setOrgName(currentOrganization?.name || "");
    setEditingName(false);
  };

  /* ── Danger zone ──────────────────────────────────────────────── */
  const handleDeleteOrganization = async () => {
    if (!currentOrganization || !user) return;
    const confirmed = await confirm(
      `Are you sure you want to delete "${currentOrganization.name}"? This action cannot be undone.`,
      { title: "Delete organization?", confirmLabel: "Delete" },
    );
    if (!confirmed) return;
    try {
      await deleteOrganization(currentOrganization.id);
      await setCurrentOrganization(null);
      await refreshOrganizations();
      navigate("/");
    } catch (err: any) {
      setError(err.message || "Failed to delete organization");
    }
  };

  const handleLeaveOrganization = async () => {
    if (!currentOrganization || !user) return;
    const confirmed = await confirm(
      `Are you sure you want to leave "${currentOrganization.name}"?`,
      {
        title: "Leave organization?",
        confirmLabel: "Leave",
      },
    );
    if (!confirmed) return;
    try {
      await leaveOrganization(currentOrganization.id, user.uid);
      await setCurrentOrganization(null);
      await refreshOrganizations();
    } catch (err: any) {
      setError(err.message || "Failed to leave organization");
    }
  };

  /* ── Members ──────────────────────────────────────────────────── */
  const handleMemberRoleChange = async (
    userId: string,
    newRole: "admin" | "read" | "write",
  ) => {
    if (!currentOrganization) return;
    const member = members.find((m) => m.userId === userId);
    const confirmed = await confirm(
      `Change ${member?.email ?? "this member"}'s role to ${getRoleDisplayName(newRole)}?`,
      {
        title: "Change member role?",
        confirmLabel: "Update role",
      },
    );
    if (!confirmed) return;
    try {
      await updateMemberRole(currentOrganization.id, userId, newRole);
      await loadOrganizationData();
      toast.success("Role updated");
    } catch (err: any) {
      toast.error(err.message || "Failed to update role");
    }
  };

  const handleRemoveMember = async (userId: string) => {
    if (!currentOrganization) return;
    const member = members.find((m) => m.userId === userId);
    if (!member) return;
    const confirmed = await confirm(
      `Remove ${member.email} from "${currentOrganization.name}"?`,
      {
        title: "Remove member?",
        confirmLabel: "Remove",
      },
    );
    if (!confirmed) return;
    try {
      await removeMember(currentOrganization.id, userId);
      await loadOrganizationData();
      toast.success("Member removed");
    } catch (err: any) {
      toast.error(err.message || "Failed to remove member");
    }
  };

  /* ── Invitations ──────────────────────────────────────────────── */
  const handleCancelInvitation = async (inviteId: string) => {
    if (!currentOrganization) return;
    try {
      await cancelInvitation(currentOrganization.id, inviteId);
      await loadOrganizationData();
      toast.success("Invitation cancelled");
    } catch (err: any) {
      toast.error(err.message || "Failed to cancel invitation");
    }
  };

  const handleResendInvitation = async (inviteId: string) => {
    if (!currentOrganization || !user || resendTimers[inviteId] > 0) return;
    try {
      await resendInvitation(
        currentOrganization.id,
        inviteId,
        user.email || "",
      );
      toast.success("Invitation resent");
      setResendTimers((prev) => ({ ...prev, [inviteId]: 60 }));
    } catch (err: any) {
      toast.error(err.message || "Failed to resend invitation");
    }
  };

  /* ── Ownership transfer ───────────────────────────────────────── */
  const handleTransferOwnership = async (newOwnerId: string) => {
    if (!currentOrganization || !user) return;
    try {
      await transferOwnership(currentOrganization.id, user.uid, newOwnerId);
      const member = members.find((m) => m.userId === newOwnerId);
      if (member) {
        toast.success(`Transfer invitation sent to ${member.email}`, {
          duration: 5000,
        });
      }
    } catch (err: any) {
      toast.error(err.message || "Failed to send transfer invitation");
      throw err;
    }
  };

  /* ── Channels & lists ─────────────────────────────────────────── */
  const handleRemoveChannel = async (
    channelId: string,
    channelTitle: string,
  ) => {
    if (!currentOrganization) return;
    const confirmed = await confirm(
      `Remove channel "${channelTitle}" from "${currentOrganization.name}"? Analytics will no longer be available for this channel.`,
      { title: "Remove channel?", confirmLabel: "Remove" },
    );
    if (!confirmed) return;
    try {
      await removeChannelFromOrganization(currentOrganization.id, channelId);
      // Invalidate shared React Query cache so DashboardPage channel selector
      // updates immediately without requiring a page reload.
      queryClient.invalidateQueries({ queryKey: [REVTUBE_DASHBOARD_WS_ROOT] });
      await loadOrganizationData();
      toast.success("Channel removed");
    } catch (err: any) {
      toast.error(err.message || "Failed to remove channel");
    }
  };

  const toggleChannelAccordion = (channelId: string) => {
    setExpandedChannels((prev) => {
      const next = new Set(prev);
      if (next.has(channelId)) {
        next.delete(channelId);
      } else {
        next.add(channelId);
      }
      return next;
    });
  };

  const [isConnectingChannel, setIsConnectingChannel] = useState(false);
  // Redirect-based (mobile PWA) OAuth completion may be in flight on load.
  const connectBusy = isConnectingChannel || isResumingOAuth;

  const handleConnectChannel = async () => {
    // Don't start a second flow while a redirect-based completion is in flight.
    if (isResumingOAuth) return;
    // Only organization owners and admins can add channels
    if (!canManageMembers) {
      toast.error(
        "Only organization owners and admins can add channels. Please ask your organization owner or admin to connect channels.",
      );
      return;
    }

    setIsConnectingChannel(true);
    // Immediately show the channels list as loading so the user sees progress
    setLoading(true);
    const connectToast = toast.loading("Connecting channel...");
    try {
      const newTokens = await loginWithYouTube();
      if (!newTokens || !currentOrganization || !user?.uid) {
        toast.dismiss(connectToast);
        // loginWithYouTube already sets authError -- show a toast too so
        // the user sees it immediately on the org page
        if (!newTokens) {
          toast.error(
            "This Google account has no YouTube channel. Create one first or sign in with a different account.",
            { id: connectToast },
          );
        }
        setIsConnectingChannel(false);
        setLoading(false);
        return;
      }

      let added = 0;
      for (const token of newTokens) {
        if (!token.channelId) continue;
        try {
          await addChannelToOrganization(
            currentOrganization.id,
            token.channelId,
            token.channelTitle || "",
            token.thumbnailUrl,
            user.uid,
            false,
            token.accessToken && token.refreshToken
              ? {
                  accessToken: token.accessToken,
                  refreshToken: token.refreshToken,
                  expiresAt: token.expiresAt,
                }
              : undefined,
          );
          added++;
        } catch (err) {
          console.error("Failed to register channel in organization:", err);
        }
      }

      if (added > 0) {
        // Invalidate dashboard channels query so the channel list updates everywhere immediately
        queryClient.invalidateQueries({
          queryKey: [REVTUBE_DASHBOARD_WS_ROOT],
        });
        // Refresh the org data -- the list stays in loading state until this completes
        await loadOrganizationData();
        toast.success(
          `${added} channel${added > 1 ? "s" : ""} connected successfully`,
          { id: connectToast },
        );
      } else {
        toast.error("No channels were connected. Please try again.", {
          id: connectToast,
        });
      }
    } catch (err) {
      console.error("Connect channel error:", err);
      toast.error("Failed to connect channel. Please try again.", {
        id: connectToast,
      });
    } finally {
      setIsConnectingChannel(false);
    }
  };

  const handleCreateList = async (
    ids: string[],
    metadata: {
      name: string;
      date: string;
      color: string;
      annotationTitle: string;
    },
  ) => {
    if (!currentOrganization || !user?.uid || !addListChannelId) return;
    try {
      const list: SavedList = {
        id: Date.now().toString(),
        name: metadata.name,
        videoIds: ids,
        trackDate: metadata.date,
        color: metadata.color,
        annotations: [{ date: metadata.date, title: metadata.annotationTitle }],
        channelId: addListChannelId,
        createdAt: Date.now(),
        organizationId: currentOrganization.id,
        createdBy: user.uid,
      };

      await saveOrganizationList(currentOrganization.id, list, user.uid);
      await loadOrganizationData();
      toast.success("List created successfully");
    } catch (err) {
      console.error("List creation failed", err);
      toast.error("Failed to create and save list.");
    } finally {
      setShowAddListModal(false);
      setAddListChannelId(null);
    }
  };

  /* ── Derived data ─────────────────────────────────────────────── */
  const pendingInvitations = invitations.filter(
    (inv) => inv.status === "pending",
  );

  const filteredMembers = members.filter((m) =>
    m.email.toLowerCase().includes(memberSearch.toLowerCase()),
  );

  /* ── Guard states ─────────────────────────────────────────────── */
  if (!canAccessSettings) {
    return (
      <div className="org-page">
        <EmptyState
          title="Access Denied"
          description="You don't have permission to access organization settings."
          icon={<Lock size={32} />}
        />
      </div>
    );
  }

  if (!currentOrganization) {
    return (
      <div className="org-page">
        <EmptyState
          title="No Organization Selected"
          description="Select an organization from the sidebar to manage its settings."
          icon={<Tv size={32} />}
        />
      </div>
    );
  }

  /* ── Main page ────────────────────────────────────────────────── */
  return (
    <div className="org-page">
      {/* ── Hero header ───────────────────────────────────────── */}
      <section className="org-card org-hero">
        <div className="org-hero__left">
          <div className="org-avatar">
            {currentOrganization.name.charAt(0).toUpperCase()}
          </div>
          <div className="org-hero__text">
            {editingName && canAccessSettings ? (
              <div className="org-name-edit">
                <input
                  ref={nameInputRef}
                  className="org-name-input"
                  value={orgName}
                  onChange={(e) => setOrgName(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter") handleSaveOrgName();
                    if (e.key === "Escape") handleCancelEdit();
                  }}
                  disabled={saving}
                />
                <Button variant="ghost" size="icon" bare
                  onClick={handleSaveOrgName}
                 
                  disabled={saving || !orgName.trim()}
                >
                  {saving ? "Saving..." : "Save"}
                </Button>
                <Button variant="ghost" size="icon" bare
                  onClick={handleCancelEdit}
                 
                >
                  Cancel
                </Button>
              </div>
            ) : (
              <div className="org-name-row">
                <h1 className="org-name">{currentOrganization.name}</h1>
                {canAccessSettings && (
                  <Button variant="ghost" size="icon" bare
                   
                    onClick={() => setEditingName(true)}
                    aria-label="Edit organization name"
                    title="Edit name"
                  >
                    <SquarePen size={13} />
                  </Button>
                )}
              </div>
            )}
            <p className="org-hero__subtitle">Team workspace</p>
            <div className="org-hero__meta">
              <span className="org-pill">
                {members.length}{" "}
                {members.length === 1 ? "member" : "members"}
              </span>
              {pendingInvitations.length > 0 && (
                <span className="org-pill org-pill--pending">
                  {pendingInvitations.length} pending
                </span>
              )}
            </div>
          </div>
        </div>

        {canInvite && (
          <Button
            variant="primary"
            size="sm"
            onClick={() => setShowInviteModal(true)}
          >
            <UserPlus size={15} />
            Invite Member
          </Button>
        )}
      </section>

      {/* ── Error banner ──────────────────────────────────────── */}
      {error && (
        <div className="org-error-banner" role="alert">
          <span>{error}</span>
          <Button variant="ghost" bare
           
            onClick={() => setError(null)}
            aria-label="Dismiss error"
          >
            ✕
          </Button>
        </div>
      )}

      {/* ── Team Members ──────────────────────────────────────── */}
      <section className="org-card">
        <div className="org-card__header">
          <h2 className="org-card__title">Team Members</h2>
          <div className="org-search">
            <Search size={14} />
            <input
              className="rt-input-native"
              value={memberSearch}
              onChange={(e) => setMemberSearch(e.target.value)}
              placeholder="Search members..."
              aria-label="Search members"
            />
          </div>
        </div>

        {loading ? (
          <SkeletonList items={4} />
        ) : filteredMembers.length === 0 ? (
          <EmptyState
            variant="no-results"
            title="No Members Found"
            description="No members match your search or filter criteria."
          />
        ) : (
          <div className="org-table-scroll">
            <table className="org-table">
              <thead>
                <tr>
                  <th>User</th>
                  <th>Role</th>
                  <th>Joined</th>
                  <th className="org-table__right">Action</th>
                </tr>
              </thead>
              <tbody>
                {filteredMembers.map((member) => {
                  const canEditMember =
                    canManageMembers &&
                    member.role !== "owner" &&
                    member.userId !== user?.uid &&
                    (isOwner || member.role !== "admin");
                  const canRemoveMember =
                    canManageMembers &&
                    member.role !== "owner" &&
                    member.userId !== user?.uid;

                  return (
                    <tr key={member.userId}>
                      <td>
                        <div className="org-member-cell">
                          <div className="org-member-avatar">
                            {member.email.charAt(0).toUpperCase()}
                          </div>
                          <span className="org-member-email">
                            {member.email}
                            {member.userId === user?.uid && (
                              <span className="org-member-you">You</span>
                            )}
                          </span>
                        </div>
                      </td>
                      <td>
                        {member.role === "owner" || !canEditMember ? (
                          <span
                            className={`org-role-badge org-role-badge--${member.role}`}
                          >
                            {getRoleDisplayName(member.role)}
                          </span>
                        ) : (
                          <select
                            value={member.role}
                            onChange={(e) =>
                              handleMemberRoleChange(
                                member.userId,
                                e.target.value as "admin" | "read" | "write",
                              )
                            }
                            className="org-role-select"
                            aria-label={`Role for ${member.email}`}
                          >
                            {isOwner && <option value="admin">Admin</option>}
                            <option value="write">Editor</option>
                            <option value="read">Viewer</option>
                          </select>
                        )}
                      </td>
                      <td className="org-cell-muted">
                        {formatDate(member.joinedAt)}
                      </td>
                      <td className="org-table__right">
                        {canRemoveMember && (
                          <Button variant="danger" size="icon" bare
                           
                            onClick={() => handleRemoveMember(member.userId)}
                            aria-label={`Remove ${member.email}`}
                            title="Remove member"
                          >
                            <Trash2 size={15} />
                          </Button>
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}

        {/* Pending invitations */}
        {!loading && pendingInvitations.length > 0 && (
          <>
            <div className="org-subheader">
              Pending Invitations ({pendingInvitations.length})
            </div>
            <ul className="org-invite-list">
              {pendingInvitations.map((invitation) => (
                <li key={invitation.id} className="org-invite-row">
                  <div className="org-member-cell">
                    <div className="org-member-avatar org-member-avatar--pending">
                      {invitation.email.charAt(0).toUpperCase()}
                    </div>
                    <div className="org-invite-info">
                      <span className="org-invite-email">
                        {invitation.email}
                      </span>
                      <span className="org-cell-muted">
                        Invited {formatDate(invitation.invitedAt)}
                      </span>
                    </div>
                  </div>
                  <span
                    className={`org-role-badge org-role-badge--${invitation.role}`}
                  >
                    {getRoleDisplayName(invitation.role)}
                  </span>
                  {canManageMembers && (
                    <div className="org-invite-actions">
                      <Button variant="ghost" size="icon" bare
                       
                        onClick={() => handleResendInvitation(invitation.id)}
                        disabled={resendTimers[invitation.id] > 0}
                      >
                        {resendTimers[invitation.id] > 0
                          ? `Resend in ${resendTimers[invitation.id]}s`
                          : "Resend"}
                      </Button>
                      <Button variant="danger" size="icon" bare
                       
                        onClick={() => handleCancelInvitation(invitation.id)}
                      >
                        Revoke
                      </Button>
                    </div>
                  )}
                </li>
              ))}
            </ul>
          </>
        )}
      </section>

      {/* ── Connected Channels & Lists ────────────────────────── */}
      <section className="org-card">
        <div className="org-card__header">
          <h2 className="org-card__title">Connected Channels</h2>
          {canManageMembers && (
            <Button
              variant="secondary"
              size="sm"
              onClick={handleConnectChannel}
              disabled={connectBusy}
            >
              {connectBusy ? "Connecting..." : (
                <>
                  <Tv size={15} />
                  Connect Channel
                </>
              )}
            </Button>
          )}
        </div>

        {loading ? (
          <SkeletonList items={2} />
        ) : channels.length === 0 ? (
          <EmptyState
            title="No Channels Connected"
            description="Channels connected to this organization will appear here."
            icon={<Tv size={32} />}
          />
        ) : (
          <div className="org-channels">
            {channels.map((channel) => {
              const isExpanded = expandedChannels.has(channel.id);
              const channelLists = lists.filter(
                (l) => l.channelId === channel.id,
              );
              return (
                <div
                  key={channel.id}
                  className="org-channel"
                >
                  <Button
                    variant="ghost"
                    bare
                    className="org-channel__trigger"
                    aria-expanded={isExpanded}
                    onClick={() => toggleChannelAccordion(channel.id)}
                  >
                    <span className="org-channel__head">
                      <ChevronRight
                        size={16}
                        className="org-chevron"
                        aria-hidden
                      />
                      {channel.thumbnailUrl ? (
                        <img
                          src={channel.thumbnailUrl}
                          alt=""
                          className="org-thumb"
                          referrerPolicy="no-referrer"
                        />
                      ) : (
                        <div className="org-thumb org-thumb--placeholder">
                          {channel.channelTitle.charAt(0).toUpperCase()}
                        </div>
                      )}
                      <span className="org-channel__id">
                        <span className="org-channel__name">
                          {channel.channelTitle}
                        </span>
                        <span className="org-cell-muted">
                          Connected {formatDate(channel.addedAt)}
                        </span>
                      </span>
                    </span>
                    <span className="org-channel__side">
                      {canManageMembers && (
                        <span
                          className="org-icon-btn org-icon-btn--danger"
                          role="button"
                          tabIndex={0}
                          aria-label={`Remove ${channel.channelTitle}`}
                          title="Remove channel"
                          onClick={(e) => {
                            e.stopPropagation();
                            handleRemoveChannel(
                              channel.id,
                              channel.channelTitle,
                            );
                          }}
                          onKeyDown={(e) => {
                            if (e.key === "Enter" || e.key === " ") {
                              e.stopPropagation();
                              handleRemoveChannel(
                                channel.id,
                                channel.channelTitle,
                              );
                            }
                          }}
                        >
                          <Trash2 size={15} />
                        </span>
                      )}
                      <span className="org-pill">
                        {channelLists.length}{" "}
                        {channelLists.length === 1 ? "Saved List" : "Saved Lists"}
                      </span>
                    </span>
                  </Button>

                  {isExpanded && (
                    <div className="org-channel__panel">
                      <div className="org-lists-panel">
                        <div className="org-lists-panel__header">
                          Saved Lists
                          <Button
                            variant="secondary"
                            size="xs"
                            onClick={() => {
                              setAddListChannelId(channel.id);
                              setShowAddListModal(true);
                            }}
                          >
                            Add List
                          </Button>
                        </div>
                        {channelLists.length === 0 ? (
                          <EmptyState
                            variant="zero"
                            title="No Lists Yet"
                            description="No lists for this channel yet."
                          />
                        ) : (
                          <ul className="org-list-rows">
                            {channelLists.map((list) => (
                              <li key={list.id} className="org-list-row">
                                <span className="org-list-name">
                                  <ListVideo size={14} aria-hidden />
                                  <i
                                    className="org-dot"
                                    style={{
                                      backgroundColor:
                                        list.color || DEFAULT_LIST_COLOR,
                                    }}
                                  />
                                  {list.name}
                                </span>
                                <span className="org-cell-muted">
                                  {list.videoIds.length} videos ·{" "}
                                  {formatDate(list.createdAt)}
                                </span>
                              </li>
                            ))}
                          </ul>
                        )}
                      </div>
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        )}
      </section>

      {/* ── Settings ──────────────────────────────────────────── */}
      <section className="org-card">
        <div className="org-card__header">
          <h2 className="org-card__title">Settings</h2>
        </div>
        <div className="org-setting-rows">
          {isOwner && (
            <div className="org-setting-row">
              <div className="org-setting-info">
                <span className="org-setting-label">Ownership Transfer</span>
                <span className="org-setting-desc">
                  Transfer ownership to another admin or editor. You become an
                  admin after the transfer is accepted.
                </span>
              </div>
              <Button
                variant="secondary"
                size="sm"
                onClick={() => setShowTransferModal(true)}
              >
                Transfer Ownership
              </Button>
            </div>
          )}
          <div className="org-setting-row">
            <div className="org-setting-info">
              <span className="org-setting-label">Organization ID</span>
              <code className="org-org-id">{currentOrganization.id}</code>
            </div>
          </div>
        </div>
      </section>

      {/* ── Danger Zone ───────────────────────────────────────── */}
      <section className="org-danger">
        <div>
          <h3 className="org-danger__title">
            {isOwner ? "Delete Organization" : "Leave Organization"}
          </h3>
          <p className="org-danger__desc">
            {isOwner
              ? `Once you delete "${currentOrganization.name}", there is no going back. All members, channels, and saved lists are removed. Please be certain.`
              : `You will immediately lose access to all shared channels and lists in "${currentOrganization.name}".`}
          </p>
        </div>
        {isOwner ? (
          <Button variant="danger" onClick={handleDeleteOrganization}>
            Delete Organization
          </Button>
        ) : (
          <Button variant="danger" onClick={handleLeaveOrganization}>
            Leave Organization
          </Button>
        )}
      </section>

      <InviteMemberModal
        isOpen={showInviteModal}
        onClose={() => setShowInviteModal(false)}
        onSuccess={() => loadOrganizationData()}
        organizationId={currentOrganization.id}
        isOwner={isOwner}
      />
      <TransferOwnershipModal
        isOpen={showTransferModal}
        onClose={() => setShowTransferModal(false)}
        onConfirm={handleTransferOwnership}
        members={members}
        currentUserId={user?.uid || ""}
        organizationName={currentOrganization.name}
      />
      <AddListModal
        isOpen={showAddListModal}
        onClose={() => {
          setShowAddListModal(false);
          setAddListChannelId(null);
        }}
        onSave={handleCreateList}
      />
      <ConfirmationModal />
    </div>
  );
};

export default OrganizationPage;
