import React, { useCallback, useEffect, useState } from 'react';
import { useLocation } from 'react-router-dom';
import { useQueryClient } from '@tanstack/react-query';
import { useAdminService } from '../../services/adminService';
import type { UserProfile } from '../../services/adminService';
import { MdPerson, MdVerified, MdStars, MdRefresh, MdSave, MdBarChart, MdAdminPanelSettings } from 'react-icons/md';
import { useFeatureConfig } from '../../hooks/useFeatureConfig';
import type { FeatureConfig, PageConfig } from '../../utils/featureConfigSchema';
import { AuditCriteriaEditor } from '../../components/admin/AuditCriteriaEditor';
import { useAuth } from '../../hooks/useAuth';
import { getFirebaseAuthHeader } from '../../services/authHeaders';
import { SkeletonTable } from '../../components/SkeletonLoaders';
import { Box, Button, Input, Toggle } from '../../components/ui';
import { PageHeader } from '../../components/PageHeader';
import { ConfirmModal } from '../../components/ConfirmModal';
import { EmptyState } from '../../components/EmptyState';
import { ChatPage } from '../chat/ChatPage';
import { AdminThumbnailOptimizer } from '../thumbnail-optimizer/AdminThumbnailOptimizer';
import { AdminPlaylistOptimizer } from '../playlist-optimizer/AdminPlaylistOptimizer';
import { PublicAuditPanel } from '../../components/admin/public-audit/PublicAuditPanel';
import { toast } from 'react-hot-toast';
import { getResolvedApiBaseUrl } from '../../utils/apiBase';
import { USAGE_QUERY_KEY } from '../../hooks/useUsage';
import './AdminPage.css';

const FILTER_LABELS = {
  all: 'All',
  admin: 'Admins',
  pro: 'Pro',
  free: 'Free',
} as const;

type AdminTab = 'users' | 'features' | 'danger' | 'chat' | 'thumbnail-optimizer' | 'playlist-optimizer' | 'audit-criteria' | 'public-audit';

/* Feature-controls table grouping — categories render as subheader rows with
   each feature's limiters inside. Keys missing here fall into "Other". */
const FEATURE_GROUPS: { title: string; keys: string[] }[] = [
  { title: 'Analytics & Discovery', keys: ['dashboard', 'videos', 'channel', 'playlists', 'compare', 'specificVideos'] },
  { title: 'Audits', keys: ['audit', 'auditVideos', 'videoAudit'] },
  { title: 'Optimizers', keys: ['thumbnailOptimizer', 'playlistOptimizer'] },
  { title: 'AI & Chat', keys: ['chat', 'captions'] },
  { title: 'Workspace', keys: ['goals', 'anomalies', 'optimized'] },
];


