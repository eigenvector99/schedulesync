/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useState } from 'react';
import { AppProvider, useApp } from './context/AppContext';
import { Header } from './components/Header';
import { TimelineCalendar } from './components/TimelineCalendar';
import { ParticipationMatrix } from './components/ParticipationMatrix';
import { ProjectsView } from './components/ProjectsView';
import { InboxView } from './components/InboxView';
import { AdminConsole } from './components/AdminConsole';
import { EmailDrawer } from './components/EmailDrawer';
import { ProjectDetailModal } from './components/ProjectDetailModal';
import { LoginPage } from './components/LoginPage';
import { Project } from './types';
import { Loader2 } from 'lucide-react';

const AppContent: React.FC = () => {
  const { isAuthenticated, isLoadingAuth, activeTab } = useApp();
  const [isEmailDrawerOpen, setIsEmailDrawerOpen] = useState(false);
  const [selectedProjectForDetail, setSelectedProjectForDetail] = useState<Project | null>(null);

  // 1. Loading Auth State
  if (isLoadingAuth) {
    return (
      <div className="min-h-screen bg-slate-900 flex flex-col items-center justify-center text-white">
        <Loader2 className="w-8 h-8 animate-spin text-blue-500 mb-3" />
        <p className="text-xs text-slate-400">인증 세션 확인 중...</p>
      </div>
    );
  }

  // 2. Unauthenticated Gate -> Render Real Login Page
  if (!isAuthenticated) {
    return <LoginPage />;
  }

  // 3. Authenticated Application
  return (
    <div className="min-h-screen bg-slate-50 flex flex-col font-sans">
      {/* Top 3-Zone Header with User Menu & Navigation */}
      <Header onOpenEmailDrawer={() => setIsEmailDrawerOpen(true)} />

      {/* Main Content Viewport */}
      <main className="flex-1 max-w-7xl w-full mx-auto px-4 sm:px-6 lg:px-8 py-6">
        {activeTab === 'calendar' && (
          <TimelineCalendar
            onSelectProject={(proj) => setSelectedProjectForDetail(proj)}
          />
        )}

        {activeTab === 'matrix' && (
          <ParticipationMatrix
            onSelectProject={(proj) => setSelectedProjectForDetail(proj)}
          />
        )}

        {activeTab === 'projects' && (
          <ProjectsView
            onSelectProject={(proj) => setSelectedProjectForDetail(proj)}
          />
        )}

        {activeTab === 'inbox' && (
          <InboxView
            onSelectProject={(proj) => setSelectedProjectForDetail(proj)}
          />
        )}

        {activeTab === 'admin' && <AdminConsole />}
      </main>

      {/* Global Project Detail Modal */}
      <ProjectDetailModal
        project={selectedProjectForDetail}
        onClose={() => setSelectedProjectForDetail(null)}
      />

      {/* Real SMTP Email Center Drawer */}
      <EmailDrawer
        isOpen={isEmailDrawerOpen}
        onClose={() => setIsEmailDrawerOpen(false)}
      />

      {/* Footer */}
      <footer className="bg-white border-t border-slate-200 py-4 px-6 text-center text-xs text-slate-500">
        <div className="max-w-7xl mx-auto flex flex-col sm:flex-row items-center justify-between gap-2">
          <span>ScheduleSync Pro · 직원 스케줄 관리 및 프로젝트 참여 승인 시스템</span>
          <span className="text-slate-400">
            설계 문서 v1.0 (확정본) 기반 다자간 승인 &amp; 겹침 차단 엔진
          </span>
        </div>
      </footer>
    </div>
  );
};

export default function App() {
  return (
    <AppProvider>
      <AppContent />
    </AppProvider>
  );
}
