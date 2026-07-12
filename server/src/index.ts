import http from 'http';
import express from 'express';
import cors from 'cors';
import { Server } from 'socket.io';

import { env } from './config/env';
import { connectDB, disconnectDB } from './lib/db';
import { socketAuth } from './middleware/auth';
import { errorHandler, notFound } from './middleware/errorHandler';
import { createAuthRouter } from './routes/auth.routes';
import { createConversationsRouter } from './routes/conversations.routes';
import { createUploadsRouter } from './routes/uploads.routes';
import { createUsersRouter } from './routes/users.routes';
import { registerSocketHandlers } from './sockets';

async function bootstrap(): Promise<void> {
  await connectDB();

  const app = express();

  app.use(cors({ origin: env.allowedOrigins, credentials: true }));
  app.use(express.json({ limit: '32kb' }));

  app.get('/health', (_req, res) => {
    res.json({ success: true, status: 'ok', uptime: process.uptime() });
  });

  // We create the HTTP server ourselves precisely so Socket.io can attach to it.
  // Express handles ordinary HTTP; Socket.io handles the `upgrade` event. Same
  // port, same server, two protocols.
  const server = http.createServer(app);

  const io = new Server(server, {
    cors: { origin: env.allowedOrigins, credentials: true },
  });

  // Runs once per handshake, before any event handler — so every handler
  // downstream can assume socket.data.user is present and valid.
  io.use(socketAuth);
  registerSocketHandlers(io);

  app.use('/api/auth', createAuthRouter());
  app.use('/api/uploads', createUploadsRouter());
  app.use('/api/users', createUsersRouter(io));
  app.use('/api/conversations', createConversationsRouter(io));
  app.use(notFound);
  app.use(errorHandler);

  server.listen(env.PORT, () => {
    console.log(`[server] listening on :${env.PORT} (${env.NODE_ENV})`);
    console.log(`[server] allowed origins: ${env.allowedOrigins.join(', ')}`);
  });

  const shutdown = async (signal: string) => {
    console.log(`[server] ${signal} received, shutting down`);
    io.close();
    server.close();
    await disconnectDB();
    process.exit(0);
  };

  process.on('SIGINT', () => void shutdown('SIGINT'));
  process.on('SIGTERM', () => void shutdown('SIGTERM'));
}

// A rejected promise anywhere must not silently leave a half-dead server running.
process.on('unhandledRejection', (reason) => {
  console.error('[server] unhandled rejection:', reason);
  process.exit(1);
});

bootstrap().catch((err) => {
  console.error('[server] failed to start:', err);
  process.exit(1);
});
