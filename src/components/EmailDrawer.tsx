import React, { useState } from 'react';
import { useApp } from '../context/AppContext';
import { Mail, X, Inbox, ArrowRight, Clock, Send } from 'lucide-react';
import { formatClock, formatDateTime } from '../utils/dateAndRrule';

interface EmailDrawerProps {
  isOpen: boolean;
  onClose: () => void;
}

export const EmailDrawer: React.FC<EmailDrawerProps> = ({ isOpen, onClose }) => {
  const { mockEmails } = useApp();
  const [selectedEmailId, setSelectedEmailId] = useState<string | null>(
    mockEmails.length > 0 ? mockEmails[0].id : null
  );

  if (!isOpen) return null;

  const selectedEmail = mockEmails.find((m) => m.id === selectedEmailId) || mockEmails[0];

  return (
    <div className="fixed inset-0 z-50 overflow-hidden bg-slate-900/40 backdrop-blur-xs flex justify-end">
      <div className="w-full max-w-2xl bg-white h-full shadow-2xl flex flex-col border-l border-slate-200 animate-in slide-in-from-right duration-200">
        {/* Drawer Header */}
        <div className="px-6 py-4 border-b border-slate-200 flex items-center justify-between bg-slate-50">
          <div className="flex items-center gap-2">
            <div className="p-2 bg-blue-100 text-blue-700 rounded-lg">
              <Mail className="w-5 h-5" />
            </div>
            <div>
              <h2 className="text-base font-bold text-slate-900">
                시스템 이메일 발송 센터 (SMTP Mock)
              </h2>
              <p className="text-xs text-slate-500">
                설계 문서 v1.0: 인앱 알림과 함께 자동 발송되는 공식 이메일 내역
              </p>
            </div>
          </div>
          <button
            onClick={onClose}
            className="p-1.5 text-slate-400 hover:text-slate-600 rounded-lg hover:bg-slate-200 transition-colors"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Content Split: List & Detail */}
        <div className="flex-1 flex overflow-hidden">
          {/* Email List Column */}
          <div className="w-1/2 border-r border-slate-200 overflow-y-auto divide-y divide-slate-100 bg-slate-50/50">
            {mockEmails.length === 0 ? (
              <div className="p-8 text-center text-xs text-slate-400">
                발송된 이메일이 없습니다.
              </div>
            ) : (
              mockEmails.map((email) => {
                const isSelected = email.id === (selectedEmail?.id);
                return (
                  <div
                    key={email.id}
                    onClick={() => setSelectedEmailId(email.id)}
                    className={`p-3.5 cursor-pointer text-xs transition-colors ${
                      isSelected
                        ? 'bg-blue-50/80 border-l-3 border-blue-600'
                        : 'hover:bg-slate-100'
                    }`}
                  >
                    <div className="flex items-center justify-between gap-1 mb-1">
                      <span className="font-semibold text-slate-800 truncate">
                        수신: {email.toName}
                      </span>
                      <span className="text-[10px] text-slate-400 shrink-0">
                        {formatClock(email.sentAt)}
                      </span>
                    </div>
                    <p className="font-medium text-slate-700 truncate mb-1">
                      {email.subject}
                    </p>
                    <p className="text-slate-500 line-clamp-2 text-[11px] leading-relaxed">
                      {email.body}
                    </p>
                  </div>
                );
              })
            )}
          </div>

          {/* Email Preview Column */}
          <div className="w-1/2 overflow-y-auto p-5 bg-white flex flex-col">
            {selectedEmail ? (
              <div className="space-y-4">
                <div className="border-b border-slate-200 pb-4">
                  <h3 className="text-sm font-bold text-slate-900 leading-snug mb-2">
                    {selectedEmail.subject}
                  </h3>
                  <div className="text-xs text-slate-500 space-y-1">
                    <div className="flex items-center justify-between">
                      <span>보낸사람: <strong>ScheduleSync System</strong> &lt;system@company.internal&gt;</span>
                    </div>
                    <div>
                      <span>받는사람: <strong>{selectedEmail.toName}</strong> &lt;{selectedEmail.to}&gt;</span>
                    </div>
                    <div className="text-[11px] text-slate-400 flex items-center gap-1">
                      <Clock className="w-3 h-3" />
                      <span>{formatDateTime(selectedEmail.sentAt)}</span>
                    </div>
                  </div>
                </div>

                {/* Email Body */}
                <div className="bg-slate-50 p-4 rounded-xl border border-slate-200 text-xs text-slate-700 leading-relaxed font-sans whitespace-pre-wrap">
                  {selectedEmail.body}
                </div>

                <div className="pt-4 border-t border-slate-100 text-[11px] text-slate-400">
                  <p>본 메일은 ScheduleSync 알림 서비스에 의해 자동 생성되어 발송된 모의 메일입니다.</p>
                </div>
              </div>
            ) : (
              <div className="flex-1 flex items-center justify-center text-xs text-slate-400">
                선택된 이메일이 없습니다.
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
};
