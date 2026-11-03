import React, { createContext, useContext, useState, useEffect, ReactNode, useCallback } from 'react';
import {
  Department,
  Employee,
  Project,
  ProjectSession,
  Assignment,
  SessionChangeRequest,
  AllowedOverlap,
  Notification,
  MockEmail,
  AuditLog,
  ConflictDetail,
} from '../types';
import { checkEmployeeOverlap } from '../utils/dateAndRrule';

/** Result of issuing an invitation / reset link. `inviteLink` is only present when automatic delivery failed. */
export interface InviteResult {
  success: boolean;
  error?: string;
  delivered?: boolean;
  deliveryError?: string;
  inviteLink?: string;
}

interface AppContextType {
  // Auth state
  isAuthenticated: boolean;
  isLoadingAuth: boolean;
  currentUser: Employee | null;
  currentUserId: string;

  // Domain entities
  departments: Department[];
  employees: Employee[];
  projects: Project[];
  sessions: ProjectSession[];
  assignments: Assignment[];
  changeRequests: SessionChangeRequest[];
  allowedOverlaps: AllowedOverlap[];
  notifications: Notification[];
  mockEmails: MockEmail[];
  auditLogs: AuditLog[];
  activeTab: 'calendar' | 'matrix' | 'projects' | 'inbox' | 'admin';

  // Navigation
  setActiveTab: (tab: 'calendar' | 'matrix' | 'projects' | 'inbox' | 'admin') => void;

  // Auth actions
  login: (email: string, pass: string) => Promise<{ success: boolean; error?: string }>;
  logout: () => Promise<void>;
  changePassword: (curr: string, next: string) => Promise<{ success: boolean; error?: string }>;
  requestPasswordReset: (email: string) => Promise<{ success: boolean; error?: string }>;
  confirmPasswordReset: (token: string, next: string) => Promise<{ success: boolean; error?: string }>;

  // Domain actions
  createProject: (
    project: Omit<Project, 'id' | 'createdBy' | 'createdAt' | 'updatedAt'>,
    sessions: Omit<ProjectSession, 'id' | 'projectId'>[]
  ) => Promise<{ success: boolean; projectId?: string; error?: string }>;

  updateProject: (
    projectId: string,
    data: Partial<Pick<Project, 'name' | 'description' | 'status' | 'headcount' | 'color'>>
  ) => Promise<{ success: boolean; error?: string }>;

  assignEmployee: (
    projectId: string,
    employeeId: string,
    confirmOverlap?: boolean
  ) => Promise<{
    success: boolean;
    needConfirmation?: boolean;
    conflicts?: ConflictDetail[];
    error?: string;
  }>;

  respondAssignment: (
    assignmentId: string,
    accept: boolean,
    declineReason?: string
  ) => Promise<{ success: boolean; error?: string }>;

  decideApproval: (
    assignmentId: string,
    decision: 'APPROVED' | 'REJECTED',
    comment?: string
  ) => Promise<{ success: boolean; error?: string }>;

  withdrawAssignment: (assignmentId: string) => Promise<{ success: boolean; error?: string }>;
  releaseAssignment: (assignmentId: string) => Promise<{ success: boolean; error?: string }>;

  requestSessionChange: (
    projectId: string,
    newSessions: Omit<ProjectSession, 'id' | 'projectId'>[],
    confirmOwnWarnings?: boolean
  ) => Promise<{
    success: boolean;
    appliedDirectly?: boolean;
    needWarningConfirm?: boolean;
    warningConflicts?: ConflictDetail[];
    changeRequestId?: string;
    error?: string;
  }>;

  decideChangeRequest: (
    requestId: string,
    decision: 'APPROVED' | 'REJECTED',
    comment?: string
  ) => Promise<{ success: boolean; error?: string }>;

  // Notifications
  markNotificationRead: (notificationId: string) => void;
  markAllNotificationsRead: () => void;

  // Admin actions
  createEmployeeAccount: (
    data: Omit<Employee, 'id' | 'status' | 'failedLoginCount'>
  ) => Promise<InviteResult>;
  resendInvite: (employeeId: string) => Promise<InviteResult>;
  createDepartment: (name: string) => Promise<{ success: boolean; error?: string }>;
  toggleEmployeeStatus: (employeeId: string) => Promise<{ success: boolean; error?: string }>;
  updateDepartmentHead: (departmentId: string, headEmployeeId: string) => Promise<{ success: boolean; error?: string }>;

