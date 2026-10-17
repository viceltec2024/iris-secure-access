/**
 * In-process durable-shape job queue for IRIS missions/agents.
 * Jobs are persisted by the caller (D1 appSettings). This module is pure logic:
 * enqueue, lease, complete, fail with retry, cancel, expire by timeout.
 *
 * Isolation note: Cloudflare Workers already isolate requests. This queue does
 * NOT claim container/VM isolation — it enforces deadlines and cancel flags.
 * Cancel requires a human actor email. Never authorizes self_modify_core.
 */

export const JOB_KINDS = ["mission_execute", "agent_tick", "provider_probe"] as const;
export type JobKind = (typeof JOB_KINDS)[number];

export const JOB_STATUSES = [
  "queued",
  "running",
  "succeeded",
  "failed",
  "cancelled",
  "dead_letter",
] as const;
export type JobStatus = (typeof JOB_STATUSES)[number];

export type IrisJob = {
  id: string;
  kind: JobKind;
  subjectId: string;
  ownerEmail: string;
  status: JobStatus;
  attempts: number;
  maxAttempts: number;
  timeoutMs: number;
  createdAt: string;
  updatedAt: string;
  startedAt?: string;
  finishedAt?: string;
  leaseUntil?: string;
  lastError?: string;
  resultSummary?: string;
  cancelledBy?: string;
};

export type JobQueueState = {
  jobs: IrisJob[];
};

const MAX_JOBS = 100;
export const DEFAULT_TIMEOUT_MS = 15_000;
export const DEFAULT_MAX_ATTEMPTS = 3;

export function emptyJobQueue(): JobQueueState {
  return { jobs: [] };
}

export function parseJobQueue(value: string): JobQueueState {
  try {
    const parsed = JSON.parse(value) as Partial<JobQueueState>;
    return {
      jobs: Array.isArray(parsed.jobs)
        ? parsed.jobs.filter(item => item && typeof item === "object" && typeof (item as IrisJob).id === "string") as IrisJob[]
        : [],
    };
  } catch {
    return emptyJobQueue();
  }
}

export function enqueueJob(
  queue: JobQueueState,
  input: {
    id: string;
    kind: JobKind;
    subjectId: string;
    ownerEmail: string;
    timeoutMs?: number;
    maxAttempts?: number;
    now?: string;
  },
): { queue: JobQueueState; job: IrisJob } {
  const duplicate = queue.jobs.find(job =>
    job.subjectId === input.subjectId
    && job.kind === input.kind
    && (job.status === "queued" || job.status === "running")
  );
  if (duplicate) {
    throw new Error("duplicate_active_job");
  }
  const now = input.now || new Date().toISOString();
  const job: IrisJob = {
    id: input.id,
    kind: input.kind,
    subjectId: input.subjectId,
    ownerEmail: input.ownerEmail,
    status: "queued",
    attempts: 0,
    maxAttempts: Math.max(1, Math.min(input.maxAttempts ?? DEFAULT_MAX_ATTEMPTS, 5)),
    timeoutMs: Math.max(1000, Math.min(input.timeoutMs ?? DEFAULT_TIMEOUT_MS, 60_000)),
    createdAt: now,
    updatedAt: now,
  };
  return {
    queue: { jobs: [job, ...queue.jobs].slice(0, MAX_JOBS) },
    job,
  };
}

export function cancelJob(
  queue: JobQueueState,
  jobId: string,
  actorEmail: string,
  now = new Date().toISOString(),
) {
  const job = queue.jobs.find(item => item.id === jobId);
  if (!job) throw new Error("Job not found");
  if (job.status === "succeeded" || job.status === "dead_letter") {
    throw new Error("Job already finished");
  }
  const next: IrisJob = {
    ...job,
    status: "cancelled",
    updatedAt: now,
    finishedAt: now,
    cancelledBy: actorEmail,
  };
  return {
    queue: { jobs: queue.jobs.map(item => item.id === jobId ? next : item) },
    job: next,
  };
}

