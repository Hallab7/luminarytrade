import React, { useState, useEffect } from "react";
import {
  Box,
  Button,
  TextField,
  Typography,
  Paper,
  Stack,
  Alert,
  CircularProgress,
} from "@mui/material";
import { useNotification } from "./contexts/NotificationContext";
import { useSearchParams, useNavigate } from "react-router-dom";
import { apiClient } from "../services/api/ApiClient";

type WaitlistStatusType = 'form' | 'verification_pending' | 'verifying' | 'verified' | 'error';

const Waitlist: React.FC = () => {
  const [email, setEmail] = useState("");
  const [name, setName] = useState("");
  const [loading, setLoading] = useState(false);
  const [status, setStatus] = useState<WaitlistStatusType>('form');
  const [error, setError] = useState<string | null>(null);
  const [searchParams] = useSearchParams();
  const navigate = useNavigate();
  const { addNotification } = useNotification();

  useEffect(() => {
    const token = searchParams.get('token');
    if (token) {
      handleVerify(token);
    }
  }, [searchParams]);

  const handleVerify = async (token: string) => {
    setStatus('verifying');
    setError(null);

    try {
      const response = await apiClient.post<{ success: boolean; message: string }>(
        '/waitlist/verify',
        { token }
      );

      if (response.data.success) {
        setStatus('verified');
        addNotification({
          type: "success",
          title: "Email Verified",
          message: "Your email has been verified successfully! You are now on the waitlist.",
          duration: 5000,
        });
      }
    } catch (err: any) {
      setStatus('error');
      const errorMessage = err.message || "Failed to verify email";
      setError(errorMessage);
      addNotification({
        type: "error",
        title: "Verification Failed",
        message: errorMessage,
        duration: 8000,
      });
    }
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    setError(null);

    try {
      const response = await apiClient.post<{ id: string; email: string; emailVerified: boolean }>(
        '/waitlist/join',
        { email, name }
      );

      if (response.data.emailVerified) {
        setStatus('verified');
        addNotification({
          type: "success",
          title: "Joined Waitlist",
          message: "You have successfully joined the waitlist!",
          duration: 5000,
        });
      } else {
        setStatus('verification_pending');
        addNotification({
          type: "success",
          title: "Confirmation Email Sent",
          message: "Please check your email to confirm your spot on the waitlist.",
          duration: 5000,
        });
      }
    } catch (err: any) {
      setError(err.message || "Failed to join waitlist");
      addNotification({
        type: "error",
        title: "Error",
        message: err.message || "Failed to join waitlist",
        duration: 8000,
      });
    } finally {
      setLoading(false);
    }
  };

  const handleCheckStatus = async () => {
    if (!email) return;

    setLoading(true);
    try {
      const response = await apiClient.get<{
        found: boolean;
        email?: string;
        emailVerified?: boolean;
        status?: string;
        createdAt?: string;
      }>(`/waitlist/status/${encodeURIComponent(email)}`);

      if (response.data.found) {
        addNotification({
          type: "info",
          title: "Waitlist Status",
          message: `Status: ${response.data.status}, Email Verified: ${response.data.emailVerified ? 'Yes' : 'No'}`,
          duration: 5000,
        });
      } else {
        setError("Email not found on waitlist");
      }
    } catch (err: any) {
      setError(err.message || "Failed to check status");
    } finally {
      setLoading(false);
    }
  };

  if (status === 'verifying') {
    return (
      <Box sx={{ maxWidth: 500, mx: "auto", mt: 8 }}>
        <Paper elevation={3} sx={{ p: 4, borderRadius: 2, textAlign: "center" }}>
          <CircularProgress size={48} sx={{ mb: 2 }} />
          <Typography variant="h5" gutterBottom>
            Verifying your email...
          </Typography>
        </Paper>
      </Box>
    );
  }

  if (status === 'verified') {
    return (
      <Box sx={{ maxWidth: 500, mx: "auto", mt: 8 }}>
        <Paper elevation={3} sx={{ p: 4, borderRadius: 2 }}>
          <Alert severity="success" sx={{ mb: 3 }}>
            Your email has been verified! You are now on the waitlist.
          </Alert>
          <Typography variant="body1" color="text.secondary" align="center">
            We will notify you when it's your turn to access LuminaryTrade.
          </Typography>
          <Button
            fullWidth
            variant="contained"
            sx={{ mt: 3 }}
            onClick={() => {
              setStatus('form');
              setEmail('');
              setName('');
            }}
          >
            Back to Waitlist
          </Button>
        </Paper>
      </Box>
    );
  }

  if (status === 'verification_pending') {
    return (
      <Box sx={{ maxWidth: 500, mx: "auto", mt: 8 }}>
        <Paper elevation={3} sx={{ p: 4, borderRadius: 2 }}>
          <Alert severity="info" sx={{ mb: 3 }}>
            Confirmation email sent! Please check your inbox.
          </Alert>
          <Typography variant="h5" gutterBottom align="center" sx={{ fontWeight: "bold" }}>
            Check Your Email
          </Typography>
          <Typography variant="body1" color="text.secondary" align="center" sx={{ mb: 4 }}>
            We've sent a verification link to <strong>{email}</strong>.
            Please click the link to confirm your spot on the waitlist.
          </Typography>
          <Button
            fullWidth
            variant="outlined"
            sx={{ mb: 2 }}
            onClick={() => handleCheckStatus()}
            disabled={loading}
          >
            {loading ? <CircularProgress size={24} /> : "Check Status"}
          </Button>
          <Button
            fullWidth
            variant="text"
            onClick={() => {
              setStatus('form');
              setEmail('');
              setName('');
            }}
          >
            Back to Form
          </Button>
        </Paper>
      </Box>
    );
  }

  return (
    <Box sx={{ maxWidth: 500, mx: "auto", mt: 8 }}>
      <Paper elevation={3} sx={{ p: 4, borderRadius: 2 }}>
        <Typography variant="h4" gutterBottom align="center" sx={{ fontWeight: "bold" }}>
          Join the Waitlist
        </Typography>
        <Typography variant="body1" color="text.secondary" align="center" sx={{ mb: 4 }}>
          Be the first to know when we launch new AI-powered trading features.
        </Typography>

        <form onSubmit={handleSubmit}>
          <Stack spacing={3}>
            <TextField
              label="Full Name"
              variant="outlined"
              fullWidth
              value={name}
              onChange={(e) => setName(e.target.value)}
              disabled={loading}
            />
            <TextField
              label="Email Address"
              variant="outlined"
              type="email"
              required
              fullWidth
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              disabled={loading}
            />

            {error && (
              <Alert severity="error">{error}</Alert>
            )}

            <Button
              type="submit"
              variant="contained"
              size="large"
              fullWidth
              disabled={loading || !email}
              sx={{ py: 1.5, fontSize: "1.1rem" }}
            >
              {loading ? <CircularProgress size={24} /> : "Join Waitlist"}
            </Button>

            <Button
              variant="text"
              size="small"
              onClick={handleCheckStatus}
              disabled={loading || !email}
            >
              Already joined? Check your status
            </Button>
          </Stack>
        </form>
      </Paper>
    </Box>
  );
};

export default Waitlist;
