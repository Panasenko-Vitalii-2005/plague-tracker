import Fastify, { type FastifyInstance, type FastifyReply } from 'fastify';
import type { GameSessionTracker } from './GameSessionTracker.js';
import type { SessionRepository, SnapshotRepository } from './repositories.js';
import type { CollectorStatus, GameSession, GameSnapshot } from './types.js';
import type { LiveEventSource } from './TrackedCollector.js';
import { SseConnection } from './sse.js';

export interface ApiDependencies {
  tracker: GameSessionTracker;
  sessions: SessionRepository;
  snapshots: SnapshotRepository;
  collector: { getStatus(): CollectorStatus; getLatestSnapshot(): GameSnapshot | null };
  liveEvents: LiveEventSource;
  logError?: (message: string) => void;
}

class ApiError extends Error {
  constructor(
    readonly statusCode: number,
    readonly code: string,
    message: string,
  ) {
    super(message);
  }
}

function routeId(value: unknown, name: string): string {
  if (typeof value !== 'string' || value.length === 0 || value.length > 256
    || /[\u0000-\u001f\u007f/\\]/.test(value)) {
    throw new ApiError(400, 'INVALID_PARAMETER', `Invalid ${name}`);
  }
  return value;
}

function sessionMetadata(session: GameSession, snapshotCount: number) {
  return {
    ...session,
    snapshotCount,
    isOpen: session.endedAt === null,
  };
}

export function buildApi(dependencies: ApiDependencies): FastifyInstance {
  const app = Fastify({
    logger: false,
    frameworkErrors: (_error, _request, reply) => (reply as FastifyReply).code(400).send({
      error: { code: 'INVALID_REQUEST', message: 'Invalid request' },
    }),
  });
  const { tracker, sessions, snapshots, collector, liveEvents } = dependencies;
  const logError = dependencies.logError ?? ((message: string) => console.error(message));
  const streams = new Set<SseConnection>();
  let eventId = 0;

  const readLiveState = async () => {
    await tracker.waitForIdle();
    const status = collector.getStatus();
    const running = status.state === 'running';
    const hasLiveSnapshot = running && collector.getLatestSnapshot() !== null;
    return {
      collector: { running, lastError: status.lastError },
      session: hasLiveSnapshot ? tracker.getActiveSession() : null,
      snapshot: hasLiveSnapshot ? tracker.getCurrentDaySnapshot() : null,
    };
  };

  app.addHook('preClose', async () => {
    for (const stream of streams) stream.close();
  });

  app.setErrorHandler((error, request, reply) => {
    if (error instanceof ApiError) {
      return reply.code(error.statusCode).send({
        error: { code: error.code, message: error.message },
      });
    }
    if (typeof error === 'object' && error !== null
      && 'statusCode' in error && error.statusCode === 400) {
      return reply.code(400).send({
        error: { code: 'INVALID_REQUEST', message: 'Invalid request' },
      });
    }
    logError(`[api:error] ${request.method} ${request.url}: ${error instanceof Error ? error.message : String(error)}`);
    return reply.code(500).send({
      error: { code: 'INTERNAL_ERROR', message: 'Internal server error' },
    });
  });

  app.setNotFoundHandler((_request, reply) => reply.code(404).send({
    error: { code: 'NOT_FOUND', message: 'Route not found' },
  }));

  app.get('/api/v1/health', async () => ({ status: 'ok' }));

  app.get('/api/v1/live', readLiveState);

  app.get('/api/v1/live/stream', (_request, reply) => {
    reply.hijack();
    reply.raw.writeHead(200, {
      'Content-Type': 'text/event-stream; charset=utf-8',
      'Cache-Control': 'no-cache',
      Connection: 'keep-alive',
    });
    reply.raw.flushHeaders();
    let stream: SseConnection;
    stream = new SseConnection(reply.raw, liveEvents, () => ++eventId, () => streams.delete(stream));
    streams.add(stream);
    void readLiveState()
      .then((state) => stream.sendInitialState(state))
      .catch((cause: unknown) => {
        logError(`[api:error] SSE initial state: ${cause instanceof Error ? cause.message : String(cause)}`);
        stream.close();
      });
  });

  app.get('/api/v1/sessions', async () => {
    const [allSessions, allStats] = await Promise.all([sessions.list(), snapshots.getSessionStats()]);
    const statsById = new Map(allStats.map((stats) => [stats.sessionId, stats]));
    return allSessions
      .sort((left, right) => right.startedAt.localeCompare(left.startedAt) || right.id.localeCompare(left.id))
      .map((session) => {
        const stats = statsById.get(session.id);
        return {
          ...sessionMetadata(session, stats?.snapshotCount ?? 0),
          firstGameDate: stats?.firstGameDate ?? null,
          lastGameDate: stats?.lastGameDate ?? null,
        };
      });
  });

  app.get('/api/v1/sessions/:sessionId', async (request) => {
    const sessionId = routeId((request.params as Record<string, unknown>).sessionId, 'sessionId');
    const session = await sessions.getById(sessionId);
    if (!session) throw new ApiError(404, 'SESSION_NOT_FOUND', 'Session not found');
    const stats = (await snapshots.getSessionStats(sessionId))[0];
    return {
      session: sessionMetadata(session, stats?.snapshotCount ?? 0),
      range: {
        firstGameDate: stats?.firstGameDate ?? null,
        lastGameDate: stats?.lastGameDate ?? null,
      },
    };
  });

  app.get('/api/v1/sessions/:sessionId/history', async (request) => {
    const sessionId = routeId((request.params as Record<string, unknown>).sessionId, 'sessionId');
    if (!await sessions.getById(sessionId)) {
      throw new ApiError(404, 'SESSION_NOT_FOUND', 'Session not found');
    }
    return { sessionId, history: await snapshots.getGlobalHistory(sessionId) };
  });

  app.get('/api/v1/sessions/:sessionId/countries', async (request) => {
    const sessionId = routeId((request.params as Record<string, unknown>).sessionId, 'sessionId');
    if (!await sessions.getById(sessionId)) {
      throw new ApiError(404, 'SESSION_NOT_FOUND', 'Session not found');
    }
    return { sessionId, countries: await snapshots.getCountriesForSession(sessionId) };
  });

  app.get('/api/v1/sessions/:sessionId/countries/:countryId/history', async (request) => {
    const params = request.params as Record<string, unknown>;
    const sessionId = routeId(params.sessionId, 'sessionId');
    const countryId = routeId(params.countryId, 'countryId');
    if (!await sessions.getById(sessionId)) {
      throw new ApiError(404, 'SESSION_NOT_FOUND', 'Session not found');
    }
    const history = await snapshots.getCountryHistory(sessionId, countryId);
    if (history.length === 0) {
      throw new ApiError(404, 'COUNTRY_NOT_FOUND', 'Country not found in session');
    }
    return { sessionId, countryId, history };
  });

  return app;
}
