export type StudyRole = "supervisor" | "dev" | "test";

export interface StudyEvent {
  timestamp: string;
  role: StudyRole;
  type: string;
  message: string;
  data?: Record<string, unknown>;
}

export const createEvent = (
  role: StudyRole,
  type: string,
  message: string,
  data?: Record<string, unknown>
): StudyEvent => ({
  timestamp: new Date().toISOString(),
  role,
  type,
  message,
  data
});

export const printEvent = (event: StudyEvent): void => {
  console.log(`[${event.timestamp}] [${event.role}] ${event.type}: ${event.message}`);
  if (event.data) {
    console.log(JSON.stringify(event.data, null, 2));
  }
};