  // Refresh
  refreshState: () => Promise<void>;
}

const AppContext = createContext<AppContextType | null>(null);

const TOKEN_KEY = 'schedulesync_pro_jwt_token';

export const AppProvider: React.FC<{ children: ReactNode }> = ({ children }) => {
  const [token, setToken] = useState<string | null>(() => localStorage.getItem(TOKEN_KEY));
  const [currentUser, setCurrentUser] = useState<Employee | null>(null);
  const [isLoadingAuth, setIsLoadingAuth] = useState<boolean>(true);

  // Domain state
  const [departments, setDepartments] = useState<Department[]>([]);
  const [employees, setEmployees] = useState<Employee[]>([]);
  const [projects, setProjects] = useState<Project[]>([]);
  const [sessions, setSessions] = useState<ProjectSession[]>([]);
  const [assignments, setAssignments] = useState<Assignment[]>([]);
  const [changeRequests, setChangeRequests] = useState<SessionChangeRequest[]>([]);
  const [allowedOverlaps, setAllowedOverlaps] = useState<AllowedOverlap[]>([]);
  const [notifications, setNotifications] = useState<Notification[]>([]);
  const [mockEmails, setMockEmails] = useState<MockEmail[]>([]);
  const [auditLogs, setAuditLogs] = useState<AuditLog[]>([]);

  const [activeTab, setActiveTab] = useState<'calendar' | 'matrix' | 'projects' | 'inbox' | 'admin'>('calendar');

  const currentUserId = currentUser ? currentUser.id : '';

  // Auth Headers helper
  const getAuthHeaders = useCallback(() => {
    return {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${token || ''}`,
    };
  }, [token]);

  // Fetch full state from backend
  const refreshState = useCallback(async () => {
    if (!token) return;
    try {
      const res = await fetch('/api/state', {
        headers: { Authorization: `Bearer ${token}` },
      });
      if (res.ok) {
        const data = await res.json();
        setDepartments(data.departments || []);
        setEmployees(data.employees || []);
        setProjects(data.projects || []);
        setSessions(data.sessions || []);
        setAssignments(data.assignments || []);
        setChangeRequests(data.changeRequests || []);
        setAllowedOverlaps(data.allowedOverlaps || []);
        setNotifications(data.notifications || []);
        setMockEmails(data.mockEmails || []);
        setAuditLogs(data.auditLogs || []);
      } else if (res.status === 401 || res.status === 403) {
        // Expired session
        localStorage.removeItem(TOKEN_KEY);
        setToken(null);
        setCurrentUser(null);
      }
    } catch (e) {
      console.error('Failed to load state from backend:', e);
    }
  }, [token]);

  // Initial Auth Check
  useEffect(() => {
    const verifyAuth = async () => {
      const savedToken = localStorage.getItem(TOKEN_KEY);
      if (!savedToken) {
        setIsLoadingAuth(false);
        return;
      }

      try {
        const res = await fetch('/api/auth/me', {
          headers: { Authorization: `Bearer ${savedToken}` },
        });

        if (res.ok) {
          const data = await res.json();
          setCurrentUser(data.user);
          setToken(savedToken);
        } else {
          localStorage.removeItem(TOKEN_KEY);
          setToken(null);
          setCurrentUser(null);
        }
      } catch (e) {
        console.error('Auth verify error:', e);
      } finally {
        setIsLoadingAuth(false);
      }
    };

    verifyAuth();
  }, []);

  // Sync state whenever token changes or is valid
  useEffect(() => {
    if (token && currentUser) {
      refreshState();
      // Auto-poll state every 6 seconds so multi-user updates sync in real time
      const interval = setInterval(refreshState, 6000);
      return () => clearInterval(interval);
    }
  }, [token, currentUser, refreshState]);

  // 1. Auth: Login
  const login = async (email: string, pass: string) => {
    try {
      const res = await fetch('/api/auth/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email, password: pass }),
      });

      const data = await res.json();
      if (res.ok) {
        localStorage.setItem(TOKEN_KEY, data.token);
        setToken(data.token);
        setCurrentUser(data.user);
        await refreshState();
        return { success: true };
      } else {
        return { success: false, error: data.error || '로그인 실패' };
      }
    } catch (e: any) {
      return { success: false, error: e.message || '서버 통신 오류' };
    }
  };

  // 2. Auth: Logout
  const logout = async () => {
    try {
      if (token) {
        await fetch('/api/auth/logout', {
          method: 'POST',
          headers: { Authorization: `Bearer ${token}` },
        });
      }
    } catch (e) {
      // ignore
    } finally {
      localStorage.removeItem(TOKEN_KEY);
      setToken(null);
      setCurrentUser(null);
    }
  };

  // 3. Auth: Change Password
  const changePassword = async (curr: string, next: string) => {
    try {
      const res = await fetch('/api/auth/change-password', {
        method: 'POST',
        headers: getAuthHeaders(),
        body: JSON.stringify({ currentPassword: curr, newPassword: next }),
      });
      const data = await res.json();
      if (res.ok) {
        return { success: true };
      }
      return { success: false, error: data.error };
    } catch (e: any) {
      return { success: false, error: e.message };
    }
  };

  // 4. Auth: Request Reset
  const requestPasswordReset = async (email: string) => {
    try {
      const res = await fetch('/api/auth/password-reset-request', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email }),
      });
      const data = await res.json();
      if (res.ok) {
        return { success: true };
      }
      return { success: false, error: data.error };
    } catch (e: any) {
      return { success: false, error: e.message };
    }
  };

  // 5. Auth: Confirm Reset
  const confirmPasswordReset = async (resetTok: string, next: string) => {
    try {
      const res = await fetch('/api/auth/password-reset-confirm', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ token: resetTok, newPassword: next }),
      });
      const data = await res.json();
      if (res.ok) {
        return { success: true };
      }
      return { success: false, error: data.error };
    } catch (e: any) {
      return { success: false, error: e.message };
    }
  };

  // 6. Create Project
  const createProject = async (
    projectData: Omit<Project, 'id' | 'createdBy' | 'createdAt' | 'updatedAt'>,
    sessionList: Omit<ProjectSession, 'id' | 'projectId'>[]
  ) => {
    try {
      const res = await fetch('/api/projects', {
        method: 'POST',
        headers: getAuthHeaders(),
        body: JSON.stringify({ project: projectData, sessions: sessionList }),
      });
      const data = await res.json();
      if (res.ok) {
        await refreshState();
        return { success: true, projectId: data.project.id };
      }
      return { success: false, error: data.error };
    } catch (e: any) {
      return { success: false, error: e.message };
    }
  };

  // 7. Update Project
  const updateProject = async (
    projectId: string,
    data: Partial<Pick<Project, 'name' | 'description' | 'status' | 'headcount' | 'color'>>
  ) => {
    try {
      const res = await fetch(`/api/projects/${projectId}`, {
        method: 'PATCH',
        headers: getAuthHeaders(),
        body: JSON.stringify(data),
      });
      const result = await res.json();
      if (res.ok) {
        await refreshState();
        return { success: true };
      }
      return { success: false, error: result.error };
    } catch (e: any) {
      return { success: false, error: e.message };
    }
  };

  // 8. Assign Employee
  const assignEmployee = async (
    projectId: string,
    employeeId: string,
    confirmOverlap: boolean = false
  ) => {
    const proj = projects.find((p) => p.id === projectId);
    if (!proj) return { success: false, error: '프로젝트를 찾을 수 없습니다.' };

    const projSessions = sessions.filter((s) => s.projectId === projectId);
    const overlapResult = checkEmployeeOverlap(
      employeeId,
      proj,
      projSessions,
      projects,
      sessions,
      assignments,
      allowedOverlaps,
      employees,
      projectId
    );

    // Self-assign warning check
    if (employeeId === currentUserId && overlapResult.hasConflict && !confirmOverlap) {
      return {
        success: false,
        needConfirmation: true,
        conflicts: overlapResult.conflicts,
        error: '다른 확정 프로젝트와 시간이 겹칩니다. 경고 확인 후 투입을 확정할 수 있습니다.',
      };
    }

    try {
      const res = await fetch('/api/assignments', {
        method: 'POST',
        headers: getAuthHeaders(),
        body: JSON.stringify({
          projectId,
          employeeId,
          confirmOverlap,
          conflicts: overlapResult.conflicts,
        }),
      });

      const data = await res.json();
      if (res.ok) {
        await refreshState();
        return { success: true };
      }
      return { success: false, error: data.error };
    } catch (e: any) {
      return { success: false, error: e.message };
    }
  };

  // 9. Respond to Assignment
  const respondAssignment = async (assignmentId: string, accept: boolean, declineReason?: string) => {
    try {
      const res = await fetch(`/api/assignments/${assignmentId}/response`, {
        method: 'POST',
        headers: getAuthHeaders(),
        body: JSON.stringify({ accept, declineReason }),
      });
      const data = await res.json();
      if (res.ok) {
        await refreshState();
        return { success: true };
      }
      return { success: false, error: data.error };
    } catch (e: any) {
      return { success: false, error: e.message };
    }
  };

  // 10. Approver Decides on General Employee Assignment
  const decideApproval = async (
    assignmentId: string,
    decision: 'APPROVED' | 'REJECTED',
    comment?: string
  ) => {
    const asg = assignments.find((a) => a.id === assignmentId);
    if (!asg) return { success: false, error: '배정 내역을 찾을 수 없습니다.' };

    const proj = projects.find((p) => p.id === asg.projectId);
    if (!proj) return { success: false, error: '프로젝트를 찾을 수 없습니다.' };

    if (decision === 'APPROVED') {
      const projSessions = sessions.filter((s) => s.projectId === proj.id);
      const overlapResult = checkEmployeeOverlap(
        asg.employeeId,
        proj,
        projSessions,
        projects,
        sessions,
        assignments,
        allowedOverlaps,
        employees,
        proj.id
      );

      if (overlapResult.hasConflict) {
        return {
          success: false,
          error: '다른 확정 프로젝트와 시간이 겹치는 동안에는 승인이 차단됩니다.',
        };
      }
    }

    try {
      const res = await fetch(`/api/assignments/${assignmentId}/decision`, {
        method: 'POST',
        headers: getAuthHeaders(),
        body: JSON.stringify({ decision, comment }),
      });
      const data = await res.json();
      if (res.ok) {
        await refreshState();
        return { success: true };
      }
      return { success: false, error: data.error };
    } catch (e: any) {
      return { success: false, error: e.message };
    }
  };

  // 11. Withdraw Assignment
  const withdrawAssignment = async (assignmentId: string) => {
    try {
      const res = await fetch(`/api/assignments/${assignmentId}/withdraw`, {
        method: 'POST',
        headers: getAuthHeaders(),
      });
      const data = await res.json();
      if (res.ok) {
        await refreshState();
        return { success: true };
      }
      return { success: false, error: data.error };
    } catch (e: any) {
      return { success: false, error: e.message };
    }
  };

  // 12. Release Assignment
  const releaseAssignment = async (assignmentId: string) => {
    try {
      const res = await fetch(`/api/assignments/${assignmentId}/release`, {
        method: 'POST',
        headers: getAuthHeaders(),
      });
      const data = await res.json();
      if (res.ok) {
        await refreshState();
        return { success: true };
      }
      return { success: false, error: data.error };
    } catch (e: any) {
      return { success: false, error: e.message };
    }
  };

  // 13. Request Session Change
  const requestSessionChange = async (
    projectId: string,
    newSessionInputs: Omit<ProjectSession, 'id' | 'projectId'>[],
    confirmOwnWarnings: boolean = false
  ) => {
    const proj = projects.find((p) => p.id === projectId);
    if (!proj) return { success: false, error: '프로젝트를 찾을 수 없습니다.' };

    const proposedSessions: ProjectSession[] = newSessionInputs.map((s, idx) => ({
      ...s,
      id: `sess-prop-${Date.now()}-${idx}`,
      projectId,
    }));

    const confirmedParticipants = assignments.filter(
      (a) => a.projectId === projectId && a.status === 'APPROVED'
    );

    const otherApproverConflicts: ConflictDetail[] = [];
    const ownWarnings: ConflictDetail[] = [];
    const approversToAsk = new Set<string>();
    const employeesToConsent = new Set<string>();

    for (const part of confirmedParticipants) {
      const overlapRes = checkEmployeeOverlap(
        part.employeeId,
        proj,
        proposedSessions,
        projects,
        sessions,
        assignments,
        allowedOverlaps,
        employees,
        projectId
      );

      for (const conf of overlapRes.conflicts) {
        const ownerId = conf.conflictingProject.createdBy;
        if (ownerId === currentUserId || part.employeeId === currentUserId) {
          ownWarnings.push(conf);
        } else {
          otherApproverConflicts.push(conf);
          approversToAsk.add(ownerId);
          employeesToConsent.add(part.employeeId);
        }
      }
    }

    // Direct save if no conflicts
    if (otherApproverConflicts.length === 0 && ownWarnings.length === 0) {
      try {
        const res = await fetch(`/api/projects/${projectId}/sessions`, {
          method: 'PUT',
          headers: getAuthHeaders(),
          body: JSON.stringify({ sessions: newSessionInputs, directApply: true }),
        });
        const data = await res.json();
        if (res.ok) {
          await refreshState();
          return { success: true, appliedDirectly: true };
        }
        return { success: false, error: data.error };
      } catch (e: any) {
        return { success: false, error: e.message };
      }
    }

    // Own warnings only
    if (otherApproverConflicts.length === 0 && ownWarnings.length > 0) {
      if (!confirmOwnWarnings) {
        return {
          success: false,
          needWarningConfirm: true,
          warningConflicts: ownWarnings,
          error: '본인이 등록한 다른 프로젝트와 일정이 겹칩니다. 경고 확인 후 즉시 저장할 수 있습니다.',
        };
      }

      try {
        const res = await fetch(`/api/projects/${projectId}/sessions`, {
          method: 'PUT',
          headers: getAuthHeaders(),
          body: JSON.stringify({ sessions: newSessionInputs, directApply: true }),
        });
        const data = await res.json();
        if (res.ok) {
          await refreshState();
          return { success: true, appliedDirectly: true };
        }
        return { success: false, error: data.error };
      } catch (e: any) {
        return { success: false, error: e.message };
      }
    }

    // Requires B approval + employee consent
    const decisions: SessionChangeRequest['decisions'] = [];
    approversToAsk.forEach((approverId) => {
      decisions.push({
        id: `cd-${Date.now()}-${approverId}`,
        changeRequestId: '',
        actorId: approverId,
        kind: 'APPROVAL',
        decision: 'PENDING',
      });
    });

    employeesToConsent.forEach((empId) => {
      const existing = decisions.find((d) => d.actorId === empId);
      if (existing) {
        existing.kind = 'BOTH';
      } else {
        decisions.push({
          id: `cd-${Date.now()}-${empId}`,
          changeRequestId: '',
          actorId: empId,
          kind: 'CONSENT',
          decision: 'PENDING',
        });
      }
    });

    try {
      const res = await fetch(`/api/projects/${projectId}/sessions`, {
        method: 'PUT',
        headers: getAuthHeaders(),
        body: JSON.stringify({
          sessions: newSessionInputs,
          directApply: false,
          changeRequestData: {
            conflicts: [...otherApproverConflicts, ...ownWarnings],
            decisions,
          },
        }),
      });

      const data = await res.json();
      if (res.ok) {
        await refreshState();
        return {
          success: true,
          appliedDirectly: false,
          changeRequestId: data.changeRequest.id,
        };
      }
      return { success: false, error: data.error };
    } catch (e: any) {
      return { success: false, error: e.message };
    }
  };

  // 14. Decide Change Request
  const decideChangeRequest = async (
    requestId: string,
    decision: 'APPROVED' | 'REJECTED',
    comment?: string
  ) => {
    try {
      const res = await fetch(`/api/change-requests/${requestId}/decision`, {
        method: 'POST',
        headers: getAuthHeaders(),
        body: JSON.stringify({ decision, comment }),
      });
      const data = await res.json();
      if (res.ok) {
        await refreshState();
        return { success: true };
      }
      return { success: false, error: data.error };
    } catch (e: any) {
      return { success: false, error: e.message };
    }
  };

  // 15. Notification helpers
  const markNotificationRead = (id: string) => {
    setNotifications((prev) => prev.map((n) => (n.id === id ? { ...n, read: true } : n)));
  };

  const markAllNotificationsRead = () => {
    setNotifications((prev) =>
      prev.map((n) => (n.recipientId === currentUserId ? { ...n, read: true } : n))
    );
  };

  // 16. Admin methods
  const createEmployeeAccount = async (
    data: Omit<Employee, 'id' | 'status' | 'failedLoginCount'>
  ): Promise<InviteResult> => {
    try {
      const res = await fetch('/api/admin/employees', {
        method: 'POST',
        headers: getAuthHeaders(),
        body: JSON.stringify(data),
      });
      const result = await res.json();
      if (res.ok) {
        await refreshState();
        return {
          success: true,
          delivered: result.delivered,
          deliveryError: result.deliveryError,
          inviteLink: result.inviteLink,
        };
      }
      return { success: false, error: result.error };
    } catch (e: any) {
      return { success: false, error: e.message };
    }
  };

  const resendInvite = async (employeeId: string): Promise<InviteResult> => {
    try {
      const res = await fetch(`/api/admin/employees/${employeeId}/invite`, {
        method: 'POST',
        headers: getAuthHeaders(),
      });
      const result = await res.json();
      if (res.ok) {
        await refreshState();
        return {
          success: true,
          delivered: result.delivered,
          deliveryError: result.deliveryError,
          inviteLink: result.inviteLink,
        };
      }
      return { success: false, error: result.error };
    } catch (e: any) {
      return { success: false, error: e.message };
    }
  };

  const createDepartment = async (name: string) => {
    try {
      const res = await fetch('/api/admin/departments', {
        method: 'POST',
        headers: getAuthHeaders(),
        body: JSON.stringify({ name }),
      });
      const result = await res.json();
      if (res.ok) {
        await refreshState();
        return { success: true };
      }
      return { success: false, error: result.error };
    } catch (e: any) {
      return { success: false, error: e.message };
    }
  };

  const toggleEmployeeStatus = async (employeeId: string) => {
    try {
      const res = await fetch(`/api/admin/employees/${employeeId}/status`, {
        method: 'PATCH',
        headers: getAuthHeaders(),
      });
      const result = await res.json();
      if (res.ok) {
        await refreshState();
        return { success: true };
      }
      return { success: false, error: result.error };
    } catch (e: any) {
      return { success: false, error: e.message };
    }
  };

  const updateDepartmentHead = async (departmentId: string, headEmployeeId: string) => {
    try {
      const res = await fetch(`/api/admin/departments/${departmentId}/head`, {
        method: 'PATCH',
        headers: getAuthHeaders(),
        body: JSON.stringify({ headEmployeeId }),
      });
      const result = await res.json();
      if (res.ok) {
        await refreshState();
        return { success: true };
      }
      return { success: false, error: result.error };
    } catch (e: any) {
      return { success: false, error: e.message };
    }
  };

  return (
    <AppContext.Provider
      value={{
        isAuthenticated: !!currentUser,
        isLoadingAuth,
        currentUser,
        currentUserId,
        departments,
        employees,
        projects,
        sessions,
        assignments,
        changeRequests,
        allowedOverlaps,
        notifications,
        mockEmails,
        auditLogs,
        activeTab,
        setActiveTab,
        login,
        logout,
        changePassword,
        requestPasswordReset,
        confirmPasswordReset,
        createProject,
        updateProject,
        assignEmployee,
        respondAssignment,
        decideApproval,
        withdrawAssignment,
        releaseAssignment,
        requestSessionChange,
        decideChangeRequest,
        markNotificationRead,
        markAllNotificationsRead,
        createEmployeeAccount,
        resendInvite,
        createDepartment,
        toggleEmployeeStatus,
        updateDepartmentHead,
        refreshState,
      }}
    >
      {children}
    </AppContext.Provider>
  );
};

export const useApp = () => {
  const context = useContext(AppContext);
  if (!context) {
    throw new Error('useApp must be used within an AppProvider');
  }
  return context;
};
