"use client";

import { useEffect, useRef, useState } from "react";
import { openMcpAuthorizationWindow, safeMcpAuthorizationUrl, showMcpAuthorizationError } from "./mcp-authorization-url";
import {
  McpOAuthStartError,
  useMcpConnections,
  useStartMcpConnectionOAuth,
} from "./mcp-connections-data";

const OAUTH_POLL_INTERVAL_MS = 2000;
const OAUTH_POLL_TIMEOUT_MS = 90_000;
const OAUTH_POLL_TIMEOUT_MESSAGE = "Authorization did not finish. Return to the browser window, complete the sign-in, then select Connect again.";
const OAUTH_POLL_REQUEST_FAILED_MESSAGE = "Couldn't confirm the connection. Check your network, then select Connect again.";

export function useMcpAccountAuthorization(onConnected?: () => void) {
  const { refetch } = useMcpConnections("usable");
  const startOAuth = useStartMcpConnectionOAuth();
  const [pollingConnectionId, setPollingConnectionId] = useState<string | null>(null);
  const [error, setError] = useState<{ connectionId: string; message: string } | null>(null);
  const pollTimer = useRef<ReturnType<typeof setInterval> | null>(null);
  const onConnectedRef = useRef(onConnected);

  useEffect(() => {
    onConnectedRef.current = onConnected;
  }, [onConnected]);

  useEffect(() => {
    return () => {
      if (pollTimer.current) clearInterval(pollTimer.current);
    };
  }, []);

  function stopPolling() {
    if (pollTimer.current) {
      clearInterval(pollTimer.current);
      pollTimer.current = null;
    }
    setPollingConnectionId(null);
  }

  function finishConnected() {
    stopPolling();
    onConnectedRef.current?.();
  }

  function pollUntilConnected(connectionId: string) {
    stopPolling();
    setPollingConnectionId(connectionId);
    const startedAt = Date.now();
    let requestInFlight = false;
    pollTimer.current = setInterval(async () => {
      if (requestInFlight) return;
      requestInFlight = true;
      try {
        const result = await refetch();
        const connection = result.data?.find((entry) => entry.id === connectionId);
        if (connection?.connectedForMe && connection.needsReconnect !== true) {
          finishConnected();
          return;
        }
        if (Date.now() - startedAt > OAUTH_POLL_TIMEOUT_MS) {
          stopPolling();
          setError({ connectionId, message: OAUTH_POLL_TIMEOUT_MESSAGE });
        }
      } catch {
        stopPolling();
        setError({ connectionId, message: OAUTH_POLL_REQUEST_FAILED_MESSAGE });
      } finally {
        requestInFlight = false;
      }
    }, OAUTH_POLL_INTERVAL_MS);
  }

  async function connect(connectionId: string) {
    setError(null);
    let authorizationWindow: Window | null = null;
    try {
      authorizationWindow = openMcpAuthorizationWindow();
      const result = await startOAuth.mutateAsync(connectionId);
      if (result.status === "connected") {
        authorizationWindow.close();
        void refetch();
        finishConnected();
        return;
      }
      if (!result.authorizeUrl) {
        throw new Error("The MCP provider did not return an authorization URL.");
      }
      authorizationWindow.location.href = safeMcpAuthorizationUrl(result.authorizeUrl);
      pollUntilConnected(connectionId);
    } catch (connectError) {
      const message = connectError instanceof Error ? connectError.message : "Failed to connect account.";
      showMcpAuthorizationError(authorizationWindow, {
        message,
        ...(connectError instanceof McpOAuthStartError
          ? { details: connectError.details }
          : {}),
      });
      setError({
        connectionId,
        message,
      });
    }
  }

  return {
    connect,
    connectingConnectionId: startOAuth.isPending ? startOAuth.variables ?? null : null,
    error,
    pollingConnectionId,
  };
}