export function cancelJobsForSubject(
  queue: JobQueueState,
  subjectId: string,
  actorEmail: string,
  now = new Date().toISOString(),
) {
  let changed = false;
  const jobs = queue.jobs.map(job => {
    if (job.subjectId !== subjectId) return job;
    if (!["queued", "running"].includes(job.status)) return job;
    changed = true;
    return {
      ...job,
      status: "cancelled" as const,
      updatedAt: now,
      finishedAt: now,
      cancelledBy: actorEmail,
    };
  });
  return { queue: { jobs }, changed };
}

/** Recover timed-out leases into retryable queued jobs or dead letters. */
export function reclaimExpiredLeases(queue: JobQueueState, now = new Date().toISOString()) {
  const nowMs = Date.parse(now);
  const jobs = queue.jobs.map(job => {
    if (job.status !== "running" || !job.leaseUntil) return job;
    if (Date.parse(job.leaseUntil) > nowMs) return job;
    if (job.attempts >= job.maxAttempts) {
      return {
        ...job,
        status: "dead_letter" as const,
        updatedAt: now,
        finishedAt: now,
        lastError: job.lastError || "timeout_exhausted",
      };
    }
    return {
      ...job,
      status: "queued" as const,
      updatedAt: now,
      leaseUntil: undefined,
      lastError: "lease_expired_retry",
    };
  });
  return { queue: { jobs } };
}

export function leaseNextJob(
  queue: JobQueueState,
  ownerEmail: string,
  now = new Date().toISOString(),
) {
  const reclaimed = reclaimExpiredLeases(queue, now).queue;
  const next = reclaimed.jobs.find(job =>
    job.status === "queued"
    && job.ownerEmail === ownerEmail
  );
  if (!next) return { queue: reclaimed, job: null as IrisJob | null };

  const started: IrisJob = {
    ...next,
    status: "running",
    attempts: next.attempts + 1,
    startedAt: now,
    updatedAt: now,
    leaseUntil: new Date(Date.parse(now) + next.timeoutMs).toISOString(),
  };
  return {
    queue: { jobs: reclaimed.jobs.map(job => job.id === next.id ? started : job) },
    job: started,
  };
}

export function completeJob(
  queue: JobQueueState,
  jobId: string,
  summary: string,
  now = new Date().toISOString(),
) {
  const job = queue.jobs.find(item => item.id === jobId);
  if (!job) throw new Error("Job not found");
  if (job.status === "cancelled") throw new Error("Job was cancelled");
  const next: IrisJob = {
    ...job,
    status: "succeeded",
    updatedAt: now,
    finishedAt: now,
    leaseUntil: undefined,
    resultSummary: summary.slice(0, 1000),
  };
  return {
    queue: { jobs: queue.jobs.map(item => item.id === jobId ? next : item) },
    job: next,
  };
}

export function failJob(
  queue: JobQueueState,
  jobId: string,
  error: string,
  now = new Date().toISOString(),
) {
  const job = queue.jobs.find(item => item.id === jobId);
  if (!job) throw new Error("Job not found");
  if (job.status === "cancelled") {
    return { queue, job };
  }
  const exhausted = job.attempts >= job.maxAttempts;
  const next: IrisJob = {
    ...job,
    status: exhausted ? "dead_letter" : "queued",
    updatedAt: now,
    finishedAt: exhausted ? now : undefined,
    leaseUntil: undefined,
    lastError: error.slice(0, 500),
  };
  return {
    queue: { jobs: queue.jobs.map(item => item.id === jobId ? next : item) },
    job: next,
  };
}

export function queueStats(queue: JobQueueState) {
  const counts = Object.fromEntries(JOB_STATUSES.map(status => [status, 0])) as Record<JobStatus, number>;
  for (const job of queue.jobs) counts[job.status] += 1;
  return counts;
}
