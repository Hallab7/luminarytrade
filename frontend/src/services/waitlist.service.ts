import { apiClient } from './api/ApiClient';

export interface WaitlistEntry {
  id: string;
  email: string;
  emailVerified: boolean;
  status: 'pending' | 'notified' | 'accepted' | 'rejected';
  createdAt: string;
  notifiedAt?: string;
}

export interface WaitlistJoinResponse {
  id: string;
  email: string;
  emailVerified: boolean;
}

export interface WaitlistStatusResponse {
  found: boolean;
  email?: string;
  emailVerified?: boolean;
  status?: string;
  createdAt?: string;
  notifiedAt?: string;
}

export const waitlistService = {
  async join(email: string, name?: string): Promise<WaitlistJoinResponse> {
    const response = await apiClient.post<WaitlistJoinResponse>('/waitlist/join', { email, name });
    return response.data;
  },

  async verifyEmail(token: string): Promise<void> {
    await apiClient.post<{ success: boolean; message: string }>('/waitlist/verify', { token });
  },

  async getStatus(email: string): Promise<WaitlistStatusResponse> {
    const response = await apiClient.get<WaitlistStatusResponse>(
      `/waitlist/status/${encodeURIComponent(email)}`
    );
    return response.data;
  },
};
