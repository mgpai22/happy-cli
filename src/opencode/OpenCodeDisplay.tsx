import React, { useState, useEffect, useRef, useCallback } from 'react';
import { Box, Text, useStdout, useInput } from 'ink';
import { MessageBuffer, type BufferedMessage } from '@/ui/ink/messageBuffer';

interface OpenCodeDisplayProps {
  messageBuffer: MessageBuffer;
  serverUrl: string;
  onExit?: () => void;
}

export const OpenCodeDisplay: React.FC<OpenCodeDisplayProps> = ({
  messageBuffer,
  serverUrl,
  onExit,
}) => {
  const [messages, setMessages] = useState<BufferedMessage[]>([]);
  const [confirmExit, setConfirmExit] = useState(false);
  const confirmTimeoutRef = useRef<NodeJS.Timeout | null>(null);
  const { stdout } = useStdout();
  const terminalWidth = stdout.columns || 80;

  useEffect(() => {
    setMessages(messageBuffer.getMessages());

    const unsubscribe = messageBuffer.onUpdate((newMessages) => {
      setMessages(newMessages);
    });

    return () => {
      unsubscribe();
      if (confirmTimeoutRef.current) {
        clearTimeout(confirmTimeoutRef.current);
      }
    };
  }, [messageBuffer]);

  const handleExit = useCallback(async () => {
    if (confirmExit) {
      if (confirmTimeoutRef.current) {
        clearTimeout(confirmTimeoutRef.current);
      }
      onExit?.();
    } else {
      setConfirmExit(true);
      confirmTimeoutRef.current = setTimeout(() => {
        setConfirmExit(false);
      }, 5000);
    }
  }, [confirmExit, onExit]);

  useInput(
    useCallback(
      async (input, key) => {
        if (key.ctrl && input === 'c') {
          await handleExit();
        }
      },
      [handleExit]
    )
  );

  const getMessageColor = (type: BufferedMessage['type']): string => {
    switch (type) {
      case 'user':
        return 'magenta';
      case 'assistant':
        return 'cyan';
      case 'system':
        return 'blue';
      case 'tool':
        return 'yellow';
      case 'result':
        return 'green';
      case 'status':
        return 'gray';
      default:
        return 'white';
    }
  };

  const visibleMessages = messages.slice(-20);

  return (
    <Box flexDirection="column" width={terminalWidth}>
      <Box borderStyle="single" borderColor="cyan" paddingX={1}>
        <Text color="cyan" bold>
          OpenCode
        </Text>
        <Text> | </Text>
        <Text dimColor>{serverUrl}</Text>
      </Box>

      <Box flexDirection="column" paddingX={1} minHeight={10}>
        {visibleMessages.map((msg, i) => (
          <Text key={i} color={getMessageColor(msg.type)}>
            {msg.content}
          </Text>
        ))}
      </Box>

      <Box borderStyle="single" borderColor="gray" paddingX={1}>
        {confirmExit ? (
          <Text color="yellow">Press Ctrl+C again to exit</Text>
        ) : (
          <Text dimColor>Ctrl+C to exit | Connected to OpenCode server</Text>
        )}
      </Box>
    </Box>
  );
};
