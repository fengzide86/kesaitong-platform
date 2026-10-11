// Offline sample workflow commands share the same host-side locked transaction.
export interface WorkflowReply { ok: boolean; message: string; id?: string }
export type WorkflowSubmit<C> = (command: C, baseline: string) => Promise<WorkflowReply>