export const AdminPage: React.FC = () => {
  const queryClient = useQueryClient();
  const location = useLocation();

  // Derive active section from URL path
  const pathPart = location.pathname.split('/').pop() || '';
  const activeTab: AdminTab = pathPart === 'features'
    ? 'features'
    : pathPart === 'system'
      ? 'danger'
      : pathPart === 'ai-chat'
        ? 'chat'
        : pathPart === 'thumbnail-optimizer'
          ? 'thumbnail-optimizer'
          : pathPart === 'playlist-optimizer'
            ? 'playlist-optimizer'
            : pathPart === 'audit-criteria'
              ? 'audit-criteria'
              : pathPart === 'public-audit'
                ? 'public-audit'
                : 'users';
  const [users, setUsers] = useState<UserProfile[]>([]);
  const [searchTerm, setSearchTerm] = useState('');
  const [activeFilter, setActiveFilter] = useState<'all' | 'admin' | 'pro' | 'free'>('all');
  const [currentPage, setCurrentPage] = useState(1);
  const usersPerPage = 15;
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [updatingUid, setUpdatingUid] = useState<string | null>(null);
  const { fetchUsers, updateUserPackage, updateUserRole } = useAdminService();
  const { user: currentUser, refreshUserProfile, isCheckingAuth } = useAuth();
  const { config, refreshConfig } = useFeatureConfig();
  const baseUrl = getResolvedApiBaseUrl();

  const [featureDraft, setFeatureDraft] = useState<FeatureConfig>(config);
  const [savingConfig, setSavingConfig] = useState(false);
  const [configSaved, setConfigSaved] = useState(false);
  const [refreshingCache, setRefreshingCache] = useState(false);
  const [showRefreshConfirm, setShowRefreshConfirm] = useState(false);
  const [ingesting, setIngesting] = useState(false);
  const [showIngestConfirm, setShowIngestConfirm] = useState(false);
  const [cleaningSnapshots, setCleaningSnapshots] = useState(false);
  const [showSnapshotConfirm, setShowSnapshotConfirm] = useState(false);
  const [snapshotResult, setSnapshotResult] = useState<string | null>(null);

  useEffect(() => { 
    setFeatureDraft(config);
  }, [config]);

  const loadUsers = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const data = await fetchUsers();
      setUsers(data);
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : 'Failed to load users';
      setError(message);
    } finally {
      setLoading(false);
    }
  }, [fetchUsers]);

  useEffect(() => {
    // Wait for auth check to finish and user to be available before loading users.
    if (isCheckingAuth) return;
    if (!currentUser) return;
     
    void loadUsers();
  }, [isCheckingAuth, currentUser, loadUsers]);

  useEffect(() => {

    setCurrentPage(1);
  }, [searchTerm, activeFilter]);


  const handlePackageUpdate = async (uid: string, currentPackage: 'free' | 'pro') => {
    const newPackage = currentPackage === 'free' ? 'pro' : 'free';

    const targetUser = users.find((u) => u.uid === uid);
    const display = targetUser?.displayName || targetUser?.email || uid;
    const action = newPackage === 'pro' ? 'upgrade to Pro' : 'revoke Pro';
    const confirmed = window.confirm(`Do you really want to ${action} for ${display}?`);
    if (!confirmed) return;

    setUpdatingUid(uid);
    try {
      await updateUserPackage(uid, newPackage);
      setUsers((prev) => prev.map((u) => (u.uid === uid ? { ...u, package: newPackage } : u)));
      // If the currently signed-in user had their package changed, refresh profile
      if (currentUser && currentUser.uid === uid) {
        try {
          await refreshUserProfile();
        } catch {
          // ignore refresh errors; UI already updated optimistically
        }
      }
      toast.success('Package updated successfully');
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : 'Update failed';
      toast.error(message);
    } finally {
      setUpdatingUid(null);
    }
  };

  const handleRoleUpdate = async (uid: string, currentRole: 'admin' | 'user') => {
    const newRole = currentRole === 'admin' ? 'user' : 'admin';

    const targetUser = users.find((u) => u.uid === uid);
    const display = targetUser?.displayName || targetUser?.email || uid;
    const action = newRole === 'admin' ? 'grant admin' : 'revoke admin';
    const confirmed = window.confirm(`Do you really want to ${action} for ${display}?`);
    if (!confirmed) return;

    setUpdatingUid(uid);
    try {
      await updateUserRole(uid, newRole);
      setUsers((prev) => prev.map((u) => (u.uid === uid ? { ...u, role: newRole } : u)));
      // If the currently signed-in user had their role changed, refresh profile
      if (currentUser && currentUser.uid === uid) {
        try {
          await refreshUserProfile();
        } catch {
          // ignore refresh errors; UI already updated optimistically
        }
      }
      toast.success('Role updated successfully');
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : 'Role update failed';
      toast.error(message);
    } finally {
      setUpdatingUid(null);
    }
  };

  const updatePageConfig = (pageKey: string, field: keyof PageConfig, value: boolean | number | string) => {
    setFeatureDraft((prev) => ({
      ...prev,
      pages: { ...prev.pages, [pageKey]: { ...prev.pages[pageKey], [field]: value } },
    }));
    setConfigSaved(false);
  };

  // Feature-controls table data + row renderer (rows grouped by FEATURE_GROUPS).
  const pages: Record<string, PageConfig> = featureDraft.pages || {};
  const renderFeatureRow = (key: string, page: PageConfig) => (
    <tr key={key}>
      <td className="page-name-cell">{page.label}</td>
      <td>
        <Toggle
          checked={page.enabled}
          onChange={(checked) => updatePageConfig(key, 'enabled', checked)}
          ariaLabel={`Enable ${page.label}`}
        />
      </td>
      <td>
        <Toggle
          checked={page.premiumOnly}
          onChange={(checked) => updatePageConfig(key, 'premiumOnly', checked)}
          ariaLabel={`Premium only for ${page.label}`}
        />
      </td>
      <td>
        <Input
          type="number"
          compact
          className={`limit-input${page.premiumOnly ? ' disabled' : ''}`}
          value={page.freeLimit}
          min={-1}
          disabled={page.premiumOnly}
          onChange={(e) =>
            updatePageConfig(key, 'freeLimit', parseInt(e.target.value, 10) || -1)
          }
        />
      </td>
      <td>
        <Input
          type="number"
          compact
          className="limit-input"
          value={page.proLimit}
          min={-1}
          onChange={(e) =>
            updatePageConfig(key, 'proLimit', parseInt(e.target.value, 10) || -1)
          }
        />
      </td>
    </tr>
  );

  const saveFeatureConfig = async () => {
    setSavingConfig(true);
    try {
      const res = await fetch(`${baseUrl}/admin/config`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json', ...(await getFirebaseAuthHeader()) },
        body: JSON.stringify(featureDraft),
      });
      if (!res.ok) throw new Error('Failed to save config');
      await refreshConfig();
      queryClient.invalidateQueries({ queryKey: [USAGE_QUERY_KEY] });
      setConfigSaved(true);
      toast.success('Feature config saved');
      setTimeout(() => setConfigSaved(false), 3000);
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : 'Failed to save feature config';
      toast.error(message);
    } finally {
      setSavingConfig(false);
    }
  };

  const filteredUsers = users.filter((u) => {
    const matchesSearch =
      u.email?.toLowerCase().includes(searchTerm.toLowerCase()) ||
      u.displayName?.toLowerCase().includes(searchTerm.toLowerCase()) ||
      u.uid.includes(searchTerm);
    const matchesFilter =
      activeFilter === 'all'
        ? true
        : activeFilter === 'admin'
          ? u.role === 'admin'
          : activeFilter === 'pro'
            ? u.package === 'pro'
            : u.package !== 'pro';
    return matchesSearch && matchesFilter;
  });

  const totalPages = Math.ceil(filteredUsers.length / usersPerPage);
  const paginatedUsers = filteredUsers.slice(
    (currentPage - 1) * usersPerPage,
    currentPage * usersPerPage
  );

  const totalUsers = users.length;
  const proUsers = users.filter((u) => u.package === 'pro').length;
  const adminUsers = users.filter((u) => u.role === 'admin').length;
  const freeUsers = totalUsers - proUsers;

  const filterCounts = {
    all: totalUsers,
    admin: adminUsers,
    pro: proUsers,
    free: freeUsers,
  };

  const pageTitle = activeTab === 'chat'
    ? 'Admin AI Chat'
    : activeTab === 'thumbnail-optimizer'
      ? 'Admin Thumbnail Optimizer'
      : activeTab === 'playlist-optimizer'
        ? 'Admin Playlist Optimizer'
      : activeTab === 'audit-criteria'
        ? 'Admin Audit Criteria'
      : activeTab === 'public-audit'
        ? 'Admin Public Audit'
        : 'Admin';
  const pageDescription = activeTab === 'chat'
    ? 'Full-capability AI assistant with all analytics tools and strategic recommendations.'
    : activeTab === 'features'
      ? 'Page access and search limits per subscription tier.'
      : activeTab === 'danger'
        ? 'System administration, queues, and irreversible actions.'
      : activeTab === 'thumbnail-optimizer'
        ? 'Manually audit YouTube video thumbnails via AI visual analysis.'
      : activeTab === 'playlist-optimizer'
        ? 'Manually analyze YouTube video metadata and generate playlist optimization strategies via AI.'
      : activeTab === 'audit-criteria'
        ? 'Single source of truth for ALL audit scoring. Edit criterion weights, enable/disable parameters, set sub-audit contribution weights and grade bands, and configure the Thumbnail pillars & Playlist optimizer criteria -- changes apply to every audit on the next run.'
      : activeTab === 'public-audit'
        ? 'Audit any public YouTube channel without a connected account. Uses the live YouTube Data API plus the same admin-managed criteria and scoring engine as the Video Audit, and stores every report for later comparison.'
        : 'Manage system users, access levels, and billing packages.';

  return (
    <div className={`page-container admin-page${activeTab === 'chat' ? ' admin-page--chat' : ''}`}>
      {/* ── Page header ──────────────────────────────────────────── */}
      <PageHeader
        icon={<MdAdminPanelSettings size={20} />}
        title={pageTitle}
        subtitle={pageDescription}
        actions={
          activeTab === 'users' ? (
            <Button
              variant="secondary"
              size="sm"
              onClick={() => void loadUsers()}
              disabled={loading}
            >
              <MdRefresh size={16} aria-hidden />
              Refresh
            </Button>
          ) : undefined
        }
      />

      

      {/* ── Error banner (users only) ────────────────────────────── */}
      {activeTab === 'users' && error && (
        <div className="alert alert-error" role="alert">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden>
            <circle cx="12" cy="12" r="10" />
            <line x1="15" y1="9" x2="9" y2="15" />
            <line x1="9" y1="9" x2="15" y2="15" />
          </svg>
          <div className="alert-content">
            <h4>Unable to load users</h4>
            <p>{error}</p>
          </div>
          <Button variant="secondary" size="sm" onClick={() => void loadUsers()}>
            Try again
          </Button>
        </div>
      )}

      {/* ── Tab content ──────────────────────────────────────────── */}
      <div className="admin-content">

        {/* ════════════════ USERS TAB ════════════════════════════════ */}
        {activeTab === 'users' && (
          <div className="table-report">
            <header className="table-header table-header--surface">
              <div className="table-header-title">
                <h2 className="section-title">Users</h2>
                <p className="section-subtitle">
                  {filteredUsers.length === totalUsers
                    ? `${totalUsers} total · ${proUsers} Pro · ${adminUsers} admin`
                    : `${filteredUsers.length} of ${totalUsers} · ${proUsers} Pro · ${adminUsers} admin`}
                </p>
              </div>
              {/* ── Toolbar: filters + search ─────────────────────── */}
              <div className="admin-toolbar">
                <div role="group" aria-label="Filter users" className="rt-filter-chip-group">
                  {(['all', 'admin', 'pro', 'free'] as const).map((filter) => (
                    <Button
                      bare
                      key={filter}
                      className={`rt-filter-chip${activeFilter === filter ? ' is-active' : ''}`}
                      aria-pressed={activeFilter === filter}
                      onClick={() => setActiveFilter(filter)}
                    >
                      {FILTER_LABELS[filter]} ({filterCounts[filter]})
                    </Button>
                  ))}
                </div>

                <div className="admin-search">
                  <svg className="admin-search__icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden>
                    <circle cx="11" cy="11" r="8" />
                    <path d="M21 21l-4.3-4.3" />
                  </svg>
                  <input
                    type="text"
                    className="rt-input-native admin-search-input"
                    placeholder="Search name, email, or UID…"
                    value={searchTerm}
                    onChange={(e) => setSearchTerm(e.target.value)}
                  />
                </div>
              </div>
            </header>

            {loading && users.length === 0 ? (
              <SkeletonTable columns={6} rows={10} />
            ) : (
              <div className="table-card">
                <div className="table-wrapper has-pagination">
                  <table className="rt-data-table users-table">
                    <thead>
                      <tr>
                        <th>User</th>
                        <th>Role</th>
                        <th>Package</th>
                        <th>Created</th>
                        <th>Last sign in</th>
                        <th style={{ textAlign: 'center' }}>Manage Package</th>
                        <th style={{ textAlign: 'center' }}>Manage Role</th>
                      </tr>
                    </thead>
                    <tbody>
                      {paginatedUsers.length === 0 ? (
                        <tr>
                          <td colSpan={7} style={{ padding: 'var(--rt-space-6) var(--rt-space-4)' }}>
                            <EmptyState
                              variant="no-results"
                              title="No Users Found"
                              description="No users match your search or filter criteria."
                              action={
                                searchTerm || activeFilter !== 'all' ? (
                                  <Button
                                    variant="secondary"
                                    size="sm"
                                    onClick={() => {
                                      setSearchTerm('');
                                      setActiveFilter('all');
                                    }}
                                  >
                                    Reset Filters
                                  </Button>
                                ) : undefined
                              }
                            />
                          </td>
                        </tr>
                      ) : (
                        paginatedUsers.map((user) => (
                          <tr key={user.uid}>
                            <td className="user-cell">
                              {user.photoURL ? (
                                <img
                                  src={user.photoURL}
                                  alt=""
                                  className="user-avatar"
                                  referrerPolicy="no-referrer"
                                />
                              ) : (
                                <div className="user-avatar-placeholder">
                                  {user.displayName ? (
                                    user.displayName.charAt(0).toUpperCase()
                                  ) : (
                                    <MdPerson />
                                  )}
                                </div>
                              )}
                              <div className="user-info-text">
                                <span className="user-name">{user.displayName || 'No name'}</span>
                                <span className="user-email">{user.email}</span>
                              </div>
                            </td>
                            <td>
                              <span className={`admin-badge admin-badge--role-${user.role}`}>
                                {user.role === 'admin' && <MdVerified size={13} aria-hidden />}
                                {user.role}
                              </span>
                            </td>
                            <td>
                              <span className={`admin-badge admin-badge--package-${user.package}`}>
                                {user.package === 'pro' && <MdStars size={13} aria-hidden />}
                                {user.package}
                              </span>
                            </td>
                            <td className="date-cell">
                              {user.createdAt?._seconds
                                ? new Date(user.createdAt._seconds * 1000).toLocaleDateString(undefined, {
                                    month: 'short',
                                    day: 'numeric',
                                    year: 'numeric',
                                  })
                                : 'N/A'}
                            </td>
                            <td className="date-cell">
                              {user.lastLogin?._seconds
                                ? new Date(user.lastLogin._seconds * 1000).toLocaleDateString(undefined, {
                                    month: 'short',
                                    day: 'numeric',
                                    year: 'numeric',
                                  })
                                : 'N/A'}
                            </td>
                            <td style={{ textAlign: 'center' }}>
                              <Button
                                variant={user.package === 'free' ? 'primary' : 'secondary'}
                                size="sm"
                                onClick={() => void handlePackageUpdate(user.uid, user.package)}
                                disabled={updatingUid === user.uid}
                              >
                                {updatingUid === user.uid
                                  ? 'Working…'
                                  : user.package === 'free'
                                    ? 'Upgrade to Pro'
                                    : 'Revoke Pro'}
                              </Button>
                            </td>
                            <td style={{ textAlign: 'center' }}>
                              <Button
                                variant={user.role === 'admin' ? 'danger' : 'secondary'}
                                size="sm"
                                onClick={() => void handleRoleUpdate(user.uid, user.role)}
                                disabled={updatingUid === user.uid}
                              >
                                {updatingUid === user.uid
                                  ? 'Working…'
                                  : user.role === 'admin'
                                    ? 'Revoke admin'
                                    : 'Grant admin'}
                              </Button>
                            </td>
                          </tr>
                        ))
                      )}
                    </tbody>
                  </table>
                </div>

                {totalPages > 1 && (
                  <div className="pagination-container">
                    <span className="pagination-info">
                      Showing {(currentPage - 1) * usersPerPage + 1}–
                      {Math.min(currentPage * usersPerPage, filteredUsers.length)} of {filteredUsers.length}
                    </span>
                    <div className="pagination-controls">
                      <Button
                        variant="secondary"
                        size="sm"
                        disabled={currentPage === 1}
                        onClick={() => setCurrentPage((p) => p - 1)}
                      >
                        Previous
                      </Button>
                      <div className="pagination-pages">
                        {Array.from({ length: totalPages }, (_, i) => i + 1).map((page) => {
                          if (
                            page === 1 ||
                            page === totalPages ||
                            (page >= currentPage - 1 && page <= currentPage + 1)
                          ) {
                            return (
                              <Button
                                key={page}
                                variant={currentPage === page ? 'primary' : 'secondary'}
                                size="sm"
                                onClick={() => setCurrentPage(page)}
                              >
                                {page}
                              </Button>
                            );
                          }
                          if (page === currentPage - 2 || page === currentPage + 2) {
                            return (
                              <span key={page} className="pagination-ellipsis">
                                …
                              </span>
                            );
                          }
                          return null;
                        })}
                      </div>
                      <Button
                        variant="secondary"
                        size="sm"
                        disabled={currentPage === totalPages}
                        onClick={() => setCurrentPage((p) => p + 1)}
                      >
                        Next
                      </Button>
                    </div>
                  </div>
                )}
              </div>
            )}
          </div>
        )}

        {/* ════════════════ FEATURES TAB ═════════════════════════════ */}
        {activeTab === 'features' && (
          <div className="table-report">
            <header className="table-header table-header--surface">
              <div className="table-header-title">
                <h2 className="section-title">Feature controls</h2>
                <p className="section-subtitle">Page access and search limits per subscription tier.</p>
              </div>
              <div className="table-header-actions">
                <Button
                  variant="primary"
                  size="sm"
                  onClick={() => void saveFeatureConfig()}
                  disabled={savingConfig}
                >
                  <MdSave size={15} aria-hidden />
                  {savingConfig ? 'Saving…' : configSaved ? 'Saved' : 'Save changes'}
                </Button>
              </div>
            </header>

            <div className="table-card">
              <div className="table-wrapper">
                <table className="rt-data-table feature-controls-table">
                    <thead>
                      <tr>
                        <th>Page</th>
                        <th>Enabled</th>
                        <th>Premium only</th>
                        <th>
                          Free limit <span className="admin-limit-note">(-1 = unlimited)</span>
                        </th>
                        <th>
                          Pro limit <span className="admin-limit-note">(-1 = unlimited)</span>
                        </th>
                      </tr>
                    </thead>
                  <tbody>
                    {FEATURE_GROUPS.map((group) => {
                      const rows = group.keys.filter((k) => pages[k]);
                      if (rows.length === 0) return null;
                      return (
                        <React.Fragment key={group.title}>
                          <tr className="feature-group-row">
                            <td colSpan={5}>{group.title}</td>
                          </tr>
                          {rows.map((k) => renderFeatureRow(k, pages[k]))}
                        </React.Fragment>
                      );
                    })}
                    {(() => {
                      const grouped = new Set(FEATURE_GROUPS.flatMap((g) => g.keys));
                      const others = Object.keys(pages).filter((k) => !grouped.has(k));
                      if (others.length === 0) return null;
                      return (
                        <React.Fragment key="Other">
                          <tr className="feature-group-row">
                            <td colSpan={5}>Other</td>
                          </tr>
                          {others.map((k) => renderFeatureRow(k, pages[k]))}
                        </React.Fragment>
                      );
                    })()}
                  </tbody>
                </table>
              </div>
            </div>
          </div>
        )}

        {/* ════════════════ SYSTEM TAB ═══════════════════════════════ */}
        {activeTab === 'danger' && (
          <>
            {/* Queue Dashboard */}
            <div className="table-report">
              <header className="table-header table-header--surface">
                <div className="table-header-title">
                  <h2 className="section-title">Queue Dashboard</h2>
                  <p className="section-subtitle">Monitor and manage background jobs: ingestion, cache warming, and email delivery.</p>
                </div>
              </header>
              <div className="table-report__cta">
                <Button
                  variant="primary"
                  size="sm"
                  onClick={async () => {
                    try {
                      if (!currentUser) { toast.error('Not authenticated'); return; }
                      const token = await currentUser.getIdToken();
                      document.cookie = `bull_board_token=${token}; path=/admin/queues; max-age=3600; SameSite=Strict`;
                      window.open('/admin/queues', '_blank');
                    } catch {
                      toast.error('Failed to open queue dashboard');
                    }
                  }}
                >
                  <MdBarChart size={15} aria-hidden />
                  Open Queue Dashboard
                </Button>
              </div>
            </div>

            {/* Danger Zone */}
            <div className="table-report danger-zone">
              <header className="table-header table-header--surface">
                <div className="table-header-title">
                  <h2 className="section-title">Danger Zone</h2>
                  <p className="section-subtitle">Irreversible actions with service-wide impact.</p>
                </div>
              </header>
              <div className="danger-zone__body">
                <div className="danger-zone__item">
                  <div className="danger-zone__info">
                    <strong>Refresh All Cache</strong>
                    <span>Re-warms all analytics cache entries in Redis from the existing PostgreSQL data. Does NOT fetch new data from YouTube API -- use "Refresh Ingestion" below first if you want fresh YouTube data.</span>
                  </div>
                  <Button
                    variant="danger"
                    size="sm"
                    disabled={refreshingCache}
                    onClick={() => setShowRefreshConfirm(true)}
                  >
                    <MdRefresh size={15} aria-hidden className={refreshingCache ? 'rt-spin' : ''} />
                    {refreshingCache ? 'Refreshing…' : 'Refresh All Cache'}
                  </Button>
                </div>
                <div className="danger-zone__item">
                  <div className="danger-zone__info">
                    <strong>Refresh YouTube Ingestion</strong>
                    <span>Fetches the latest video metrics directly from the YouTube API for all channels and stores them in PostgreSQL. Use this when you want to pull fresh data immediately instead of waiting for the next cron cycle.</span>
                  </div>
                  <Button
                    variant="danger"
                    size="sm"
                    disabled={ingesting}
                    onClick={() => setShowIngestConfirm(true)}
                  >
                    <MdRefresh size={15} aria-hidden className={ingesting ? 'rt-spin' : ''} />
                    {ingesting ? 'Ingesting…' : 'Refresh Ingestion'}
                  </Button>
                </div>
                <div className="danger-zone__item">
                  <div className="danger-zone__info">
                    <strong>Clean Stale Snapshots</strong>
                    <span>Deletes expired and old (14+ day) dashboard snapshot rows from the PostgreSQL snapshot table so stale cached payloads don't accumulate. Remove stale Postgres-served dashboard data.</span>
                    {snapshotResult && (
                      <span className="danger-zone__result">{snapshotResult}</span>
                    )}
                  </div>
                  <Button
                    variant="danger"
                    size="sm"
                    disabled={cleaningSnapshots}
                    onClick={() => setShowSnapshotConfirm(true)}
                  >
                    <MdRefresh size={15} aria-hidden className={cleaningSnapshots ? 'rt-spin' : ''} />
                    {cleaningSnapshots ? 'Cleaning…' : 'Clean Stale Snapshots'}
                  </Button>
                </div>
              </div>
            </div>
          </>
        )}

        {/* ════════════════ AI CHAT TAB ══════════════════════════════ */}
        {activeTab === 'chat' && (
          <Box sx={{ display: 'flex', flex: 1, flexDirection: 'column', overflow: 'hidden' }}>
            <ChatPage baseEndpoint="/api/chat/admin" mode="admin" />
          </Box>
        )}

        {/* ════════════════ THUMBNAIL OPTIMIZER TAB ════════════════ */}
        {activeTab === 'thumbnail-optimizer' && (
          <AdminThumbnailOptimizer />
        )}

        {/* ════════════════ PLAYLIST OPTIMIZER TAB ════════════════ */}
        {activeTab === 'playlist-optimizer' && (
          <AdminPlaylistOptimizer />
        )}

        {/* ════════════════ AUDIT CRITERIA TAB (single source of truth for all audit scoring) ════════════════ */}
        {activeTab === 'audit-criteria' && (
          <AuditCriteriaEditor />
        )}

        {/* ════════════════ PUBLIC AUDIT TAB (admin-only, public channels, no OAuth) ════════════════ */}
        {activeTab === 'public-audit' && (
          <PublicAuditPanel />
        )}

      </div>

      {/* Modals -- rendered regardless of active tab */}
      <ConfirmModal
        isOpen={showRefreshConfirm}
        title="Refresh All Cache"
        message="This will bust ALL cached analytics data and re-fetch from the YouTube API. Continue?"
        confirmLabel="Refresh"
        onConfirm={async () => {
          setShowRefreshConfirm(false);
          setRefreshingCache(true);
          try {
            const res = await fetch(`${baseUrl}/admin/cache/refresh-all`, {
              method: 'POST',
              headers: { ...(await getFirebaseAuthHeader()) },
            });
            if (!res.ok) {
              const err = await res.json().catch(() => ({}));
              throw new Error(err.error?.message || `Cache refresh failed (${res.status})`);
            }
            const result = await res.json();
            toast.success(`Cache warm enqueued: ${result.result?.enqueued || 0} channels`);
          } catch (err: unknown) {
            const message = err instanceof Error ? err.message : 'Cache refresh failed';
            toast.error(message);
          } finally {
            setRefreshingCache(false);
          }
        }}
        onCancel={() => setShowRefreshConfirm(false)}
      />

      <ConfirmModal
        isOpen={showIngestConfirm}
        title="Refresh YouTube Ingestion"
        message="This will fetch fresh video metrics from the YouTube API for all channels and store them in PostgreSQL. This consumes YouTube API quota. Continue?"
        confirmLabel="Ingest"
        onConfirm={async () => {
          setShowIngestConfirm(false);
          setIngesting(true);
          try {
            const res = await fetch(`${baseUrl}/admin/ingestion/refresh-all`, {
              method: 'POST',
              headers: { 'Content-Type': 'application/json', ...(await getFirebaseAuthHeader()) },
              body: JSON.stringify({ maxChannels: 100, days: 120 }),
            });
            if (!res.ok) {
              const err = await res.json().catch(() => ({}));
              throw new Error(err.error?.message || `Ingestion failed (${res.status})`);
            }
            const result = await res.json();
            toast.success(`Ingestion enqueued: ${result.result?.enqueued || 0} channels`);
          } catch (err: unknown) {
            const message = err instanceof Error ? err.message : 'Ingestion refresh failed';
            toast.error(message);
          } finally {
            setIngesting(false);
          }
        }}
        onCancel={() => setShowIngestConfirm(false)}
      />

      <ConfirmModal
        isOpen={showSnapshotConfirm}
        title="Clean Stale Snapshots"
        message="This will permanently delete expired and old dashboard snapshot rows from the PostgreSQL snapshot table. Stale cached payloads will be removed and re-fetched on next use. Continue?"
        confirmLabel={cleaningSnapshots ? 'Cleaning…' : 'Clean'}
        onConfirm={async () => {
          setShowSnapshotConfirm(false);
          setCleaningSnapshots(true);
          setSnapshotResult(null);
          try {
            const res = await fetch(`${baseUrl}/admin/cleanup/snapshots`, {
              method: 'POST',
              headers: { 'Content-Type': 'application/json', ...(await getFirebaseAuthHeader()) },
              body: JSON.stringify({ mode: 'stale' }),
            });
            if (!res.ok) {
              const err = await res.json().catch(() => ({}));
              throw new Error(err.error?.message || `Snapshot cleanup failed (${res.status})`);
            }
            const result = await res.json();
            const msg = `Cleaned ${result.deleted} snapshot(s) (${result.expired ?? 0} expired of ${result.totalBefore ?? 0})`;
            setSnapshotResult(msg);
            toast.success(msg);
          } catch (err: unknown) {
            const message = err instanceof Error ? err.message : 'Snapshot cleanup failed';
            toast.error(message);
          } finally {
            setCleaningSnapshots(false);
          }
        }}
        onCancel={() => setShowSnapshotConfirm(false)}
      />

    </div>
  );
};
