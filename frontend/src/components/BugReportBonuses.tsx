import React, { useState } from 'react';
import { useForm } from 'react-hook-form';

interface BugReportForm {
  userId: string;
  title: string;
  description: string;
  severity: 'critical' | 'high' | 'medium' | 'low' | 'informational';
  affectedComponent: string;
  priority: 'urgent' | 'high' | 'medium' | 'low';
  screenshots?: string;
}

interface BugReportResponse {
  id: string;
  userId: string;
  title: string;
  description: string;
  severity: string;
  status: string;
  bonusAmount?: number;
  submittedAt: string;
  reviewedAt?: string;
}

const BugReportBonuses: React.FC = () => {
  const { register, handleSubmit, reset, formState: { errors, isSubmitting } } = useForm<BugReportForm>();
  const [submittedReport, setSubmittedReport] = useState<BugReportResponse | null>(null);
  const [userBonus, setUserBonus] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);

  const API_BASE_URL = process.env.REACT_APP_API_URL || 'http://localhost:3000';

  const severityDescriptions = {
    critical: 'System compromise or data breach possible',
    high: 'Significant security impact',
    medium: 'Moderate security impact',
    low: 'Minor security issue',
    informational: 'Security best practice suggestion',
  };

  const bonusAmounts = {
    critical: 1000,
    high: 500,
    medium: 200,
    low: 100,
    informational: 50,
  };

  const onSubmit = async (data: BugReportForm) => {
    try {
      setError(null);
      setSuccess(null);

      const response = await fetch(`${API_BASE_URL}/growth/bug-report`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          ...data,
          screenshots: data.screenshots ? data.screenshots.split(',').map(s => s.trim()) : [],
        }),
      });

      if (!response.ok) {
        throw new Error('Failed to submit bug report');
      }

      const result = await response.json();
      setSubmittedReport(result);
      setSuccess(`Bug report submitted successfully! Report ID: ${result.id}`);
      reset();
    } catch (err: any) {
      setError(err.message || 'Failed to submit bug report');
    }
  };

  const fetchUserBonus = async (userId: string) => {
    try {
      const response = await fetch(`${API_BASE_URL}/growth/bug-report/bonus/${userId}`);
      if (!response.ok) {
        throw new Error('Failed to fetch bonus balance');
      }
      const result = await response.json();
      setUserBonus(result.bonusBalance);
    } catch (err: any) {
      setError(err.message || 'Failed to fetch bonus balance');
    }
  };

  return (
    <div className="max-w-4xl mx-auto p-6">
      <div className="bg-white rounded-lg shadow-lg p-6 mb-6">
        <h1 className="text-3xl font-bold text-gray-900 mb-2">Bug Report & Bonuses</h1>
        <p className="text-gray-600 mb-6">
          Report bugs and earn token bonuses. Verified bugs are rewarded based on severity.
        </p>

        {error && (
          <div className="bg-red-100 border border-red-400 text-red-700 px-4 py-3 rounded mb-4">
            {error}
          </div>
        )}

        {success && (
          <div className="bg-green-100 border border-green-400 text-green-700 px-4 py-3 rounded mb-4">
            {success}
          </div>
        )}

        {/* Bonus Information */}
        <div className="bg-blue-50 border border-blue-200 rounded-lg p-4 mb-6">
          <h2 className="text-xl font-semibold text-blue-900 mb-3">Bonus Rewards</h2>
          <div className="grid grid-cols-2 md:grid-cols-5 gap-3">
            {Object.entries(bonusAmounts).map(([severity, amount]) => (
              <div key={severity} className="bg-white rounded p-3 text-center">
                <div className="text-sm font-medium text-gray-700 capitalize">{severity}</div>
                <div className="text-lg font-bold text-blue-600">{amount} tokens</div>
              </div>
            ))}
          </div>
        </div>

        {/* Bug Report Form */}
        <form onSubmit={handleSubmit(onSubmit)} className="space-y-4">
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">
              User ID *
            </label>
            <input
              type="text"
              {...register('userId', { required: 'User ID is required' })}
              className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500"
              placeholder="Enter your user ID"
            />
            {errors.userId && <p className="text-red-500 text-sm mt-1">{errors.userId.message}</p>}
          </div>

          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">
              Bug Title *
            </label>
            <input
              type="text"
              {...register('title', { required: 'Title is required' })}
              className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500"
              placeholder="Brief description of the bug"
            />
            {errors.title && <p className="text-red-500 text-sm mt-1">{errors.title.message}</p>}
          </div>

          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">
              Description *
            </label>
            <textarea
              {...register('description', { required: 'Description is required' })}
              rows={4}
              className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500"
              placeholder="Detailed description of the bug, steps to reproduce, expected vs actual behavior"
            />
            {errors.description && <p className="text-red-500 text-sm mt-1">{errors.description.message}</p>}
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">
                Severity Level *
              </label>
              <select
                {...register('severity', { required: 'Severity is required' })}
                className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500"
              >
                <option value="">Select severity</option>
                <option value="critical">Critical - {severityDescriptions.critical}</option>
                <option value="high">High - {severityDescriptions.high}</option>
                <option value="medium">Medium - {severityDescriptions.medium}</option>
                <option value="low">Low - {severityDescriptions.low}</option>
                <option value="informational">Informational - {severityDescriptions.informational}</option>
              </select>
              {errors.severity && <p className="text-red-500 text-sm mt-1">{errors.severity.message}</p>}
            </div>

            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">
                Priority *
              </label>
              <select
                {...register('priority', { required: 'Priority is required' })}
                className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500"
              >
                <option value="">Select priority</option>
                <option value="urgent">Urgent</option>
                <option value="high">High</option>
                <option value="medium">Medium</option>
                <option value="low">Low</option>
              </select>
              {errors.priority && <p className="text-red-500 text-sm mt-1">{errors.priority.message}</p>}
            </div>
          </div>

          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">
              Affected Component
            </label>
            <input
              type="text"
              {...register('affectedComponent')}
              className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500"
              placeholder="e.g., auth, payment, dashboard"
            />
          </div>

          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">
              Screenshots (comma-separated URLs)
            </label>
            <input
              type="text"
              {...register('screenshots')}
              className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500"
              placeholder="https://example.com/screenshot1.png, https://example.com/screenshot2.png"
            />
          </div>

          <button
            type="submit"
            disabled={isSubmitting}
            className="w-full bg-blue-600 text-white py-3 px-4 rounded-md hover:bg-blue-700 disabled:bg-gray-400 disabled:cursor-not-allowed font-medium"
          >
            {isSubmitting ? 'Submitting...' : 'Submit Bug Report'}
          </button>
        </form>
      </div>

      {/* Submitted Report Display */}
      {submittedReport && (
        <div className="bg-white rounded-lg shadow-lg p-6 mb-6">
          <h2 className="text-2xl font-bold text-gray-900 mb-4">Submitted Report</h2>
          <div className="space-y-2">
            <div className="flex justify-between">
              <span className="text-gray-600">Report ID:</span>
              <span className="font-medium">{submittedReport.id}</span>
            </div>
            <div className="flex justify-between">
              <span className="text-gray-600">Status:</span>
              <span className={`font-medium px-2 py-1 rounded ${
                submittedReport.status === 'paid' ? 'bg-green-100 text-green-800' :
                submittedReport.status === 'verified' ? 'bg-blue-100 text-blue-800' :
                submittedReport.status === 'rejected' ? 'bg-red-100 text-red-800' :
                'bg-yellow-100 text-yellow-800'
              }`}>
                {submittedReport.status}
              </span>
            </div>
            {submittedReport.bonusAmount && (
              <div className="flex justify-between">
                <span className="text-gray-600">Bonus Awarded:</span>
                <span className="font-bold text-green-600">{submittedReport.bonusAmount} tokens</span>
              </div>
            )}
            <div className="flex justify-between">
              <span className="text-gray-600">Submitted:</span>
              <span className="font-medium">{new Date(submittedReport.submittedAt).toLocaleString()}</span>
            </div>
          </div>
        </div>
      )}

      {/* Check Bonus Balance */}
      <div className="bg-white rounded-lg shadow-lg p-6">
        <h2 className="text-2xl font-bold text-gray-900 mb-4">Check Your Bonus Balance</h2>
        <div className="flex gap-4">
          <input
            type="text"
            id="bonusUserId"
            className="flex-1 px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500"
            placeholder="Enter your user ID"
          />
          <button
            onClick={() => {
              const userId = (document.getElementById('bonusUserId') as HTMLInputElement)?.value;
              if (userId) fetchUserBonus(userId);
            }}
            className="bg-green-600 text-white py-2 px-6 rounded-md hover:bg-green-700 font-medium"
          >
            Check Balance
          </button>
        </div>
        {userBonus !== null && (
          <div className="mt-4 p-4 bg-green-50 border border-green-200 rounded-lg">
            <div className="text-sm text-green-700">Your Total Bonus Balance</div>
            <div className="text-3xl font-bold text-green-600">{userBonus} tokens</div>
          </div>
        )}
      </div>
    </div>
  );
};

export default BugReportBonuses;
