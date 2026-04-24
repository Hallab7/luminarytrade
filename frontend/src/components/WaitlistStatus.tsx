import React, { useState, useEffect } from "react";
import {
  Box,
  Paper,
  Typography,
  Chip,
  Button,
  CircularProgress,
  Alert,
} from "@mui/material";
import { waitlistService, WaitlistStatusResponse } from "../services/waitlist.service";
import { useNotification } from "./contexts/NotificationContext";

interface WaitlistStatusProps {
  userEmail?: string;
}

const WaitlistStatus: React.FC<WaitlistStatusProps> = ({ userEmail }) => {
  const [status, setStatus] = useState<WaitlistStatusResponse | null>(null);
  const [loading, setLoading] = useState(false);
  const [email, setEmail] = useState(userEmail || "");
  const [inputEmail, setInputEmail] = useState("");
  const { addNotification } = useNotification();

  useEffect(() => {
    if (userEmail) {
      checkStatus(userEmail);
    }
  }, [userEmail]);

  const checkStatus = async (emailToCheck: string) => {
    if (!emailToCheck) return;

    setLoading(true);
    try {
      const result = await waitlistService.getStatus(emailToCheck);
      setStatus(result);
      setEmail(emailToCheck);
    } catch (err: any) {
      addNotification({
        type: "error",
        title: "Error",
        message: err.message || "Failed to check waitlist status",
        duration: 5000,
      });
    } finally {
      setLoading(false);
    }
  };

  const handleCheckStatus = () => {
    if (inputEmail) {
      checkStatus(inputEmail);
    }
  };

  const getStatusColor = (status?: string) => {
    switch (status) {
      case "pending":
        return "warning";
      case "notified":
        return "info";
      case "accepted":
        return "success";
      case "rejected":
        return "error";
      default:
        return "default";
    }
  };

  if (loading) {
    return (
      <Paper elevation={2} sx={{ p: 3, borderRadius: 2, textAlign: "center" }}>
        <CircularProgress size={32} />
      </Paper>
    );
  }

  if (status && status.found) {
    return (
      <Paper elevation={2} sx={{ p: 3, borderRadius: 2 }}>
        <Typography variant="h6" gutterBottom sx={{ fontWeight: "bold" }}>
          Waitlist Status
        </Typography>
        <Box sx={{ mb: 2 }}>
          <Typography variant="body2" color="text.secondary">
            Email: {status.email}
          </Typography>
          <Box sx={{ mt: 1, display: "flex", gap: 1, alignItems: "center" }}>
            <Typography variant="body2" color="text.secondary">
              Status:
            </Typography>
            <Chip
              label={status.status?.toUpperCase()}
              color={getStatusColor(status.status) as any}
              size="small"
            />
          </Box>
          <Box sx={{ mt: 1, display: "flex", gap: 1, alignItems: "center" }}>
            <Typography variant="body2" color="text.secondary">
              Email Verified:
            </Typography>
            <Chip
              label={status.emailVerified ? "Yes" : "No"}
              color={status.emailVerified ? "success" : "warning"}
              size="small"
            />
          </Box>
          {status.createdAt && (
            <Typography variant="body2" color="text.secondary" sx={{ mt: 1 }}>
              Joined: {new Date(status.createdAt).toLocaleDateString()}
            </Typography>
          )}
        </Box>
        {status.status === "notified" && (
          <Alert severity="info" sx={{ mt: 2 }}>
            You've been notified! Check your email for next steps.
          </Alert>
        )}
        {status.status === "accepted" && (
          <Alert severity="success" sx={{ mt: 2 }}>
            Congratulations! You've been accepted. Check your email for access instructions.
          </Alert>
        )}
      </Paper>
    );
  }

  return (
    <Paper elevation={2} sx={{ p: 3, borderRadius: 2 }}>
      <Typography variant="h6" gutterBottom sx={{ fontWeight: "bold" }}>
        Check Waitlist Status
      </Typography>
      <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>
        Enter your email to check your waitlist status
      </Typography>
      <Box sx={{ display: "flex", gap: 1 }}>
        <input
          type="email"
          placeholder="your@email.com"
          value={inputEmail}
          onChange={(e) => setInputEmail(e.target.value)}
          style={{
            flex: 1,
            padding: "8px 12px",
            borderRadius: 4,
            border: "1px solid #ccc",
            fontSize: 14,
          }}
        />
        <Button
          variant="contained"
          onClick={handleCheckStatus}
          disabled={!inputEmail}
        >
          Check
        </Button>
      </Box>
    </Paper>
  );
};

export default WaitlistStatus;
